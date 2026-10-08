/**
 * Wipe what the browser has cached of Zentro, and nothing else.
 *
 * The failure this exists for: a till holds a saved copy of the POS that only a
 * manual browser-cache clear can dislodge. Telling a merchant to open dev tools
 * is not support, so the app has to be able to clear its own cache.
 *
 * Three rules make this safe to ship as a one-tap action:
 *
 * - The Google/customer session survives by default (``dja``/``djr``). A cache
 *   clear that signs a merchant out is a worse problem than the one it fixed.
 * - The POS staff account and the device registration do NOT survive. A till
 *   handed between merchants must not keep the previous merchant's staff,
 *   device or saved copy: clearing cache clears them so the next load starts
 *   fresh under the merchant actually signed in.
 * - Unsynced offline sales are never touched. Orders and payments this device
 *   has taken but the server has not seen are money, not cache — discarding
 *   them is a separate, explicit choice.
 */

import { menuCache, offlineSales } from "@/features/pos/offline/db";
import { clearAllSavedBootstrap } from "@/features/pos/offline/cache";
import { staffSession } from "./staff-session";

/**
 * Keys that must survive a cache clear: the logged-in Google/customer session,
 * plus two device settings that are hardware and taste rather than cached data.
 * Everything else in localStorage is a cache — and anything that identifies a
 * POS staff member or a merchant's device is deliberately cleared, so the next
 * load can never start under the previous merchant.
 */
const KEEP_KEYS = new Set([
  // Google / customer session — the only account that survives.
  "dja",
  "djr",
  // Theme is a preference, not a cache — clearing it resets the merchant's
  // chosen appearance for no reason.
  "zentro-theme",
  // Printer setup is terminal hardware configuration, not a cache — clearing
  // it would silently drop every printer back to the browser print dialog.
  "pos_printer_settings",
]);

export interface ClearCacheResult {
  caches: number;
  storageKeys: number;
  serviceWorkers: number;
}

/** Every Cache Storage bucket this origin has, removed. */
async function clearCacheStorage(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  return keys.length;
}

/**
 * Take the service worker out of the picture.
 *
 * A worker that keeps running will re-populate the very caches just deleted
 * from its own copy of the previous version, so the app has to be reloaded
 * against a fresh one afterwards.
 */
async function unregisterServiceWorkers(): Promise<number> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return 0;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  return registrations.length;
}

function clearWebStorage(keep: Set<string>): number {
  let removed = 0;
  const sweep = (storage: Storage | undefined) => {
    if (!storage) return;
    try {
      const doomed: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key && !keep.has(key)) doomed.push(key);
      }
      doomed.forEach((key) => storage.removeItem(key));
      removed += doomed.length;
    } catch {
      // private browsing — nothing to sweep
    }
  };
  sweep(typeof localStorage === "undefined" ? undefined : localStorage);
  sweep(typeof sessionStorage === "undefined" ? undefined : sessionStorage);
  return removed;
}

/** How many offline sales on this device have not reached the server yet. */
export async function countPendingOfflineSales(): Promise<number> {
  try {
    return await offlineSales.pendingCount();
  } catch {
    return 0;
  }
}

/**
 * Clear the app's cache: Cache Storage, the service worker, and every
 * localStorage/sessionStorage key that is a cache rather than a session.
 *
 * The Google/customer session survives, as do the theme and printer setup. The
 * POS staff session and the device registration do not: a till handed between
 * merchants must never keep the previous merchant's staff or device, so the
 * next load re-registers under the merchant actually signed in. Unsynced
 * offline orders and payments are kept — see `discardPendingOfflineSales`.
 */
export async function clearAppCache(): Promise<ClearCacheResult> {
  // Belt and braces for the staff session: the storage sweep below removes its
  // key too, but this also drops the in-memory copy and notifies subscribers.
  staffSession.set(null);

  const cacheBuckets = await clearCacheStorage();
  const workers = await unregisterServiceWorkers();
  // The POS copy is keyed per merchant; the sweep removes the current one, but
  // a till handed between merchants can still hold older copies.
  clearAllSavedBootstrap();
  await menuCache.clear().catch(() => {});
  const storageKeys = clearWebStorage(KEEP_KEYS);

  return { caches: cacheBuckets, serviceWorkers: workers, storageKeys };
}

/**
 * Throw away orders and payments taken offline that the server never received.
 * Irreversible, and deliberately not part of `clearAppCache`.
 */
export async function discardPendingOfflineSales(): Promise<void> {
  await offlineSales.discardAll();
}
