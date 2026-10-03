/**
 * src/lib/supabase-auth-ready.ts
 *
 * Backwards-compatibility shim.
 * The old Supabase version exported `authReady: Promise<Session | null>`.
 * Now that auth is Django JWT-based, we resolve with a fake session-like object
 * if a valid access token exists in localStorage, or null if not.
 *
 * Route guards that still import this will get the right value without
 * needing to be rewritten.
 */

import { tokenStore } from "@/lib/django-api-base";

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/**
 * A promise that resolves to a lightweight session object (with `user.role`)
 * if the user is logged in, or `null` if not.
 */
export const authReady: Promise<{ user: { role: string } } | null> =
  typeof window === "undefined"
    ? Promise.resolve(null)
    : Promise.resolve(
        (() => {
          const access = tokenStore.getAccess();
          if (!access) return null;
          const payload = decodeJwt(access);
          if (!payload) return null;
          // Treat expired tokens as no session (refresh happens in AuthProvider)
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
          return { user: { role: payload.role ?? "customer" } };
        })(),
      );
