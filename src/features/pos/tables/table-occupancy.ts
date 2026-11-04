import type { PosOrder, PosTableStatus } from "../api";

export interface TableOccupancyInfo {
  amount: string | null;
  customer: string | null;
}

export type TableOccupancyMap = Map<number, TableOccupancyInfo>;

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "preparing"]);

function occupancyFromOrders(orders: PosOrder[]): TableOccupancyMap {
  const occupied = new Map<number, TableOccupancyInfo>();
  for (const order of orders) {
    if (!order.table_id || !ACTIVE_STATUSES.has(order.status)) continue;
    if (occupied.has(order.table_id)) continue;
    occupied.set(order.table_id, {
      amount: order.total_amount,
      customer: order.customer_name ?? null,
    });
  }
  return occupied;
}

/**
 * Live table status is authoritative. Recent orders are only a fallback for
 * the first paint / failed status request, because that list is capped and
 * never contains every open bill.
 */
export function buildTableOccupancy(
  statuses: PosTableStatus[],
  orders: PosOrder[] = [],
): TableOccupancyMap {
  const fromOrders = occupancyFromOrders(orders);
  if (statuses.length === 0) return fromOrders;

  const occupied = new Map<number, TableOccupancyInfo>();
  for (const status of statuses) {
    if (!status.is_occupied) continue;
    const fallback = fromOrders.get(status.id);
    occupied.set(status.id, {
      amount: status.bill?.total_amount ?? fallback?.amount ?? null,
      customer: status.bill?.customer_name ?? fallback?.customer ?? null,
    });
  }
  return occupied;
}
