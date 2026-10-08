import { create } from "zustand";
import { cartKey } from "@/lib/menu-utils";
import { isGatewayError } from "@/lib/connectivity";
import type { MenuSelection } from "@/lib/api/types";
import {
  PosBootstrapResponse,
  PosDevice,
  PosOrder,
  PosReceiptData,
  PosSettings,
  PosTable,
  ShiftWorker,
  CashShift,
  PosMenuSnapshot,
} from "./api";
import { clearAllSavedBootstrap, saveSavedBootstrap } from "./offline/cache";

/**
 * One POS cart line. `key` identifies menu item + selections + instructions so
 * that "Small Latte" and "Large Latte" stay two lines instead of collapsing
 * into one when the cashier taps the same product twice.
 */
type PosOrderItem = {
  key: string;
  menu_item_id: number;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  selections: MenuSelection[];
  special_instructions: string;
  /** Given free by staff: charged nothing, `price` keeps the normal price for display. */
  is_free?: boolean;
};

/**
 * A manual discount chosen for the cart before the order exists. The server
 * applies (and prices) it right after the order is created; the cart only
 * previews it.
 */
export type PendingDiscount = {
  type: "percentage" | "fixed";
  value: number;
  reason: string;
  authorizedByWorkerId?: string;
};

/**
 * A customer's Zentro Offer scanned at the till. The server checked it against
 * the cart (discount below); it is applied to the order right after creation.
 */
export type PendingOffer = {
  code: string;
  claimId: number;
  summary: string;
  customerFirstName: string;
  discount: string;
  /** The server's full pricing of the cart with this offer (exact totals to show). */
  pricing: ServerCartPricing | null;
  /** Cart fingerprint the pricing belongs to; a different cart needs a re-check. */
  cartKey: string;
};

export type ServerCartPricing = {
  subtotal: string;
  discount_total: string;
  taxable_total: string;
  tax_total: string;
  charge_total: string;
  grand_total: string;
  prices_include_tax: boolean;
  taxes: Array<{ name: string; rate: string; amount: string }>;
  charges: Array<{ kind: string; label: string; amount: string; tax: string; taxable: boolean }>;
};

/** Identifies the cart contents an offer check was made for. */
export function cartFingerprint(cart: PosOrderItem[], fulfillmentType: string): string {
  return JSON.stringify([fulfillmentType, cart.map((c) => [c.key, c.quantity])]);
}

/** What callers hand to `addItemToCart`; `key` is derived when omitted. */
export type PosOrderItemInput = Omit<PosOrderItem, "key"> & { key?: string };

/**
 * Build the order payload items for a POS cart.
 *
 * Selections and instructions must travel with every line: the server prices
 * from the submitted selections, so a line sent without them would either be
 * rejected (required group) or priced as the unconfigured base variant.
 */
export function cartToOrderItems(cart: PosOrderItem[]) {
  return cart.map((item) => ({
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    selections: item.selections,
    special_instructions: item.special_instructions,
    ...(item.is_free ? { is_free: true } : {}),
  }));
}

/** Marks a cart line's key as the free copy of that line, so it never merges with a paid one. */
const FREE_SUFFIX = "#free";

/** True when the cart gives at least one item away free. */
export function cartHasFreeItems(cart: PosOrderItem[]): boolean {
  return cart.some((item) => item.is_free);
}

interface PosState {
  merchant: { id: number; business_name: string; slug: string; logo_url: string } | null;
  device: PosDevice | null;
  deviceToken: string | null;
  workers: ShiftWorker[];
  menu: PosMenuSnapshot | null;
  activeShift: CashShift | null;
  posSettings: PosSettings | null;
  currentWorker: ShiftWorker | null;
  incomingOrders: PosOrder[];
  tables: PosTable[];
  /**
   * Set when the POS is showing data saved on this device because the server
   * could not be reached (ISO time the data was saved). Null = live data.
   */
  savedDataFrom: string | null;
  /**
   * Set when the browser refused to save this device's offline copy. The POS
   * still works online; it just has no menu to fall back on, and a merchant
   * cannot act on that unless the POS says so.
   */
  offlineCacheUnavailable: boolean;
  /**
   * When live POS data was last pulled from the server (ISO). Null until the
   * first successful load, and unchanged while the POS is on its saved copy —
   * the cashier needs to be able to see how old the grid actually is.
   */
  lastSyncedAt: string | null;

  cart: PosOrderItem[];
  cartNotes: string;
  fulfillmentType: string;
  selectedTableId: number | null;
  selectedCustomerId: number | null;

  recentOrders: PosOrder[];

  setMerchant: (m: { id: number; business_name: string; slug: string; logo_url: string }) => void;
  setDevice: (d: PosDevice, token: string) => void;
  setWorkers: (w: ShiftWorker[]) => void;
  setMenu: (m: PosMenuSnapshot) => void;
  setActiveShift: (s: CashShift | null) => void;
  setPosSettings: (s: PosSettings) => void;
  setCurrentWorker: (w: ShiftWorker | null) => void;
  setIncomingOrders: (orders: PosOrder[]) => void;

  addItemToCart: (item: PosOrderItemInput) => void;
  updateCartItem: (currentKey: string, item: PosOrderItemInput) => void;
  removeItemFromCart: (idx: number) => void;
  updateCartItemQty: (idx: number, qty: number) => void;
  /** Give a cart line free, or charge it again. */
  setCartItemFree: (idx: number, free: boolean) => void;
  /** PIN entered for free items on this cart (kept in memory only). */
  freeItemPin: string | null;
  setFreeItemPin: (pin: string | null) => void;
  clearCart: () => void;
  setCartNotes: (n: string) => void;
  pendingDiscount: PendingDiscount | null;
  setPendingDiscount: (d: PendingDiscount | null) => void;
  pendingOffer: PendingOffer | null;
  setPendingOffer: (o: PendingOffer | null) => void;
  setFulfillmentType: (t: string) => void;
  setSelectedTable: (id: number | null) => void;
  setSelectedCustomer: (id: number | null) => void;

  setRecentOrders: (orders: PosOrder[]) => void;

  /** `savedAt` marks data loaded from this device's saved copy, not the server. */
  bootstrap: (resp: PosBootstrapResponse, opts?: { savedAt?: string }) => void;
  reset: () => void;
}

const initialState = {
  merchant: null,
  device: null,
  deviceToken: null,
  workers: [],
  menu: null,
  activeShift: null,
  posSettings: null,
  currentWorker: null,
  incomingOrders: [],
  tables: [],
  savedDataFrom: null,
  freeItemPin: null as string | null,
  offlineCacheUnavailable: false,
  lastSyncedAt: null,
  cart: [],
  cartNotes: "",
  pendingDiscount: null,
  pendingOffer: null,
  fulfillmentType: "dine-in",
  selectedTableId: null,
  selectedCustomerId: null,
  recentOrders: [],
};

export const usePosStore = create<PosState>((set, get) => ({
  ...initialState,

  setMerchant: (m) => set({ merchant: m }),
  setDevice: (d, token) => set({ device: d, deviceToken: token }),
  setWorkers: (w) => set({ workers: w }),
  setMenu: (m) => set({ menu: m }),
  setActiveShift: (s) => {
    if (s) {
      localStorage.setItem("pos_active_shift", JSON.stringify(s));
    } else {
      localStorage.removeItem("pos_active_shift");
    }
    // The saved copy is what the POS starts from with no connection. Left
    // alone it would still hold the shift as of the last bootstrap: reopening
    // offline would lose a shift opened since (and with it the order screen),
    // or bring back one that has been closed.
    try {
      const raw = localStorage.getItem("pos_bootstrap_cache");
      if (raw) {
        localStorage.setItem(
          "pos_bootstrap_cache",
          JSON.stringify({ ...JSON.parse(raw), active_shift: s }),
        );
      }
    } catch {
      // quota or private browsing
    }
    set({ activeShift: s });
  },
  setPosSettings: (s) => set({ posSettings: s }),
  setCurrentWorker: (w) => {
    if (w) {
      localStorage.setItem("pos_worker_id", w.id);
      localStorage.setItem("pos_worker", JSON.stringify(w));
    } else {
      localStorage.removeItem("pos_worker_id");
      localStorage.removeItem("pos_worker");
    }
    set({ currentWorker: w });
  },
  setIncomingOrders: (orders) => set({ incomingOrders: orders }),

  addItemToCart: (item) =>
    set((state) => {
      // Match on the full line identity, not just the product: the same drink
      // in a different size or with different add-ons is a different line.
      const key =
        item.key ??
        cartKey(String(item.menu_item_id), item.selections ?? [], item.special_instructions ?? "");
      const line: PosOrderItem = {
        ...item,
        key,
        selections: item.selections ?? [],
        special_instructions: item.special_instructions ?? "",
      };
      const idx = state.cart.findIndex((c) => c.key === key);
      if (idx >= 0) {
        const updated = [...state.cart];
        const merged = {
          ...updated[idx],
          quantity: updated[idx].quantity + line.quantity,
          subtotal: (updated[idx].quantity + line.quantity) * updated[idx].price,
        };
        updated[idx] = merged;
        return { cart: updated };
      }
      return { cart: [...state.cart, line] };
    }),

  updateCartItem: (currentKey, item) =>
    set((state) => {
      const currentIndex = state.cart.findIndex((line) => line.key === currentKey);
      if (currentIndex < 0) return {};

      const key =
        item.key ??
        cartKey(String(item.menu_item_id), item.selections ?? [], item.special_instructions ?? "");
      const line: PosOrderItem = {
        ...item,
        key,
        selections: item.selections ?? [],
        special_instructions: item.special_instructions ?? "",
      };
      const updated = state.cart.filter((_, index) => index !== currentIndex);
      const duplicateIndex = updated.findIndex((existing) => existing.key === key);

      if (duplicateIndex >= 0) {
        const quantity = updated[duplicateIndex].quantity + line.quantity;
        updated[duplicateIndex] = {
          ...line,
          quantity,
          subtotal: quantity * line.price,
        };
      } else {
        updated.splice(currentIndex, 0, line);
      }
      return { cart: updated };
    }),

  removeItemFromCart: (idx) =>
    set((state) => ({
      cart: state.cart.filter((_, i) => i !== idx),
    })),

  updateCartItemQty: (idx, qty) =>
    set((state) => {
      const updated = [...state.cart];
      updated[idx] = {
        ...updated[idx],
        quantity: qty,
        subtotal: qty * updated[idx].price,
      };
      return { cart: updated };
    }),

  setCartItemFree: (idx, free) =>
    set((state) => {
      const line = state.cart[idx];
      if (!line || Boolean(line.is_free) === free) return {};
      const baseKey = line.key.endsWith(FREE_SUFFIX)
        ? line.key.slice(0, -FREE_SUFFIX.length)
        : line.key;
      const key = free ? baseKey + FREE_SUFFIX : baseKey;
      const updated = state.cart.filter((_, i) => i !== idx);
      const twin = updated.findIndex((c) => c.key === key);
      if (twin >= 0) {
        const quantity = updated[twin].quantity + line.quantity;
        updated[twin] = { ...updated[twin], quantity, subtotal: quantity * updated[twin].price };
      } else {
        updated.splice(idx, 0, { ...line, key, is_free: free });
      }
      return { cart: updated, ...(updated.some((c) => c.is_free) ? {} : { freeItemPin: null }) };
    }),
  setFreeItemPin: (pin) => set({ freeItemPin: pin }),

  clearCart: () =>
    set({
      cart: [],
      cartNotes: "",
      selectedTableId: null,
      selectedCustomerId: null,
      pendingDiscount: null,
      pendingOffer: null,
      freeItemPin: null,
    }),
  setCartNotes: (n) => set({ cartNotes: n }),
  // One discount/reward per order (V1): choosing one replaces the other.
  setPendingDiscount: (d) =>
    set(d ? { pendingDiscount: d, pendingOffer: null } : { pendingDiscount: null }),
  setPendingOffer: (o) =>
    set(o ? { pendingOffer: o, pendingDiscount: null } : { pendingOffer: null }),
  setFulfillmentType: (t) => set({ fulfillmentType: t }),
  setSelectedTable: (id) => set({ selectedTableId: id }),
  setSelectedCustomer: (id) => set({ selectedCustomerId: id }),

  setRecentOrders: (orders) => set({ recentOrders: orders }),

  bootstrap: (resp, opts) => {
    // Restore worker from localStorage (validated against server data)
    const savedWorkerId = localStorage.getItem("pos_worker_id");
    const savedWorkerJson = localStorage.getItem("pos_worker");
    let restoredWorker: ShiftWorker | null = null;

    if (savedWorkerId && savedWorkerJson) {
      try {
        const parsed = JSON.parse(savedWorkerJson) as ShiftWorker;
        // Validate the worker still exists and is active. The list only ever
        // contains active employees; older servers did not send `is_active`,
        // so only an explicit `false` counts as inactive.
        const serverWorker = resp.workers.find(
          (w) => w.id === savedWorkerId && w.is_active !== false,
        );
        restoredWorker = serverWorker ? { ...parsed, ...serverWorker } : null;
      } catch {
        restoredWorker = null;
      }
    }
    if (!restoredWorker) {
      localStorage.removeItem("pos_worker_id");
      localStorage.removeItem("pos_worker");
    }

    // Restore active shift from localStorage (validated against server)
    let restoredShift: CashShift | null = null;
    if (resp.active_shift) {
      restoredShift = resp.active_shift;
      localStorage.setItem("pos_active_shift", JSON.stringify(restoredShift));
    } else {
      // No active shift on server, clear any stale localStorage
      localStorage.removeItem("pos_active_shift");
    }

    // Fresh data from the server becomes the saved copy for when the network
    // is down. Data that came FROM the saved copy must not overwrite it, or the
    // till would overwrite a good copy with itself every time it goes offline.
    let cacheUnavailable = false;
    if (!opts?.savedAt) {
      cacheUnavailable = !saveSavedBootstrap(resp.merchant?.id, resp);
    }

    set({
      merchant: resp.merchant,
      device: resp.device,
      deviceToken: null,
      workers: resp.workers,
      menu: resp.menu,
      activeShift: restoredShift,
      posSettings: resp.pos_settings,
      recentOrders: resp.recent_orders,
      incomingOrders: resp.incoming_orders || [],
      tables: resp.tables || [],
      currentWorker: restoredWorker,
      savedDataFrom: opts?.savedAt ?? null,
      offlineCacheUnavailable: cacheUnavailable,
      lastSyncedAt: opts?.savedAt ? get().lastSyncedAt : new Date().toISOString(),
    });
  },

  reset: () => {
    localStorage.removeItem("pos_worker_id");
    localStorage.removeItem("pos_worker");
    localStorage.removeItem("pos_active_shift");
    // A shared till must not hand the next cashier the last one's menu.
    clearAllSavedBootstrap();
    set(initialState);
  },
}));

// ── Saved copy for when the server cannot be reached ─────────────────────────

/**
 * True when a request failed because the server could not be reached (offline,
 * DNS, timeout). A response from the server — even an error — is NOT a
 * connection problem, and must never be papered over with saved data.
 */
export function isConnectionError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const status = (err as { status?: unknown } | null)?.status;
  // A proxy's "bad gateway" is the proxy talking, not the server.
  return typeof status !== "number" || isGatewayError(status);
}
