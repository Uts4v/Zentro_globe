/**
 * Minimal IndexedDB wrapper for POS offline storage.
 * Stores orders, payments, and sync queue items.
 */

import type { PosReceiptData, PosOrder } from "../api";

const DB_NAME = "zentro-pos";
const DB_VERSION = 1;

/**
 * Kitchen ticket rendered on the client for an offline order.
 * Declared structurally to keep this module free of UI imports.
 */
export interface OfflineKOTItem {
  name: string;
  quantity: number;
  special_instructions?: string;
  options?: Array<{ group_name: string; option_name: string }>;
}

export interface OfflineKOT {
  merchantName: string;
  kotNumber?: number | null;
  orderNumber: string;
  createdAt: string | null;
  fulfillmentType: string;
  tableName?: string | null;
  tableNumber?: number | null;
  customerName?: string | null;
  workerName?: string | null;
  notes?: string;
  items: OfflineKOTItem[];
}

export interface OfflineOrder {
  id: string; // client-generated UUID
  merchant_id: number;
  items: Array<{ menu_item_id: number; quantity: number }>;
  notes: string;
  fulfillment_type: string;
  table_id?: number | null;
  customer_id?: number | null;
  shift_id?: string;
  worker_id: string;
  device_id: string;
  // Cart snapshot for display
  cart_snapshot: Array<{
    name: string;
    price: number;
    quantity: number;
    subtotal: number;
  }>;
  total: number;
  status: "pending_sync" | "syncing" | "synced" | "failed";
  order_status?: string;
  server_order_id?: number;
  /** The server's uuid for this order, known once it has synced. */
  server_order_uuid?: string;
  /** Why the last sync attempt was rejected, so the orders screen can say so. */
  last_error?: string;
  /** Why the server refused this order, when `status` is "failed". */
  sync_error?: string;
  /**
   * Ticket printed for the kitchen at capture time. Kept so it can be
   * reprinted after the sheet closes — nothing else retains the modifier and
   * instruction detail an offline order needs.
   */
  kot?: OfflineKOT;
  /**
   * The bill as captured on this device. The server only has the order once it
   * syncs, so this is the only way to show or print a paper bill for an order
   * taken while offline. Its `payment_status` says whether it has been paid:
   * an order placed without payment carries an unpaid bill.
   */
  bill?: PosReceiptData;
  created_at: string;
}

export interface OfflinePayment {
  id: string;
  order_id: string; // references OfflineOrder.id
  payment_method: string;
  amount: number;
  change_amount: number;
  external_reference?: string;
  shift_id?: string;
  worker_id: string;
  device_id: string;
  status: "pending_sync" | "syncing" | "synced" | "failed";
  server_payment_id?: string;
  created_at: string;
}

export interface SyncQueueItem {
  id: string;
  type: "order" | "payment" | "discount" | "credit_sale" | "credit_repayment" | "debit_topup" | "debit_purchase" | "debit_adjustment" | "order_status";
  endpoint: string;
  method: "POST" | "PATCH" | "PUT";
  body: Record<string, any>;
  client_mutation_id: string;
  /**
   * `dead` means the automatic retries are spent. It is excluded from
   * `getPending` so the background loop stops hitting an endpoint that will
   * never accept this body, and it needs a deliberate retry from the sync bar.
   */
  status: "pending" | "syncing" | "failed" | "dead";
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
  /**
   * The server refused this exact request, so sending it again unchanged will
   * not help. It stays queued (nothing is thrown away) but is only retried
   * when staff ask for it.
   */
  needs_attention?: boolean;
  created_at: string;
}

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("orders")) {
        const orderStore = db.createObjectStore("orders", { keyPath: "id" });
        orderStore.createIndex("status", "status", { unique: false });
        orderStore.createIndex("created_at", "created_at", { unique: false });
      }

      if (!db.objectStoreNames.contains("payments")) {
        const paymentStore = db.createObjectStore("payments", { keyPath: "id" });
        paymentStore.createIndex("order_id", "order_id", { unique: false });
        paymentStore.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("sync_queue")) {
        const syncStore = db.createObjectStore("sync_queue", { keyPath: "id" });
        syncStore.createIndex("status", "status", { unique: false });
        syncStore.createIndex("type", "type", { unique: false });
      }

      if (!db.objectStoreNames.contains("menu_cache")) {
        db.createObjectStore("menu_cache", { keyPath: "merchant_id" });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

// ── Generic helpers ──────────────────────────────────────────────────────────

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function getById<T>(storeName: string, id: IDBValidKey): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function put<T>(storeName: string, item: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function remove(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function clearStore(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────

export const offlineOrders = {
  getAll: () => getAll<OfflineOrder>("orders"),
  get: (id: string) => getById<OfflineOrder>("orders", id),
  save: (order: OfflineOrder) => put("orders", order),
  remove: (id: string) => remove("orders", id),
  getPending: async () => {
    const all = await getAll<OfflineOrder>("orders");
    return all.filter((o) => o.status === "pending_sync" || o.status === "failed");
  },
  markSynced: async (clientId: string, serverId: number, serverUuid?: string) => {
    const order = await getById<OfflineOrder>("orders", clientId);
    if (order) {
      order.status = "synced";
      order.server_order_id = serverId;
      if (serverUuid) order.server_order_uuid = serverUuid;
      delete order.last_error;
      delete order.sync_error;
      await put("orders", order);
    }
  },
  markFailed: async (clientId: string, error: string) => {
    const order = await getById<OfflineOrder>("orders", clientId);
    if (order) {
      order.status = "failed";
      order.last_error = error;
      order.sync_error = error;
      await put("orders", order);
    }
  },
  updateStatus: async (clientId: string, newStatus: string) => {
    const order = await getById<OfflineOrder>("orders", clientId);
    if (order) {
      order.order_status = newStatus;
      await put("orders", order);
    }
  },
};

// ── Cached Server Orders (Offline Mirror) ───────────────────────────────────

const CACHED_ORDERS_KEY = "zentro_pos_cached_orders";

export const cachedServerOrders = {
  get: (): PosOrder[] => {
    try {
      const raw = localStorage.getItem(CACHED_ORDERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },
  save: (orders: PosOrder[]): void => {
    try {
      localStorage.setItem(CACHED_ORDERS_KEY, JSON.stringify(orders.slice(0, 100)));
    } catch {}
  },
  update: (uuid: string, changes: Partial<PosOrder>): void => {
    try {
      const orders = cachedServerOrders.get();
      cachedServerOrders.save(orders.map((o) => (o.uuid === uuid ? { ...o, ...changes } : o)));
    } catch {}
  },
  updateStatus: (uuid: string, status: string): void => {
    cachedServerOrders.update(uuid, { status });
  },
};

// ── Payments ────────────────────────────────────────────────────────────────

export const offlinePayments = {
  getAll: () => getAll<OfflinePayment>("payments"),
  get: (id: string) => getById<OfflinePayment>("payments", id),
  save: (payment: OfflinePayment) => put("payments", payment),
  remove: (id: string) => remove("payments", id),
  getByOrder: async (orderId: string) => {
    const all = await getAll<OfflinePayment>("payments");
    return all.filter((p) => p.order_id === orderId);
  },
  getPending: async () => {
    const all = await getAll<OfflinePayment>("payments");
    return all.filter((p) => p.status === "pending_sync" || p.status === "failed");
  },
  markSynced: async (clientId: string, serverId: string) => {
    const payment = await getById<OfflinePayment>("payments", clientId);
    if (payment) {
      payment.status = "synced";
      payment.server_payment_id = serverId;
      await put("payments", payment);
    }
  },
  markFailed: async (clientId: string) => {
    const payment = await getById<OfflinePayment>("payments", clientId);
    if (payment) {
      payment.status = "failed";
      await put("payments", payment);
    }
  },
};

// ── Sync Queue ──────────────────────────────────────────────────────────────

export const syncQueue = {
  getAll: () => getAll<SyncQueueItem>("sync_queue"),
  get: (id: string) => getById<SyncQueueItem>("sync_queue", id),
  add: (item: SyncQueueItem) => put("sync_queue", item),
  remove: (id: string) => remove("sync_queue", id),
  getPending: () => getAll<SyncQueueItem>("sync_queue"),
  getDead: async () => {
    const all = await getAll<SyncQueueItem>("sync_queue");
    return all.filter((s) => s.status === "dead");
  },
  recoverInterrupted: async () => {
    const all = await getAll<SyncQueueItem>("sync_queue");
    const stuck = all.filter((s) => s.status === "syncing");
    for (const item of stuck) {
      await put("sync_queue", { ...item, status: "pending" as const });
    }
    return stuck.length;
  },
  markSyncing: async (id: string) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) {
      item.status = "syncing";
      await put("sync_queue", item);
    }
  },
  markFailed: async (id: string, error: string, nextRetryAt?: number) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) {
      item.status = "failed";
      item.attempts = (item.attempts ?? 0) + 1;
      item.last_error = error;
      item.next_retry_at = nextRetryAt;
      await put("sync_queue", item);
    }
  },
  update: async (id: string, changes: Partial<SyncQueueItem>) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) await put("sync_queue", { ...item, ...changes });
  },
  markDead: async (id: string, error: string) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) {
      item.status = "dead";
      item.last_error = error;
      delete item.next_retry_at;
      await put("sync_queue", item);
    }
  },
  clear: () => clearStore("sync_queue"),
};

// ── Menu Cache ──────────────────────────────────────────────────────────────

export const menuCache = {
  save: (merchantId: number, data: any) =>
    put("menu_cache", { merchant_id: merchantId, data, cached_at: new Date().toISOString() }),
  get: async (merchantId: number) => {
    const item = await getById<any>("menu_cache", merchantId);
    return item?.data ?? null;
  },
  clear: () => clearStore("menu_cache"),
};

// ── Offline data that is not a cache ─────────────────────────────────────────

/**
 * Orders and payments that have not reached the server.
 *
 * These are not cached copies of anything — they are the only record of sales
 * this terminal has taken, so "clear cache" must never reach them by accident.
 * Clearing is a separate, explicitly requested action.
 */
export const offlineSales = {
  pendingCount: async (): Promise<number> => {
    const [orders, payments] = await Promise.all([
      offlineOrders.getPending(),
      offlinePayments.getPending(),
    ]);
    return orders.length + payments.length;
  },
  /**
   * Discard every unsynced order, payment and queued mutation on this device.
   * Those sales are then gone for good — the server never saw them.
   */
  discardAll: async (): Promise<void> => {
    await Promise.all([clearStore("orders"), clearStore("payments"), clearStore("sync_queue")]);
  },
};
