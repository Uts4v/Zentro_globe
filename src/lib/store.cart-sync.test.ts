/**
 * Regression guards for cart <-> merchant consistency:
 *  - switching merchants discards the previous merchant's cart
 *  - pruneCart drops lines whose item is no longer on the current menu
 *
 * These are the two mechanisms that stop a persisted cart from showing a
 * phantom badge/total after scanning a table QR.
 *
 * Run with: bun test src/lib/store.cart-sync.test.ts
 * (Bun resolves the "@/" path alias; plain `node --test` does not.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// zustand's persist middleware defaults to `window.localStorage`, which Bun
// lacks. Provide an in-memory shim BEFORE importing the store so it hydrates
// cleanly (no "storage is currently unavailable" warnings).
const memory = new Map<string, string>();
const localStorageShim = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageShim,
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: localStorageShim },
});

const { useStore, cartCount, cartTotals } = await import("@/lib/store");

function reset() {
  useStore.setState({ cart: [], selectedMerchantId: null });
}

test("setSelectedMerchant clears the cart when the merchant changes", () => {
  reset();
  useStore.getState().setSelectedMerchant("A");
  useStore.getState().addLine({ itemId: "1", qty: 2, unitPrice: 100 });
  assert.equal(useStore.getState().cart.length, 1);

  useStore.getState().setSelectedMerchant("B");
  assert.equal(useStore.getState().cart.length, 0);
});

test("setSelectedMerchant keeps the cart for the same merchant", () => {
  reset();
  useStore.getState().setSelectedMerchant("A");
  useStore.getState().addLine({ itemId: "1", qty: 2, unitPrice: 100 });
  useStore.getState().setSelectedMerchant("A");
  assert.equal(useStore.getState().cart.length, 1);
});

test("setSelectedMerchant does not clear a cart when none was bound yet", () => {
  reset();
  // A cart can exist transiently with no merchant recorded (null). Selecting a
  // merchant must not wipe it.
  useStore.getState().addLine({ itemId: "1", qty: 1, unitPrice: 10 });
  useStore.getState().setSelectedMerchant("A");
  assert.equal(useStore.getState().cart.length, 1);
});

test("pruneCart drops lines not on the menu and keeps the rest", () => {
  reset();
  useStore.getState().setSelectedMerchant("A");
  useStore.getState().addLine({ itemId: "1", qty: 1, unitPrice: 50 });
  useStore.getState().addLine({ itemId: "2", qty: 1, unitPrice: 75 });

  useStore.getState().pruneCart(new Set(["1"]));

  const cart = useStore.getState().cart;
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, "1");
});

test("pruneCart is a no-op (same reference) when every line is valid", () => {
  reset();
  useStore.getState().setSelectedMerchant("A");
  useStore.getState().addLine({ itemId: "1", qty: 1, unitPrice: 50 });

  const before = useStore.getState().cart;
  useStore.getState().pruneCart(new Set(["1"]));
  const after = useStore.getState().cart;

  assert.equal(after.length, 1);
  assert.equal(before, after, "no state churn when nothing is pruned");
});

test("cartCount and cartTotals reflect qty and stored unit price", () => {
  reset();
  useStore.getState().setSelectedMerchant("A");
  useStore.getState().addLine({ itemId: "1", qty: 2, unitPrice: 100 });
  useStore.getState().addLine({ itemId: "2", qty: 3, unitPrice: 25 });

  const cart = useStore.getState().cart;
  assert.equal(cartCount(cart), 5);
  assert.equal(cartTotals(cart), 2 * 100 + 3 * 25);
});

test("phantom cart for a previous merchant clears after scanning a table QR", () => {
  reset();
  // A stale cart belonging to a different merchant: 2 lines, 2 items, ₹370.
  // The badge/total count them even though the cart list renders nothing,
  // because those item ids are not in the menu that just loaded.
  useStore.setState({
    selectedMerchantId: "old-merchant",
    cart: [
      {
        key: "x1",
        itemId: "9001",
        qty: 1,
        selections: [],
        specialInstructions: "",
        unitPrice: 250,
      },
      {
        key: "x2",
        itemId: "9002",
        qty: 1,
        selections: [],
        specialInstructions: "",
        unitPrice: 120,
      },
    ],
  });
  assert.equal(cartCount(useStore.getState().cart), 2);
  assert.equal(cartTotals(useStore.getState().cart), 370);

  // Exact sequence the table page runs once the QR resolves + menu loads:
  useStore.getState().setSelectedMerchant("new-merchant");
  useStore.getState().pruneCart(new Set(["1", "2", "3"]));

  assert.equal(useStore.getState().cart.length, 0);
  assert.equal(cartCount(useStore.getState().cart), 0);
  assert.equal(cartTotals(useStore.getState().cart), 0);
});

test("pruneCart keeps valid lines while dropping a stale one (same merchant)", () => {
  reset();
  useStore.getState().setSelectedMerchant("m1");
  useStore.getState().addLine({ itemId: "1", qty: 2, unitPrice: 100 });
  useStore.getState().addLine({ itemId: "9001", qty: 1, unitPrice: 250 });

  // Same merchant on reload → merchant switch does NOT clear; prune must.
  useStore.getState().setSelectedMerchant("m1");
  assert.equal(useStore.getState().cart.length, 2);

  useStore.getState().pruneCart(new Set(["1"]));

  const cart = useStore.getState().cart;
  assert.equal(cart.length, 1);
  assert.equal(cart[0].itemId, "1");
  assert.equal(cartCount(cart), 2);
  assert.equal(cartTotals(cart), 200);
});

test("a persisted phantom cart rehydrates, then clears once the menu is known", async () => {
  reset();
  // Simulate a fresh page load reading a stale cart back out of localStorage
  // (persist name "zentro-store"). This is the true reported repro.
  memory.set(
    "zentro-store",
    JSON.stringify({
      state: {
        cart: [
          {
            key: "p1",
            itemId: "9001",
            qty: 1,
            selections: [],
            specialInstructions: "",
            unitPrice: 250,
          },
          {
            key: "p2",
            itemId: "9002",
            qty: 1,
            selections: [],
            specialInstructions: "",
            unitPrice: 120,
          },
        ],
        selectedMerchantId: "old-merchant",
      },
      version: 0,
    }),
  );
  await useStore.persist.rehydrate();

  assert.equal(cartCount(useStore.getState().cart), 2); // phantom badge visible

  useStore.getState().setSelectedMerchant("new-merchant");
  useStore.getState().pruneCart(new Set(["1", "2"]));

  assert.equal(cartCount(useStore.getState().cart), 0);
  assert.equal(cartTotals(useStore.getState().cart), 0);
});
