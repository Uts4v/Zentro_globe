/**
 * Normalization is where API shapes stop: variants and add-ons are split here
 * and nowhere else.
 * Run with: npm run test:voice
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchBatchKey,
  initialBatchKey,
  kotBatchUuid,
  newestKot,
  orderEventFromKot,
  orderEventFromOrder,
} from "./normalize.ts";
import type { KitchenOrderTicketSnapshot, PosOrder } from "../api";

function order(overrides: Partial<PosOrder> = {}): PosOrder {
  return {
    uuid: "o1",
    source: "table_qr",
    table_number_snapshot: 8,
    table_name_snapshot: "",
    customer_name: "Jane Doe",
    notes: "",
    items: [
      {
        id: 1,
        menu_item: 10,
        name: "Pizza",
        price: "0",
        quantity: 2,
        subtotal: "0",
        special_instructions: "no onions",
        options: [
          { group_name: "Size", option_name: "Large", kind: "variant" },
          { group_name: "Extras", option_name: "Cheese", kind: "modifier" },
        ],
      },
    ],
    ...(overrides as object),
  } as unknown as PosOrder;
}

function kot(overrides: Partial<KitchenOrderTicketSnapshot> = {}): KitchenOrderTicketSnapshot {
  return {
    id: 1,
    uuid: "k1",
    kot_number: 1,
    status: "pending",
    notes: "",
    table_number_snapshot: 8,
    items_data: [
      {
        name: "Fries",
        quantity: 1,
        special_instructions: "",
        options: [{ group_name: "Extras", option_name: "Salt" }],
      },
    ],
    created_at: "",
    ...(overrides as object),
  } as KitchenOrderTicketSnapshot;
}

test("initial order splits options by kind from the order items", () => {
  const event = orderEventFromOrder(order());
  assert.equal(event.kind, "initial");
  assert.equal(event.batchKey, initialBatchKey("o1"));
  assert.equal(event.lines[0].variant[0], "Large");
  assert.equal(event.lines[0].addOns[0], "Cheese");
  assert.equal(event.lines[0].special_instructions, "no onions");
});

test("kots without a kind are treated as add-ons, never dropped", () => {
  const event = orderEventFromKot(order(), kot());
  assert.equal(event.kind, "batch");
  assert.equal(event.batchKey, batchBatchKey("o1", kot()));
  assert.equal(event.lines[0].addOns[0], "Salt");
});

test("the newest kot drives the local-batch identity", () => {
  const o = order({
    kots: [kot({ uuid: "k1", kot_number: 1 }), kot({ uuid: "k2", kot_number: 2 })],
  });
  assert.equal(newestKot(o)?.uuid, "k2");
  assert.equal(kotBatchUuid(kot({ uuid: "", kot_number: 5 })), "kot:5");
});

test("missing kots degrade gracefully", () => {
  assert.equal(newestKot(order({ kots: undefined })), null);
  assert.deepEqual(orderEventFromOrder(order({ kots: undefined })).lines.length, 1);
});
