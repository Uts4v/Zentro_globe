/**
 * Shapes shared by the voice-announcement pipeline.
 *
 * The engine only ever sees an `OrderEvent`; API payloads (an order list row or
 * a KOT snapshot) are flattened into this by `normalize.ts` so no other module
 * has to know which serializer field carried a variant or an add-on.
 */

export type OrderEventKind = "initial" | "batch";

/** Who a change should be attributed to, once source and local origin are known. */
export type Actor = "customer_remote" | "local_staff";

export interface NormalizedLine {
  name: string;
  quantity: number;
  /** Chosen variant names, e.g. ["Large"]. */
  variant: string[];
  /** Chosen modifier/add-on names, e.g. ["Extra cheese"]. */
  addOns: string[];
  special_instructions: string;
}

export interface OrderEvent {
  /** A whole new order vs. items added to an order that already existed. */
  kind: OrderEventKind;
  orderUuid: string;
  /** Immutable id of this ordering event — a KOT uuid, or a synthetic fallback. */
  batchUuid: string;
  /** Dedup identity for this event, e.g. `order:<uuid>:batch:<kot-uuid>`. */
  batchKey: string;
  source: string;
  tableNumber: number | null;
  tableName: string | null;
  customerName: string | null;
  notes: string;
  lines: NormalizedLine[];
}

export interface AnnounceContext {
  /** Batches entered on this terminal, so it never announces its own work. */
  localBatchKeys: Set<string>;
}
