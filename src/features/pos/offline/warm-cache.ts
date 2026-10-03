/**
 * Make sure the POS can be reopened with no connection.
 *
 * The service worker only keeps what the browser happened to request while it
 * was in control, so on its own a reload offline works only if every script
 * the page needs was fetched on an earlier visit — and the Orders screen only
 * if someone had opened it. This saves the code and the pages of the two
 * screens that work offline while the connection is still up.
 */

import { NAVIGATION_CACHE, STATIC_CACHE } from "@/features/pwa/cache-names";

/** The screens that keep working offline. */
export const OFFLINE_POS_ROUTES = ["/pos", "/pos/orders"] as const;

function sameOriginAsset(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin !== window.location.origin) return null;
    return /\.(js|mjs|css)$/.test(parsed.pathname) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Every script and stylesheet this page has loaded so far. */
function loadedAssets(): string[] {
  const urls = new Set<string>();
  for (const entry of performance.getEntriesByType("resource")) {
    const url = sameOriginAsset(entry.name);
    if (url) urls.add(url);
  }
  document
    .querySelectorAll<
      HTMLScriptElement | HTMLLinkElement
    >('script[src], link[rel="stylesheet"], link[rel="modulepreload"]')
    .forEach((el) => {
      const url = sameOriginAsset("src" in el ? el.src : el.href);
      if (url) urls.add(url);
    });
  return [...urls];
}

/**
 * `loadRoutes` must first load the code of the offline screens (so that their
 * scripts are among the loaded assets). Failures are ignored: this only ever
 * improves on what the service worker would have cached anyway.
 */
export async function warmPosOfflineCache(loadRoutes: () => Promise<unknown>): Promise<void> {
  // The service worker is only registered in production builds.
  if (!import.meta.env.PROD || typeof caches === "undefined") return;
  try {
    await loadRoutes();

    const assets = await caches.open(STATIC_CACHE);
    await Promise.all(
      loadedAssets().map(async (url) => {
        if (!(await assets.match(url))) await assets.add(url).catch(() => {});
      }),
    );

    const pages = await caches.open(NAVIGATION_CACHE);
    await Promise.all(
      OFFLINE_POS_ROUTES.map(async (route) => {
        const res = await fetch(route, { credentials: "same-origin" });
        if (res.ok) await pages.put(route, res);
      }),
    );
  } catch {
    // offline, or storage unavailable
  }
}
