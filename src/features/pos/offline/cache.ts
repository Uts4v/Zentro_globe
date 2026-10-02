/**
 * The POS copy that keeps working when the server cannot be reached.
 *
 * Everything here is about two things the till gets wrong without it:
 *
 * - The saved copy is keyed by merchant, so a device handed from one merchant to
 *   another can never show the previous merchant's menu, tables or staff.
 * - A write that fails (private browsing, quota) is reported rather than
 *   swallowed. A silent failure looks exactly like "offline POS has no menu",
 *   which is the one thing a cashier cannot debug.
 */

import type { PosBootstrapResponse } from "../api";

const PREFIX = "zentro_pos_";

/**
 * Which merchant the till last synced. Written alongside the copy so an offline
 * start knows whose copy to load without having to guess between several.
 */
const LAST_MERCHANT_KEY = `${PREFIX}last_merchant`;

/**
 * The copy saved on this device, with the time it was saved.
 *
 * `savedAt` is deliberately kept next to the payload rather than in a second
 * key: two writes cannot disagree, so a `savedAt` can never describe a
 * different payload than the one sitting beside it.
 */
export interface SavedBootstrap {
  data: PosBootstrapResponse;
  savedAt: string;
}

/** Version tag so an old, differently-shaped copy is ignored, not misread. */
const SCHEMA_VERSION = 2;

interface Envelope extends SavedBootstrap {
  v: number;
}

function storageKey(merchantId: number | null | undefined): string | null {
  if (merchantId === null || merchantId === undefined) return null;
  return `${PREFIX}bootstrap.${SCHEMA_VERSION}.${merchantId}`;
}

/**
 * Drop every POS copy on this device, whatever merchant wrote it.
 *
 * A till is often re-used: the owner's copy from yesterday is never what the
 * next cashier should be looking at, so sign-out clears all of them.
 */
export function clearAllSavedBootstrap(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(`${PREFIX}bootstrap.`)) continue;
      doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(LAST_MERCHANT_KEY);
    // Copies written before the version tag existed.
    localStorage.removeItem("pos_bootstrap_cache");
    localStorage.removeItem("pos_bootstrap_cache_at");
  } catch {
    // private browsing — nothing to clear
  }
}

/**
 * Save the copy for `merchantId`.
 *
 * Returns `false` when the browser refused the write. Callers surface that so
 * the merchant learns the till will have no offline menu instead of finding out
 * mid-outage.
 */
export function saveSavedBootstrap(
  merchantId: number | null | undefined,
  data: PosBootstrapResponse,
): boolean {
  const key = storageKey(merchantId);
  if (!key) return false;
  const envelope: Envelope = { v: SCHEMA_VERSION, data, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(key, JSON.stringify(envelope));
    localStorage.removeItem(LAST_MERCHANT_KEY);
    localStorage.setItem(LAST_MERCHANT_KEY, String(merchantId));
    return true;
  } catch {
    // Almost always QuotaExceededError: the copy carries every menu item, both
    // order lists and the full table map, which outgrows localStorage on a
    // large menu. Trim the copy rather than leaving the till with none.
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...envelope,
          data: { ...data, recent_orders: [], incoming_orders: [] },
        } satisfies Envelope),
      );
      localStorage.setItem(LAST_MERCHANT_KEY, String(merchantId));
      return true;
    } catch {
      return false;
    }
  }
}

/** The merchant the till last synced, or null when it has never synced. */
export function savedMerchantId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_MERCHANT_KEY);
    const id = raw === null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/** The copy saved for `merchantId`, or null when there is none to use. */
export function loadSavedBootstrap(merchantId: number | null | undefined): SavedBootstrap | null {
  const key = storageKey(merchantId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed?.v !== SCHEMA_VERSION || !parsed.data) return null;
    return { data: parsed.data, savedAt: parsed.savedAt || new Date(0).toISOString() };
  } catch {
    return null;
  }
}
