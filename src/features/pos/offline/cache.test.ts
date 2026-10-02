/**
 * The POS's saved copy is the only thing that keeps a till selling when the
 * server is unreachable, so the three ways it can go wrong all have to hold:
 *
 *   - a till handed between merchants must never serve the old merchant's menu
 *   - a write the browser refuses must be reported, not swallowed into a
 *     "offline POS has no menu" mystery
 *   - clearing the cache must reach every copy, not just the current one
 *
 * Run with: npm run test:offline-cache
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// Type-only, so the runtime graph stays limited to `cache.ts`: the API module
// pulls in the Django client, which needs a browser.
import type { PosBootstrapResponse, PosMenuSnapshot, PosOrder } from "../api";

/**
 * Loaded dynamically so each test can install its own `localStorage` first.
 * Node has no web storage, and this module reads it on every call.
 */
const cache = await import("./cache.ts");

/** Minimal `Storage`, with an optional byte budget to simulate a full quota. */
function fakeStorage(limitBytes = Infinity) {
  const map = new Map<string, string>();
  return {
    limitBytes,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem(k: string, v: string) {
      if (k.length + v.length > limitBytes) {
        // QuotaExceededError
        const err = new Error("quota") as Error & { name: string };
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    // test helper
    _dump: () => Object.fromEntries(map),
  };
}

type FakeStorage = ReturnType<typeof fakeStorage>;

function useStorage(store: FakeStorage) {
  (globalThis as { localStorage?: unknown }).localStorage = store;
  return store;
}

/**
 * A bootstrap payload shaped like the POS one, with `merchantId` naming the
 * owner. Only the fields these tests look at are filled in.
 */
function bootstrap(merchantId: number, itemNames: string[]): PosBootstrapResponse {
  // `map` hands over (value, index) in that order.
  const item = (name: string, i: number) =>
    ({ id: i + 1, name }) as PosMenuSnapshot["categories"][string][number];
  return {
    merchant: { id: merchantId, business_name: `Shop ${merchantId}`, slug: "s", logo_url: "" },
    device: { id: "d1" },
    workers: [],
    tables: [],
    active_shift: null,
    pos_settings: {},
    menu: {
      snapshot_at: "2026-01-01T00:00:00Z",
      total_items: itemNames.length,
      categories: { Mains: itemNames.map(item) },
    },
    recent_orders: [],
    incoming_orders: [],
  } as unknown as PosBootstrapResponse;
}

/** The dish names in a saved copy's menu, for a readable assertion. */
function dishNames(saved: ReturnType<typeof cache.loadSavedBootstrap>): string[] {
  return (saved?.data.menu.categories.Mains ?? []).map((dish) => dish.name);
}

test("a saved copy is only ever returned to the merchant that saved it", () => {
  useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();

  cache.saveSavedBootstrap(7, bootstrap(7, ["Momos"]));
  cache.saveSavedBootstrap(9, bootstrap(9, ["Samosa"]));

  assert.deepEqual(dishNames(cache.loadSavedBootstrap(7)), ["Momos"]);
  assert.deepEqual(dishNames(cache.loadSavedBootstrap(9)), ["Samosa"]);
});

test("a device that has never synced has no copy to fall back on", () => {
  useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();
  assert.equal(cache.loadSavedBootstrap(7), null);
  assert.equal(cache.savedMerchantId(), null);
});

test("the till remembers which merchant it synced, so it can load offline", () => {
  useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();
  cache.saveSavedBootstrap(42, bootstrap(42, ["Thukpa"]));
  assert.equal(cache.savedMerchantId(), 42);
  assert.equal(cache.loadSavedBootstrap(cache.savedMerchantId())?.data.merchant.id, 42);
});

test("a write the browser refuses is reported, not silently dropped", () => {
  // The regression this guards: a swallowed QuotaExceededError looks exactly
  // like an offline terminal with no menu, and nobody can debug that.
  const store = useStorage(fakeStorage(200));
  cache.clearAllSavedBootstrap();
  const big = bootstrap(
    1,
    Array.from({ length: 40 }, (_, i) => `Dish number ${i}`),
  );

  assert.equal(cache.saveSavedBootstrap(1, big), false);
  // Nothing half-written is left behind for the next load to trust.
  assert.equal(cache.loadSavedBootstrap(1), null);
  assert.equal(store.getItem("zentro_pos_last_merchant"), null);
});

test("a copy too big to save is trimmed and saved, so the till keeps a menu", () => {
  // Order lists are the bulk of the payload and are re-fetched on connect;
  // the menu and tables are the part that has to survive an outage.
  const store = useStorage(fakeStorage(1400));
  cache.clearAllSavedBootstrap();
  const payload = bootstrap(3, ["A"]);
  const bulky = Array.from({ length: 60 }, (_, i) => ({ uuid: `o${i}` })) as unknown as PosOrder[];
  payload.recent_orders = bulky;
  payload.incoming_orders = bulky;

  assert.equal(cache.saveSavedBootstrap(3, payload), true);
  const saved = cache.loadSavedBootstrap(3);
  assert.ok(saved, "a trimmed copy is better than no copy");
  assert.equal(saved.data.menu.categories.Mains.length, 1);
  assert.deepEqual(saved.data.recent_orders, []);
});

test("a successful save records when it happened", () => {
  useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();
  cache.saveSavedBootstrap(5, bootstrap(5, []));
  const savedAt = cache.loadSavedBootstrap(5)?.savedAt;
  assert.ok(savedAt && !Number.isNaN(Date.parse(savedAt)), `unusable savedAt: ${savedAt}`);
});

test("clearing reaches every merchant's copy, not just the current one", () => {
  const store = useStorage(fakeStorage());
  cache.saveSavedBootstrap(1, bootstrap(1, ["A"]));
  cache.saveSavedBootstrap(2, bootstrap(2, ["B"]));

  cache.clearAllSavedBootstrap();

  assert.equal(cache.loadSavedBootstrap(1), null);
  assert.equal(cache.loadSavedBootstrap(2), null);
  assert.equal(cache.savedMerchantId(), null);
  // The pre-versioning keys are cleared too, or an old copy would be revived.
  store.setItem("pos_bootstrap_cache", "{}");
  cache.clearAllSavedBootstrap();
  assert.equal(store.getItem("pos_bootstrap_cache"), null);
});

test("a copy written by an older build is ignored, not misread", () => {
  const store = useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();
  store.setItem(
    "zentro_pos_bootstrap.1.7",
    JSON.stringify({ v: 1, data: bootstrap(7, ["Old"]), savedAt: "2020-01-01T00:00:00Z" }),
  );

  assert.equal(cache.loadSavedBootstrap(7), null);
});

test("a corrupt copy reads as no copy rather than crashing the POS", () => {
  const store = useStorage(fakeStorage());
  cache.clearAllSavedBootstrap();
  cache.saveSavedBootstrap(8, bootstrap(8, ["Good"]));
  const key = Object.keys(store._dump()).find((k) => k.includes(".8"))!;
  store.setItem(key, "{not json");

  assert.equal(cache.loadSavedBootstrap(8), null);
});

test("storage that throws entirely (private browsing) is survivable", () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    length: 0,
    key: () => null,
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
    clear: () => {},
  };

  assert.doesNotThrow(() => cache.clearAllSavedBootstrap());
  assert.equal(cache.loadSavedBootstrap(1), null);
  assert.equal(cache.saveSavedBootstrap(1, bootstrap(1, [])), false);
  assert.equal(cache.savedMerchantId(), null);
});
