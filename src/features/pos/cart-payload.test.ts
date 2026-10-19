/**
 * Cart → request payload mapping, including ad-hoc custom lines.
 *
 * Run with: npm run test:cart-payload
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cartToOfferLines, cartToOrderItems, type PosOrderItem } from "./cart-payload.ts";

function line(overrides: Partial<PosOrderItem> = {}): PosOrderItem {
  return {
    key: "menu:1",
    menu_item_id: 1,
    name: "Latte",
    price: 200,
    quantity: 1,
    subtotal: 200,
    selections: [{ group_id: 2, option_id: 3 }],
    special_instructions: "",
    ...overrides,
  };
}

test("a normal line keeps its menu item and selections", () => {
  const [payload] = cartToOrderItems([line({ special_instructions: "no sugar" })]);
  assert.deepEqual(payload, {
    menu_item_id: 1,
    quantity: 1,
    selections: [{ group_id: 2, option_id: 3 }],
    special_instructions: "no sugar",
  });
});

test("a custom line carries its own name and price, not a menu item", () => {
  const [payload] = cartToOrderItems([
    line({
      key: "custom:abc",
      menu_item_id: null,
      name: "Off-menu special",
      price: 350,
      quantity: 2,
      subtotal: 700,
      selections: [],
      is_custom: true,
    }),
  ]);
  assert.deepEqual(payload, {
    is_custom: true,
    name: "Off-menu special",
    price: 350,
    quantity: 2,
    special_instructions: "",
  });
});

test("a free flag rides along with either kind of line", () => {
  const [custom, normal] = cartToOrderItems([
    line({ key: "custom:a", menu_item_id: null, is_custom: true, is_free: true }),
    line({ is_free: true }),
  ]);
  assert.equal(custom.is_free, true);
  assert.equal(normal.is_free, true);
});

test("offers are checked against menu lines only", () => {
  const lines = cartToOfferLines([
    line(),
    line({ key: "custom:a", menu_item_id: null, is_custom: true }),
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].menu_item_id, 1);
});
