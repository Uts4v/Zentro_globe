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

export async function djangoFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...options });
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
    throw new Error(errMsg || `Request failed: ${res.status}`);
  }
  return data as T;
}