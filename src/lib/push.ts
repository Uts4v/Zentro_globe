// src/lib/push.ts
// Web-Push subscription for PWA users (system notifications on mobile).
//
// Strategy:
// - Web (browser tab): in-app toasts only (GlobalNotificationToasts over WS)
// - Installed PWA: subscribe to Web Push so OS-level notifications arrive
//   even when the app is closed. The service worker displays them.

import { apiUrl, djangoFetch, tokenStore } from "./django-api-base";

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as any).standalone === true
  );
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

const SUB_KEY = "zentro_push_subscribed_user";

/**
 * Subscribe the current browser/PWA to Web Push for the logged-in user.
 * Safe to call repeatedly — no-ops unless needed.
 */
export async function registerPushSubscription(userId: number | undefined): Promise<void> {
  try {
    if (!userId || !pushSupported() || !isStandalonePwa()) return;
    if (!tokenStore.getAccess()) return;

    const swReg = await navigator.serviceWorker.ready;

    // Already subscribed for this user?
    if (localStorage.getItem(SUB_KEY) === String(userId)) {
      const existing = await swReg.pushManager.getSubscription();
      if (existing) return;
      localStorage.removeItem(SUB_KEY);
    }

    if (Notification.permission === "denied") return;

    const { public_key } = await djangoFetch<{ public_key: string }>(
      apiUrl("/notifications/vapid-public-key/"),
      { headers: { Authorization: `Bearer ${tokenStore.getAccess()}` } },
    );
    if (!public_key) return;

    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }

    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key) as BufferSource,
    });

    const json = sub.toJSON();
    await djangoFetch(apiUrl("/notifications/subscribe/"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenStore.getAccess()}`,
      },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
      }),
    });

    localStorage.setItem(SUB_KEY, String(userId));
  } catch {
    // Push is best-effort — never block the app
  }
}
