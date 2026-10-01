import { staffSession } from "@/lib/staff-session";
import {
  isGatewayError,
  noteServerReachable,
  noteServerUnreachable,
  setConnectivityProbe,
} from "@/lib/connectivity";
// src/lib/django-api-base.ts
// Shared helpers for talking to the Django loyalty backend.

declare global {
  interface Window {
    __DJANGO_API_BASE__?: string;
  }
}

// Build-time default (baked by Vite). Overridden at runtime when the SSR server
// injects `window.__DJANGO_API_BASE__` from the DJANGO_API_BASE_URL env var.
const BUILD_BASE = (import.meta.env.VITE_DJANGO_API_BASE_URL as string | undefined);

function resolveBase(): string {
  const injected =
    typeof window !== "undefined" && window.__DJANGO_API_BASE__
      ? window.__DJANGO_API_BASE__
      : undefined;
  return injected || BUILD_BASE || "http://127.0.0.1:8000/api";
}

export const DJANGO_BASE = resolveBase().replace(/\/$/, "");

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${DJANGO_BASE}${p}`;
}

export const tokenStore = {
  getAccess: (): string | null => localStorage.getItem("dja"),
  getRefresh: (): string | null => localStorage.getItem("djr"),
  set: (access: string, refresh: string) => {
    localStorage.setItem("dja", access);
    localStorage.setItem("djr", refresh);
  },
  clear: () => {
    localStorage.removeItem("dja");
    localStorage.removeItem("djr");
  },
};

// Sent like any other API call (same headers, so the same CORS rules apply):
// the health check answers 200 signed in and 401 otherwise, and either one
// shows the server is back.
setConnectivityProbe(() => {
  const access = tokenStore.getAccess();
  return fetch(apiUrl("/pos/health/"), {
    cache: "no-store",
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
});

export async function djangoFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...options });
  } catch (err) {
    // No answer at all (offline, DNS, dead uplink). A cancelled request says
    // nothing about the server.
    if ((err as { name?: string } | null)?.name !== "AbortError") noteServerUnreachable();
    throw err;
  }
  if (isGatewayError(res.status)) noteServerUnreachable();
  else noteServerReachable();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let errMsg = (data as any)?.error || (data as any)?.detail;
    if (!errMsg && data && typeof data === "object") {
      // Handle DRF serializer field errors
      const messages = Object.entries(data)
        .filter(([k]) => k !== "error" && k !== "detail")
        .map(([field, errors]) => {
          const msgs = Array.isArray(errors) ? errors.join(", ") : String(errors);
          // Capitalize field name and remove underscores for better display
          const displayField = field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
          return `${displayField}: ${msgs}`;
        });
      if (messages.length > 0) {
        errMsg = messages.join(" | ");
      }
    }
    const err = new Error(errMsg || `Request failed: ${res.status}`) as Error & {
      status?: number;
      code?: string;
    };
    // Preserve HTTP status and any machine-readable `code` so callers can
    // branch on them instead of pattern-matching the message text.
    err.status = res.status;
    const code = (data as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "string") err.code = code;
    // The employee's staff session expired: drop it so the device recovers.
    if (code === "staff_session_ended") staffSession.set(null);
    throw err;
  }
  return data as T;
}