/**
 * Flattens API payloads into the announcement pipeline's own `OrderEvent`.
 *
 * Two entry points:
 *  - `orderEventFromOrder`  — a brand-new order (uses the order's item lines).
 *  - `orderEventFromKot`    — items added later (uses that KOT's item snapshot).
 *
 * Options are split by their snapshotted `kind`. When the snapshot predates the
 * `kind` field (or a KOT was stored before the field existed) every option is
 * treated as an add-on rather than guessed at — names are never lost, only the
 * variant/add-on split degrades.
 */

import type { KitchenOrderTicketSnapshot, PosOrder } from "../api";
import type { NormalizedLine, OrderEvent } from "./types";

type RawOption = { option_name?: string; kind?: string };

function splitOptions(options?: RawOption[]): { variant: string[]; addOns: string[] } {
  const variant: string[] = [];
  const addOns: string[] = [];
  for (const option of options ?? []) {
    const name = (option?.option_name ?? "").trim();
    if (!name) continue;
    if ((option.kind ?? "modifier") === "variant") variant.push(name);
    else addOns.push(name);
  }
  return { variant, addOns };
}

export function orderKots(order: PosOrder): KitchenOrderTicketSnapshot[] {
  return Array.isArray(order.kots) ? order.kots : [];
}

/** The most recent ordering event on an order, by KOT number. */
export function newestKot(order: PosOrder): KitchenOrderTicketSnapshot | null {
  const kots = orderKots(order);
  if (kots.length === 0) return null;
  return kots.reduce((latest, kot) =>
    (kot.kot_number ?? 0) >= (latest.kot_number ?? 0) ? kot : latest,
  );
}

export function kotBatchUuid(kot: KitchenOrderTicketSnapshot): string {
  return kot.uuid || `kot:${kot.kot_number}`;
}

export function initialBatchKey(orderUuid: string): string {
  return `order:${orderUuid}:initial`;
}

export function batchBatchKey(orderUuid: string, kot: KitchenOrderTicketSnapshot): string {
  return `order:${orderUuid}:batch:${kotBatchUuid(kot)}`;
}

export function orderEventFromOrder(order: PosOrder): OrderEvent {
  const lines: NormalizedLine[] = (order.items ?? []).map((item) => {
    const { variant, addOns } = splitOptions(item.options);
    return {
      name: (item.name ?? "").trim(),
      quantity: item.quantity ?? 1,
      variant,
      addOns,
      special_instructions: item.special_instructions ?? "",
    };
  });

  return {
    kind: "initial",
    orderUuid: order.uuid,
    batchUuid: order.uuid,
    batchKey: initialBatchKey(order.uuid),
    source: order.source,
    tableNumber: order.table_number_snapshot ?? null,
    tableName: (order.table_name_snapshot ?? "").trim() || null,
    customerName: order.customer_name ?? null,
    notes: order.notes ?? "",
    lines,
  };
}

export function orderEventFromKot(order: PosOrder, kot: KitchenOrderTicketSnapshot): OrderEvent {
  const lines: NormalizedLine[] = (kot.items_data ?? []).map((item) => {
    const { variant, addOns } = splitOptions(item.options);
    return {
      name: (item.name ?? "").trim(),
      quantity: item.quantity ?? 1,
      variant,
      addOns,
      special_instructions: item.special_instructions ?? "",
    };
  });

  return {
    kind: "batch",
    orderUuid: order.uuid,
    batchUuid: kotBatchUuid(kot),
    batchKey: batchBatchKey(order.uuid, kot),
    source: order.source,
    tableNumber: kot.table_number_snapshot ?? order.table_number_snapshot ?? null,
    tableName: (kot.table_name_snapshot ?? order.table_name_snapshot ?? "").trim() || null,
    customerName: kot.customer_name_snapshot ?? order.customer_name ?? null,
    notes: kot.notes ?? order.notes ?? "",
    lines,
  };
}
