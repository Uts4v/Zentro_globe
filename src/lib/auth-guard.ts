// src/lib/auth-guard.ts
import { redirect } from "@tanstack/react-router";
import { tokenStore } from "@/lib/django-api-base";

function hasValidToken(): boolean {
  if (typeof window === "undefined") return false;
  const access = tokenStore.getAccess();
  if (!access) return false;
  try {
    const payload = JSON.parse(atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function getUserRole(): string | null {
  if (typeof window === "undefined") return null;
  const access = tokenStore.getAccess();
  if (!access) return null;
  try {
    const payload = JSON.parse(atob(access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role ?? null;
  } catch {
    return null;
  }
}

/** Redirect to /auth if not logged in. */
export async function requireAuth() {
  if (typeof window === "undefined") return;
  if (!hasValidToken()) {
    throw redirect({
      to: "/auth",
      search: { redirect: window.location.pathname } as any,
    });
  }
}

/** Redirect to /auth if not logged in, AND redirect merchants to their dashboard. */
export async function requireCustomer() {
  if (typeof window === "undefined") return;
  if (!hasValidToken()) {
    throw redirect({
      to: "/auth",
      search: { redirect: window.location.pathname } as any,
    });
  }
  const role = getUserRole();
  if (role === "merchant") {
    throw redirect({ to: "/merchant" as any });
  }
}

/** Redirect to /auth/merchant if not logged in (merchant routes). */
export async function requireMerchantAuth() {
  if (typeof window === "undefined") return;
  if (!hasValidToken()) {
    throw redirect({
      to: "/auth/merchant" as any,
      search: { redirect: window.location.pathname } as any,
    });
  }
}
