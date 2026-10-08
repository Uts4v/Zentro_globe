/**
 * src/lib/auth.tsx
 *
 * Django JWT auth context — drop-in replacement for the Supabase version.
 * Stores access + refresh tokens in localStorage.
 * Auto-refreshes the access token before it expires (simplejwt 15 min in prod,
 * 1 day in dev — we refresh when < 2 min remain).
 */

import { staffHeaders, staffSession } from "@/lib/staff-session";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { apiUrl, tokenStore, djangoFetch } from "@/lib/django-api-base";
import { decodeJwt, refreshAccessToken, secondsUntilExpiry } from "@/lib/auth-tokens";
import { useStore } from "@/lib/store";
import { usePosStore } from "@/features/pos/store";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Role = "customer" | "merchant";

export type CustomerProfile = {
  id: number;
  full_name: string | null;
  loyalty_points: number;
  streak_days: number;
  total_orders: number;
  tier: string;
  transfer_code?: string;
};

export type MerchantProfile = {
  id: number;
  business_name: string;
  slug: string | null;
  business_type: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  is_approved: boolean;
  is_open: boolean;
  onboarding_complete: boolean;
  latitude?: string | null;
  longitude?: string | null;
  ai_enabled: boolean;
  currency_code?: string;
  currency_symbol?: string;
  tax_enabled?: boolean;
  tax_rate_percent?: string;
  tax_components?: Array<{ name: string; rate: number }>;
  tax_policy?: "legacy" | "exclusive" | "inclusive";
  service_charge_percent?: string;
  service_charge_dine_in_only?: boolean;
  pos_enabled?: boolean;
  offline_pos_enabled?: boolean;
  credit_accounts_enabled?: boolean;
  debit_accounts_enabled?: boolean;
  discounts_enabled?: boolean;
  shift_management_enabled?: boolean;
  receipt_printing_enabled?: boolean;
  max_worker_discount_percent?: number;
  manager_approval_threshold?: number;
  offline_discounts_allowed?: boolean;
  offline_credit_allowed?: boolean;
  /** False until the merchant first configures their tender list. */
  payment_methods_configured?: boolean;
  accepted_payment_methods?: string[];
  /** Custom tender names, keyed by method key. */
  payment_method_labels?: Record<string, string>;
  payment_qr_enabled?: boolean;
  payment_qr_url?: string | null;
  payment_qr_name?: string | null;
  payment_qr_instructions?: string | null;
  payment_qr_account_name?: string | null;
};

export type AuthUser = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  phone: string;
  avatar_url: string;
  customer_profile: CustomerProfile | null;
  /** False for OAuth-only accounts — they must use the reset flow instead. */
  has_usable_password?: boolean;
};

type AuthContextType = {
  user: AuthUser | null;
  merchantProfile: MerchantProfile | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    meta?: {
      role?: Role;
      store_name?: string;
      confirmPassword?: string;
      phone?: string;
      phoneToken?: string;
    },
  ) => Promise<{ error: string | null }>;
  signIn: (
    email: string,
    password: string,
    meta?: { role?: Role },
  ) => Promise<{ error: string | null }>;
  googleAuth: (
    idToken: string,
    meta?: {
      role?: Role;
      phone?: string;
      phoneToken?: string;
      store_name?: string;
    },
  ) => Promise<{ error: string | null }>;
  sendOtp: (
    phone: string,
    purpose?: "signup" | "login" | "verify_phone",
  ) => Promise<{ error: string | null; debugCode?: string }>;
  verifyOtp: (
    phone: string,
    code: string,
    purpose?: "signup" | "login" | "verify_phone",
  ) => Promise<{ error: string | null; phoneToken?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshMerchantProfile: () => Promise<void>;
  changePassword: (
    oldPassword: string,
    newPassword: string,
  ) => Promise<{ error: string | null; noUsablePassword?: boolean }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** How long to wait before retrying a refresh the server did not answer. */
const REFRESH_RETRY_MS = 30000;

/** The signed-in user as described by the access token's own claims. */
function userFromToken(token: string): AuthUser | null {
  const payload = decodeJwt(token);
  if (!payload) return null;
  const fullName = payload.full_name || payload.name || "";
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = payload.first_name || nameParts[0] || "";
  const lastName = payload.last_name || nameParts.slice(1).join(" ") || "";
  return {
    id: Number(payload.user_id || payload.id || 0),
    email: String(payload.email || ""),
    first_name: String(firstName),
    last_name: String(lastName),
    role: (payload.role === "merchant" ? "merchant" : "customer") as Role,
    phone: String(payload.phone || ""),
    avatar_url: String(payload.avatar_url || ""),
    customer_profile: null,
    has_usable_password: payload.has_usable_password,
  };
}

export function djangoHeaders(json = false): HeadersInit {
  const token = tokenStore.getAccess();
  const staff = staffHeaders();
  if (!token && !staff["X-Zentro-Staff"]) {
    throw new Error("Not authenticated — please log in again.");
  }
  const h: Record<string, string> = { ...staff };
  if (token) {
    h["Authorization"] = `Bearer ${token}`;
  } else if (staff["X-Zentro-Staff"]) {
    h["Authorization"] = `Staff ${staff["X-Zentro-Staff"]}`;
  }
  if (json) h["Content-Type"] = "application/json";
  return h;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Drop the POS identity left behind by whichever account was signed in before
 * this login. The POS store is a module singleton and the staff session names
 * a staff member of one merchant, so a login that switches accounts must start
 * the POS empty — otherwise the previous merchant's workers, menu and tables
 * are shown to the new account, whose PosLayout sees an already-hydrated store
 * and skips re-bootstrapping it. Called from every sign-in flow, never from
 * session expiry: a till running on a staff PIN must not be interrupted just
 * because an old Google session died. The device registration and any unsynced
 * offline sales are left alone — a login changes who is signed in, not which
 * till this is or which orders it has taken.
 */
function dropPreviousAccountPos(): void {
  staffSession.set(null);
  usePosStore.getState().reset();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The app was opened offline, so the full profile still has to be fetched
  // once a refresh gets through.
  const profilePendingRef = useRef(false);

  // ── Fetch /api/auth/me/ ────────────────────────────────────────────────────

  const fetchMe = useCallback(async () => {
    const token = tokenStore.getAccess();
    if (!token) {
      setUser(null);
      setMerchantProfile(null);
      return;
    }

    try {
      const me = await djangoFetch<AuthUser>(apiUrl("/auth/me/"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(me);

      if (me.role === "merchant") {
        djangoFetch<MerchantProfile>(apiUrl("/merchants/me/"), {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(setMerchantProfile)
          .catch(() => setMerchantProfile(null));
      } else {
        setMerchantProfile(null);
      }
    } catch (err: any) {
      if (err?.status === 401) {
        // Token is actually invalid or expired
        tokenStore.clear();
        setUser(null);
        setMerchantProfile(null);
      } else {
        // For rate limit (429) or temporary server errors, retain user session from valid token
        const fallbackUser = secondsUntilExpiry(token) > 0 ? userFromToken(token) : null;
        if (fallbackUser) setUser((prev) => prev || fallbackUser);
      }
    }
  }, []);

  // ── Auto-refresh token ─────────────────────────────────────────────────────

  const scheduleRefresh = useCallback(
    (accessToken: string) => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const secs = secondsUntilExpiry(accessToken);
      // Refresh 2 minutes before expiry, or immediately if < 2 min remain
      const delay = Math.max((secs - 120) * 1000, 0);
      refreshTimerRef.current = setTimeout(async () => {
        if (!tokenStore.getRefresh()) return;
        const outcome = await refreshAccessToken();
        const fresh = tokenStore.getAccess();
        if (outcome === "refreshed" && fresh) {
          scheduleRefresh(fresh);
          if (profilePendingRef.current) {
            profilePendingRef.current = false;
            void fetchMe();
          }
        } else if (outcome === "unreachable") {
          // No answer is not a refusal. Signing out here would throw the POS to
          // the login page mid-service and strand every order waiting to sync,
          // so keep the session and ask again once the server can be reached.
          refreshTimerRef.current = setTimeout(
            () => scheduleRefresh(tokenStore.getAccess() ?? accessToken),
            REFRESH_RETRY_MS,
          );
        } else {
          tokenStore.clear();
          setUser(null);
          setMerchantProfile(null);
        }
      }, delay);
    },
    [fetchMe],
  );

  // ── Initialise from localStorage on mount ─────────────────────────────────

  useEffect(() => {
    const stopRefresh = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
    const access = tokenStore.getAccess();
    if (!access || secondsUntilExpiry(access) < 0) {
      // Try refresh first before giving up
      if (!tokenStore.getRefresh()) {
        setLoading(false);
        return;
      }
      refreshAccessToken()
        .then((outcome) => {
          const fresh = tokenStore.getAccess();
          if (outcome === "refreshed" && fresh) {
            scheduleRefresh(fresh);
            return fetchMe();
          }
          if (outcome === "unreachable") {
            // Opened without a connection: stay signed in as the saved user
            // and refresh as soon as the server answers.
            const savedUser = access ? userFromToken(access) : null;
            if (savedUser) setUser((prev) => prev || savedUser);
            profilePendingRef.current = true;
            scheduleRefresh(access ?? "");
            return;
          }
          tokenStore.clear();
        })
        .finally(() => setLoading(false));
      return stopRefresh;
    }

    scheduleRefresh(access);
    fetchMe().finally(() => setLoading(false));

    return stopRefresh;
  }, [fetchMe, scheduleRefresh]);

  // ── Sign up ────────────────────────────────────────────────────────────────

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      name: string,
      meta?: {
        role?: Role;
        store_name?: string;
        confirmPassword?: string;
        phone?: string;
        phoneToken?: string;
      },
    ): Promise<{ error: string | null }> => {
      try {
        const data = await djangoFetch<{
          access: string;
          refresh: string;
          role: string;
          email: string;
          full_name: string;
        }>(apiUrl("/auth/register/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            confirm_password: meta?.confirmPassword ?? password,
            full_name: name,
            role: meta?.role ?? "customer",
            store_name: meta?.store_name ?? "",
            phone: meta?.phone ?? "",
            phone_token: meta?.phoneToken ?? "",
          }),
        });
        tokenStore.set(data.access, data.refresh);
        dropPreviousAccountPos();
        scheduleRefresh(data.access);
        await fetchMe();
        return { error: null };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [fetchMe, scheduleRefresh],
  );

  // ── Sign in ────────────────────────────────────────────────────────────────

  const signIn = useCallback(
    async (
      email: string,
      password: string,
      meta?: { role?: Role },
    ): Promise<{ error: string | null }> => {
      try {
        const data = await djangoFetch<{
          access: string;
          refresh: string;
          role: string;
          email: string;
          full_name: string;
        }>(apiUrl("/auth/login/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            ...(meta?.role ? { role: meta.role } : {}),
          }),
        });
        tokenStore.set(data.access, data.refresh);
        dropPreviousAccountPos();
        scheduleRefresh(data.access);
        await fetchMe();
        return { error: null };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [fetchMe, scheduleRefresh],
  );

  // ── Continue with Google ──────────────────────────────────────────────────

  const googleAuth = useCallback(
    async (
      idToken: string,
      meta?: {
        role?: Role;
        phone?: string;
        phoneToken?: string;
        store_name?: string;
      },
    ): Promise<{ error: string | null }> => {
      try {
        const data = await djangoFetch<{
          access: string;
          refresh: string;
          role: string;
          email: string;
          full_name: string;
        }>(apiUrl("/auth/google/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_token: idToken,
            role: meta?.role ?? "customer",
            phone: meta?.phone ?? "",
            phone_token: meta?.phoneToken ?? "",
            store_name: meta?.store_name ?? "",
          }),
        });
        tokenStore.set(data.access, data.refresh);
        dropPreviousAccountPos();
        scheduleRefresh(data.access);
        await fetchMe();
        return { error: null };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [fetchMe, scheduleRefresh],
  );

  // ── OTP (mobile verification) ─────────────────────────────────────────────

  const sendOtp = useCallback(
    async (
      phone: string,
      purpose: "signup" | "login" | "verify_phone" = "signup",
    ): Promise<{ error: string | null; debugCode?: string }> => {
      try {
        const res = await djangoFetch<{
          detail?: string;
          debug_code?: string;
          sent_via?: string;
        }>(apiUrl("/auth/send-otp/"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, purpose }),
        });
        return { error: null, debugCode: res.debug_code };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [],
  );

  const verifyOtp = useCallback(
    async (
      phone: string,
      code: string,
      purpose: "signup" | "login" | "verify_phone" = "signup",
    ): Promise<{ error: string | null; phoneToken?: string }> => {
      try {
        const res = await djangoFetch<{ verified: boolean; phone_token: string }>(
          apiUrl("/auth/verify-otp/"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, code, purpose }),
          },
        );
        return { error: null, phoneToken: res.phone_token };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [],
  );

  // ── Sign out ───────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    const refresh = tokenStore.getRefresh();
    const access = tokenStore.getAccess();
    // Best-effort blacklist — don't throw if it fails
    if (refresh && access) {
      djangoFetch(apiUrl("/auth/logout/"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
        body: JSON.stringify({ refresh }),
      }).catch(() => {});
    }
    tokenStore.clear();
    useStore.getState().resetSession();
    // Switching accounts must not carry the previous merchant's workers,
    // menu or tables into the next account's POS either.
    dropPreviousAccountPos();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setUser(null);
    setMerchantProfile(null);
  }, []);

  // ── Refresh helpers ────────────────────────────────────────────────────────

  const refreshProfile = useCallback(async () => {
    await fetchMe();
  }, [fetchMe]);

  const refreshMerchantProfile = useCallback(async () => {
    const token = tokenStore.getAccess();
    if (!token) return;
    try {
      const mp = await djangoFetch<MerchantProfile>(apiUrl("/merchants/me/"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMerchantProfile(mp);
    } catch {
      setMerchantProfile(null);
    }
  }, []);

  // ── Change password ─────────────────────────────────────────────────────────

  const changePassword = useCallback(
    async (
      oldPassword: string,
      newPassword: string,
    ): Promise<{ error: string | null; noUsablePassword?: boolean }> => {
      const token = tokenStore.getAccess();
      if (!token) return { error: "Please log in again to change your password." };
      try {
        await djangoFetch(apiUrl("/auth/change-password/"), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
        });
        return { error: null };
      } catch (e) {
        const err = e as Error & { code?: string };
        return { error: err.message, noUsablePassword: err.code === "no_usable_password" };
      }
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        merchantProfile,
        loading,
        signUp,
        signIn,
        googleAuth,
        sendOtp,
        verifyOtp,
        signOut,
        refreshProfile,
        refreshMerchantProfile,
        changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
