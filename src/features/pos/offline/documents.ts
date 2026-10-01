/**
 * Bills and kitchen tickets built on this device.
 *
 * The receipt endpoint is the normal source for both, but it needs the server.
 * Offline, the order as last seen (or as captured here) is all there is, so
 * these rebuild the same two documents from it.
 */

import type { PosOrder, PosReceiptData } from "../api";
import type { KOTTicketData } from "../printing/KOTTicket";
import type { OfflineOrder } from "./db";

type MerchantInfo = { id: number; business_name: string; logo_url: string } | null;

/** The reference an order goes by until the server gives it a number. */
export function offlineOrderNumber(id: string): string {
  return `OFF-${id.slice(0, 6).toUpperCase()}`;
}

/** "#123" for an order the server knows, the local reference otherwise. */
export function orderNumber(order: Pick<PosOrder, "id" | "uuid">): string {
  return order.id > 0 ? `#${order.id}` : offlineOrderNumber(order.uuid);
}

/** One recorded payment, in the shape a receipt lists it. */
export function receiptPayment(
  method: string,
  amount: string,
  change: string,
  externalReference = "",
): PosReceiptData["payments"][number] {
  return {
    method,
    amount,
    status: "completed",
    external_reference: externalReference,
    change_amount: change,
    created_at: new Date().toISOString(),
  };
}

/** Bill (unpaid) or receipt (paid) for an order last fetched from the server. */
export function receiptFromOrder(order: PosOrder, merchant: MerchantInfo): PosReceiptData {
  const paid = order.payment_status === "paid";
  return {
    type: paid ? "receipt" : "bill",
    order_id: order.id,
    order_uuid: order.uuid,
    order_number: orderNumber(order),
    kot_number: order.kot_number,
    status: order.status,
    source: order.source,
    created_at: order.created_at,
    client_created_at: null,
    merchant: {
      id: merchant?.id ?? order.merchant_id,
      name: merchant?.business_name || order.merchant_name,
      address: "",
      phone: "",
      logo_url: merchant?.logo_url ?? "",
    },
    table:
      order.table_name_snapshot || order.table_number_snapshot != null
        ? { name: order.table_name_snapshot, number: order.table_number_snapshot ?? 0 }
        : null,
    fulfillment_type: order.fulfillment_type,
    customer_name: order.customer ? order.customer_name : null,
    worker_name: order.worker_name,
    notes: order.notes,
    items: order.items.map((item) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal,
      special_instructions: item.special_instructions || "",
      options: (item.options ?? []).map((o) => ({
        group_name: o.group_name,
        option_name: o.option_name,
        kind: o.kind ?? "modifier",
      })),
    })),
    subtotal: order.subtotal || order.total_amount,
    discounts: [],
    discount_amount: order.discount_amount,
    tax_amount: order.tax_amount,
    tax_breakdown: order.tax_breakdown ?? [],
    service_charge: order.service_charge,
    total_amount: order.total_amount,
    // The saved order says how it was paid, not what was tendered.
    payments: paid ? [receiptPayment(order.payment_method, order.total_amount, "0.00")] : [],
    total_paid: paid ? order.total_amount : "0.00",
    change: "0.00",
    payment_status: order.payment_status,
    payment_method: order.payment_method,
    is_offline_receipt: false,
    sync_status: "synced",
  };
}

/** Kitchen ticket for an order last fetched from the server. */
export function kotFromOrder(order: PosOrder, merchant: MerchantInfo): KOTTicketData {
  return {
    merchantName: merchant?.business_name || order.merchant_name || "ZENTRO",
    kotNumber: order.kot_number,
    orderNumber: orderNumber(order),
    createdAt: order.created_at,
    fulfillmentType: order.fulfillment_type,
    tableName: order.table_name_snapshot || null,
    tableNumber: order.table_number_snapshot,
    customerName: order.customer ? order.customer_name : null,
    workerName: order.worker_name,
    notes: order.notes || "",
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      special_instructions: item.special_instructions || "",
      options: (item.options ?? []).map((o) => ({
        group_name: o.group_name,
        option_name: o.option_name,
      })),
    })),
  };
}

/**
 * The bill for an order captured on this device. Orders captured before bills
 * were kept for unpaid orders have none, so one is put together from the cart
 * snapshot; it can only show the total, not how tax and charges make it up.
 */
export function billFromOfflineOrder(order: OfflineOrder, merchant: MerchantInfo): PosReceiptData {
  if (order.bill) return order.bill;
  const total = String(order.total);
  return {
    type: "bill",
    order_id: 0,
    order_uuid: order.id,
    order_number: order.kot?.orderNumber ?? offlineOrderNumber(order.id),
    kot_number: null,
    status: order.order_status || "confirmed",
    source: "pos_offline",
    created_at: order.created_at,
    client_created_at: order.created_at,
    merchant: {
      id: merchant?.id ?? order.merchant_id,
      name: merchant?.business_name || order.kot?.merchantName || "",
      address: "",
      phone: "",
      logo_url: merchant?.logo_url ?? "",
    },
    table:
      order.kot?.tableName || order.kot?.tableNumber != null
        ? { name: order.kot?.tableName ?? "", number: order.kot?.tableNumber ?? 0 }
        : null,
    fulfillment_type: order.fulfillment_type,
    customer_name: null,
    worker_name: order.kot?.workerName ?? null,
    notes: order.notes,
    items: order.cart_snapshot.map((item) => ({
      name: item.name,
      price: String(item.price),
      quantity: item.quantity,
      subtotal: String(item.subtotal),
    })),
    subtotal: String(order.cart_snapshot.reduce((sum, item) => sum + item.subtotal, 0)),
    discounts: [],
    discount_amount: "0.00",
    tax_amount: "0.00",
    tax_breakdown: [],
    service_charge: "0.00",
    total_amount: total,
    payments: [],
    total_paid: "0.00",
    change: "0.00",
    payment_status: "unpaid",
    payment_method: "",
    is_offline_receipt: true,
    sync_status: "pending",
  };
}

/** Whether an order captured on this device has been paid for. */
export function offlineOrderPaid(order: OfflineOrder): boolean {
  return order.bill?.payment_status === "paid";
}
