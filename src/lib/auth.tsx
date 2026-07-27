/**
 * src/lib/auth.tsx
 *
 * Django JWT auth context — drop-in replacement for the Supabase version.
 * Stores access + refresh tokens in localStorage.
 * Auto-refreshes the access token before it expires (simplejwt 15 min in prod,
 * 1 day in dev — we refresh when < 2 min remain).
 */

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
};

type AuthContextType = {
  user: AuthUser | null;
  merchantProfile: MerchantProfile | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    meta?: { role?: Role; store_name?: string }
  ) => Promise<{ error: string | null }>;
  signIn: (
    email: string,
    password: string,
    meta?: { role?: Role }
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshMerchantProfile: () => Promise<void>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decode JWT payload without verification (verification is server-side). */
function decodeJwt(token: string): Record<string, any> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/** Returns seconds until the token expires (negative = already expired). */
function secondsUntilExpiry(token: string): number {
  const payload = decodeJwt(token);
  if (!payload?.exp) return -1;
  return payload.exp - Math.floor(Date.now() / 1000);
}

export function djangoHeaders(json = false): HeadersInit {
  const token = tokenStore.getAccess();
  if (!token) throw new Error("Not authenticated — please log in again.");
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                       = useState<AuthUser | null>(null);
  const [merchantProfile, setMerchantProfile] = useState<MerchantProfile | null>(null);
  const [loading, setLoading]                 = useState(true);
  const refreshTimerRef                       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch /api/auth/me/ ────────────────────────────────────────────────────

  const fetchMe = useCallback(async () => {
    const token = tokenStore.getAccess();
    if (!token) { setUser(null); setMerchantProfile(null); return; }

    try {
      const me = await djangoFetch<AuthUser>(apiUrl("/auth/me/"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(me);

      // If merchant, fetch merchant profile
      if (me.role === "merchant") {
        try {
          const mp = await djangoFetch<MerchantProfile>(apiUrl("/merchants/me/"), {
            headers: { Authorization: `Bearer ${token}` },
          });
          setMerchantProfile(mp);
        } catch {
          setMerchantProfile(null);
        }
      } else {
        setMerchantProfile(null);
      }
    } catch {
      // Token likely expired and refresh failed
      tokenStore.clear();
      setUser(null);
      setMerchantProfile(null);
    }
  }, []);

  // ── Auto-refresh token ─────────────────────────────────────────────────────

  const scheduleRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const secs = secondsUntilExpiry(accessToken);
    // Refresh 2 minutes before expiry, or immediately if < 2 min remain
    const delay = Math.max((secs - 120) * 1000, 0);
    refreshTimerRef.current = setTimeout(async () => {
      const refresh = tokenStore.getRefresh();
      if (!refresh) return;
      try {
        const res = await djangoFetch<{ access: string; refresh?: string }>(
          apiUrl("/auth/token/refresh/"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh }),
          }
        );
        tokenStore.set(res.access, res.refresh ?? refresh);
        scheduleRefresh(res.access);
      } catch {
        tokenStore.clear();
        setUser(null);
        setMerchantProfile(null);
      }
    }, delay);
  }, []);

  // ── Initialise from localStorage on mount ─────────────────────────────────

  useEffect(() => {
    const access = tokenStore.getAccess();
    if (!access || secondsUntilExpiry(access) < 0) {
      // Try refresh first before giving up
      const refresh = tokenStore.getRefresh();
      if (refresh) {
        djangoFetch<{ access: string; refresh?: string }>(
          apiUrl("/auth/token/refresh/"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh }),
          }
        )
          .then((res) => {
            tokenStore.set(res.access, res.refresh ?? refresh);
            scheduleRefresh(res.access);
            return fetchMe();
          })
          .catch(() => {
            tokenStore.clear();
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
      return;
    }

    scheduleRefresh(access);
    fetchMe().finally(() => setLoading(false));

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchMe, scheduleRefresh]);

  // ── Sign up ────────────────────────────────────────────────────────────────

  const signUp = useCallback(
    async (
      email: string,
      password: string,
      name: string,
      meta?: { role?: Role; store_name?: string; confirmPassword?: string }
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
          }),
        });
        tokenStore.set(data.access, data.refresh);
        scheduleRefresh(data.access);
        await fetchMe();
        return { error: null };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [fetchMe, scheduleRefresh]
  );

  // ── Sign in ────────────────────────────────────────────────────────────────

  const signIn = useCallback(
    async (
      email: string,
      password: string,
      meta?: { role?: Role }
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
        scheduleRefresh(data.access);
        await fetchMe();
        return { error: null };
      } catch (e: any) {
        return { error: e.message };
      }
    },
    [fetchMe, scheduleRefresh]
  );

  // ── Sign out ───────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    const refresh = tokenStore.getRefresh();
    const access  = tokenStore.getAccess();
    // Best-effort blacklist — don't throw if it fails
    if (refresh && access) {
      djangoFetch(apiUrl("/auth/logout/"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
        body: JSON.stringify({ refresh }),
      }).catch(() => {});
    }
    tokenStore.clear();
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

  return (
    <AuthContext.Provider
      value={{
        user,
        merchantProfile,
        loading,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        refreshMerchantProfile,
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
