/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { clientsClaim } from "workbox-core";
import { NAVIGATION_CACHE, STATIC_CACHE } from "./features/pwa/cache-names";

declare let self: ServiceWorkerGlobalScope;

// ── Precache build assets ─────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ── Claim clients ─────────────────────────────────────────────────────────────
// Deliberately NOT calling skipWaiting() here.
//
// A till is open all day and mid-service when a deploy lands. Taking over
// immediately reloaded every open POS terminal at once, losing the cart on
// screen. Instead a new worker waits, the page is told an update is ready
// (`updatefound` in PwaProvider), and the swap happens only when the user
// accepts — PwaProvider.applyUpdate() posts SKIP_WAITING below.
clientsClaim();

// ── Cache-first: static assets ────────────────────────────────────────────────
registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker",
  new CacheFirst({
    cacheName: STATIC_CACHE,
    plugins: [
      // The build has a few hundred chunks. A smaller limit evicts the POS's
      // own scripts once other pages have been used, and then the POS cannot
      // be reopened offline.
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// ── Cache-first: images ───────────────────────────────────────────────────────
registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "zentro-images-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// ── Cache-first: Google Fonts ─────────────────────────────────────────────────
registerRoute(
  ({ url }) =>
    url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "zentro-fonts-v1",
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// ── Network-first: public API (merchant profiles, menus, etc.) ────────────────
registerRoute(
  ({ url }) => {
    const path = url.pathname;
    return (
      path.startsWith("/api/loyalty/merchant/") &&
      !path.includes("/wallet") &&
      !path.includes("/transfer") &&
      !path.includes("/card-design")
    );
  },
  new NetworkFirst({
    cacheName: "zentro-public-api-v1",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 })],
  }),
);

// ── NEVER cache private routes ────────────────────────────────────────────────
// JWT tokens, wallet balances, transactions, orders, transfers, auth endpoints
// are explicitly excluded from all caching strategies above by route matching.

// ── Navigation fallback → offline page ────────────────────────────────────────
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({
    cacheName: NAVIGATION_CACHE,
    networkTimeoutSeconds: 10,
    plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  }),
);

// Graceful fallback for navigation requests when network and cache both miss
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    // Try to return any previously cached navigation page (like /pos or /)
    const navCache = await caches.open(NAVIGATION_CACHE);
    const cachedKeys = await navCache.keys();
    for (const key of cachedKeys) {
      if (key.url.includes("/pos")) {
        const match = await navCache.match(key);
        if (match) return match;
      }
    }
    const rootMatch = await navCache.match("/");
    if (rootMatch) return rootMatch;

    // Self-contained offline HTML page so Safari never shows the fatal 'no-response' error
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline · Zentro</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0d0e; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 24px; box-sizing: border-box; }
    .card { max-width: 360px; padding: 32px 24px; border-radius: 24px; background: #16181a; border: 1px solid #282a2d; box-shadow: 0 12px 30px rgba(0,0,0,0.5); }
    h1 { font-size: 1.5rem; margin: 0 0 10px; color: #FA6A4A; }
    p { color: #9da3ae; font-size: 0.95rem; line-height: 1.5; margin: 0 0 24px; }
    button { background: #FA6A4A; color: #fff; border: none; padding: 12px 28px; border-radius: 999px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: opacity 0.2s; }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="card">
    <h1>You're Offline</h1>
    <p>Connection lost or server is taking a moment to respond. Reconnect to Wi-Fi and tap reload.</p>
    <button onclick="window.location.reload()">Reload Page</button>
  </div>
</body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
  return Response.error();
});

// ── Push events ───────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    url?: string;
    data?: any;
  };

  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Zentro", body: event.data.text() };
  }

  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: payload.body,
    icon: payload.icon || "/icons/pwa-192x192.png",
    badge: payload.badge || "/icons/pwa-192x192.png",
    data: payload.data || { url: payload.url || "/" },
    vibrate: [100, 50, 100],
    tag: "zentro-notification",
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(payload.title || "Zentro", options));
});

// ── Notification click events ─────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/";
  const query = targetUrl.includes("?") ? targetUrl : `${targetUrl}?source=notification`;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(query);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(query);
    }),
  );
});

// ── Service worker update ─────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
