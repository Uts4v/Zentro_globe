/**
 * Selected-cart-line → server order-line mapping for targeted discounts.
 *
 * Run with: npm run test:discount-targets
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapCartLineKeysToOrderItemIds } from "./discount-targets.ts";

const cart = [{ key: "coffee" }, { key: "pizza" }, { key: "water" }];

test("new lines map to the tail of an existing bill", () => {
  const orderItems = [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }];

  assert.deepEqual(mapCartLineKeysToOrderItemIds(orderItems, cart, ["pizza", "water"]), {
    ids: [13, 14],
    missing: [],
  });
});

test("a fresh order maps every cart line in order", () => {
  const orderItems = [{ id: 21 }, { id: 22 }, { id: 23 }];

  assert.deepEqual(mapCartLineKeysToOrderItemIds(orderItems, cart, ["coffee", "water"]), {
    ids: [21, 23],
    missing: [],
  });
});

test("duplicate selections produce one order item id", () => {
  const orderItems = [{ id: 31 }, { id: 32 }, { id: 33 }];

  assert.deepEqual(mapCartLineKeysToOrderItemIds(orderItems, cart, ["pizza", "pizza"]), {
    ids: [32],
    missing: [],
  });
});

test("a removed cart line is reported instead of being silently dropped", () => {
  const currentCart = [{ key: "coffee" }, { key: "pizza" }];
  const orderItems = [{ id: 41 }, { id: 42 }, { id: 43 }];

  assert.deepEqual(mapCartLineKeysToOrderItemIds(orderItems, currentCart, ["pizza", "water"]), {
    ids: [43],
    missing: ["water"],
  });
});

test("a server response shorter than the cart maps nothing", () => {
  assert.deepEqual(mapCartLineKeysToOrderItemIds([{ id: 51 }], cart, ["coffee"]), {
    ids: [],
    missing: ["coffee"],
  });
});
