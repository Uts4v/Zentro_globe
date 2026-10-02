// src/lib/auth-tokens.ts
// Reading and refreshing the JWT pair kept in `tokenStore`.

import { apiUrl, djangoFetch, tokenStore } from "@/lib/django-api-base";

/** Decode JWT payload without verification (verification is server-side). */
export function decodeJwt(token: string): Record<string, any> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

/** Returns seconds until the token expires (negative = already expired). */
export function secondsUntilExpiry(token: string): number {
  const payload = decodeJwt(token);
  if (!payload?.exp) return -1;
  return payload.exp - Math.floor(Date.now() / 1000);
}

/**
 * - `refreshed`: a new access token is in `tokenStore`.
 * - `rejected`: the server refused the refresh token; the session is over.
 * - `unreachable`: the server gave no usable answer (offline, overloaded,
 *   erroring). The session may well still be valid, so the tokens must be kept
 *   and the refresh tried again later.
 */
export type RefreshOutcome = "refreshed" | "rejected" | "unreachable";

let inFlight: Promise<RefreshOutcome> | null = null;

/**
 * Exchange the refresh token for a new pair.
 *
 * Refresh tokens rotate and the old one is blacklisted, so two refreshes sent
 * at once would make the second fail and sign the user out. Every caller
 * therefore shares the one request that is in flight.
 */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<RefreshOutcome> => {
    const refresh = tokenStore.getRefresh();
    if (!refresh) return "rejected";
    try {
      const res = await djangoFetch<{ access: string; refresh?: string }>(
        apiUrl("/auth/token/refresh/"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
        },
      );
      tokenStore.set(res.access, res.refresh ?? refresh);
      return "refreshed";
    } catch (err) {
      // Only an explicit refusal ends the session. No answer, a busy server
      // (429) or a broken one (5xx) says nothing about the token.
      const status = (err as { status?: unknown } | null)?.status;
      if (status !== 400 && status !== 401) return "unreachable";
      // Another tab rotated the token first: its new pair is already stored.
      if (tokenStore.getRefresh() !== refresh) return "refreshed";
      return "rejected";
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
