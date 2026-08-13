// src/lib/ws.ts
// WebSocket connection helper.
//
// WebSocket URLs appear in logs, proxies and monitoring tools, so we must
// never put a long-lived access token in the query string. Instead we fetch a
// short-lived (60s) WS-only JWT from /api/auth/ws-token/ and use that in the
// URL. The backend rejects long-lived access tokens in WS URLs.

import { apiUrl, tokenStore } from "./django-api-base";

export async function getWsToken(): Promise<string> {
  const access = tokenStore.getAccess();
  if (!access) throw new Error("Not authenticated");
  const res = await fetch(apiUrl("/auth/ws-token/"), {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (!res.ok) throw new Error(`ws-token request failed: ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("ws-token response missing token");
  return data.token;
}
