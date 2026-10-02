/**
 * Wipe what the browser has cached of Zentro, and nothing else.
 *
 * The failure this exists for: a till holds a saved copy of the POS that only a
 * manual browser-cache clear can dislodge. Telling a merchant to open dev tools
 * is not support, so the app has to be able to clear its own cache.
 *
 * Two rules make this safe to ship as a one-tap action:
 *
 * - The session survives by default. A cache clear that signs a merchant out
 *   is a worse problem than the one it fixed.
 * - Unsynced offline sales are never touched. Orders and payments this device
 *   has taken but the server has not seen are money, not cache — discarding
 *   them is a separate, explicit choice.
 */

import { menuCache, offlineSales } from "@/features/pos/offline/db";
import { clearAllSavedBootstrap } from "@/features/pos/offline/cache";

/**
 * Keys that must survive a cache clear: identity, device registration and the
 * POS session. Everything else in localStorage is a cache.
 */
const KEEP_KEYS = new Set([
  // Merchant / customer session
  "dja",
  "djr",
  "zentro.staff",
  // Theme is a preference, not a cache — clearing it resets the merchant's
  // chosen appearance for no reason.
  "zentro-theme",
  // POS identity: without these the terminal has to re-register and re-pin.
  "pos_device_id",
  "pos_device_token",
  "pos_worker_id",
  "pos_worker",
  "pos_active_shift",
]);

export interface ClearCacheOptions {
  /**
   * Also drop the POS device registration, so the terminal re-authorizes and
   * re-downloads everything from scratch.
   */
  signOutPos?: boolean;
}

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
 * `signOutPos` additionally drops the POS device registration and the saved
 * offline copy, so the next load rebuilds both from the server. Unsynced orders
 * and payments are kept either way — see `discardPendingOfflineSales`.
 */
export async function clearAppCache(opts: ClearCacheOptions = {}): Promise<ClearCacheResult> {
  const keep = new Set(KEEP_KEYS);
  if (opts.signOutPos) {
    [
      "pos_device_id",
      "pos_device_token",
      "pos_worker_id",
      "pos_worker",
      "pos_active_shift",
    ].forEach((key) => keep.delete(key));
  }

  const cacheBuckets = await clearCacheStorage();
  const workers = await unregisterServiceWorkers();
  // The POS copy is keyed per merchant; the sweep removes the current one, but
  // a till handed between merchants can still hold older copies.
  clearAllSavedBootstrap();
  await menuCache.clear().catch(() => {});
  const storageKeys = clearWebStorage(keep);

  return { caches: cacheBuckets, serviceWorkers: workers, storageKeys };
}

/**
 * Throw away orders and payments taken offline that the server never received.
 * Irreversible, and deliberately not part of `clearAppCache`.
 */
export async function discardPendingOfflineSales(): Promise<void> {
  await offlineSales.discardAll();
}
