/**
 * Live table occupancy merge — status API wins, cached orders only fill gaps.
 *
 * Run with: npm run test:table-occupancy
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTableOccupancy } from "./table-occupancy.ts";
import type { PosOrder, PosTableStatus, PosTableStatusBill } from "../api";

function table(id: number, isOccupied: boolean, bill: Partial<PosTableStatusBill> = {}) {
  return {
    id,
    name: `Table ${id}`,
    table_number: id,
    area_id: null,
    area_name: "",
    is_occupied: isOccupied,
    open_bill_count: isOccupied ? 1 : 0,
    bill: isOccupied
      ? {
          id: 100 + id,
          uuid: `bill-${id}`,
          order_number: `#${id}`,
          status: "confirmed",
          payment_status: "unpaid",
          total_amount: "250.00",
          item_count: 2,
          opened_at: "2026-01-01T00:00:00Z",
          ...bill,
        }
      : null,
  } satisfies PosTableStatus;
}

function order(tableId: number, status = "confirmed") {
  return {
    id: tableId,
    uuid: `order-${tableId}`,
    table_id: tableId,
    status,
    total_amount: "100.00",
    customer_name: `Guest ${tableId}`,
  } as unknown as PosOrder;
}

test("a moved bill follows the live status, not stale cached orders", () => {
  const occupancy = buildTableOccupancy(
    [table(1, false), table(2, true, { total_amount: "425.00" })],
    [order(1)],
  );

  assert.equal(occupancy.has(1), false);
  assert.equal(occupancy.get(2)?.amount, "425.00");
});

test("status wins over an order that still points at the old table", () => {
  const occupancy = buildTableOccupancy(
    [table(1, false), table(2, true)],
    [order(1), order(2, "preparing")],
  );

  assert.deepEqual([...occupancy.keys()], [2]);
});

test("orders are a fallback until the status request succeeds", () => {
  const occupancy = buildTableOccupancy([], [order(7), order(8, "completed")]);

  assert.deepEqual([...occupancy.keys()], [7]);
  assert.equal(occupancy.get(7)?.customer, "Guest 7");
});

test("status bill customer name is preferred, order name fills the gap", () => {
  const withName = buildTableOccupancy([table(1, true, { customer_name: "Asha" })], [order(1)]);
  const withoutName = buildTableOccupancy([table(2, true)], [order(2)]);

  assert.equal(withName.get(1)?.customer, "Asha");
  assert.equal(withoutName.get(2)?.customer, "Guest 2");
});
