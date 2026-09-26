/**
 * Minimal IndexedDB wrapper for POS offline storage.
 * Stores orders, payments, and sync queue items.
 */

const DB_NAME = "zentro-pos";
const DB_VERSION = 1;

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
  server_order_id?: number;
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
  type: "order" | "payment" | "discount" | "credit_sale" | "credit_repayment" | "debit_topup" | "debit_purchase" | "debit_adjustment";
  endpoint: string;
  method: "POST" | "PATCH" | "PUT";
  body: Record<string, any>;
  client_mutation_id: string;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
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
  markSynced: async (clientId: string, serverId: number) => {
    const order = await getById<OfflineOrder>("orders", clientId);
    if (order) {
      order.status = "synced";
      order.server_order_id = serverId;
      await put("orders", order);
    }
  },
  markFailed: async (clientId: string, error: string) => {
    const order = await getById<OfflineOrder>("orders", clientId);
    if (order) {
      order.status = "failed";
      await put("orders", order);
    }
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
};

// ── Sync Queue ──────────────────────────────────────────────────────────────

export const syncQueue = {
  getAll: () => getAll<SyncQueueItem>("sync_queue"),
  get: (id: string) => getById<SyncQueueItem>("sync_queue", id),
  add: (item: SyncQueueItem) => put("sync_queue", item),
  remove: (id: string) => remove("sync_queue", id),
  getPending: async () => {
    const all = await getAll<SyncQueueItem>("sync_queue");
    return all.filter((s) => s.status === "pending" || s.status === "failed");
  },
  markSyncing: async (id: string) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) {
      item.status = "syncing";
      item.attempts += 1;
      await put("sync_queue", item);
    }
  },
  markFailed: async (id: string, error: string, nextRetryAt?: number) => {
    const item = await getById<SyncQueueItem>("sync_queue", id);
    if (item) {
      item.status = "failed";
      item.last_error = error;
      if (nextRetryAt) {
        item.next_retry_at = nextRetryAt;
      }
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
};
