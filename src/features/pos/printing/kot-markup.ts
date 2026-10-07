import { PosReceiptData } from "../api";
import { kotToEscPos } from "./escpos";
import { dispatchPrint } from "./print-bridge";
import { tableLabel } from "./table-label";
import {
  escapeHtml,
  LOGO_PX,
  TICKET_FONT,
  TICKET_MARGIN,
  TICKET_WIDTH,
  typeScale,
  type TicketPaper,
} from "./ticket-style";

/**
 * Kitchen Order Ticket — the ticket sent to the kitchen.
 *
 * Same 58/80mm thermal format as the customer receipt, but without prices:
 * focuses on item name, quantity, cooking instructions and modifiers.
 */
export interface KOTItem {
  name: string;
  quantity: number;
  special_instructions?: string;
  options?: Array<{ group_name: string; option_name: string }>;
}

export interface KOTTicketData {
  merchantName: string;
  /** Shown small above the merchant name, so tickets can be told apart at a glance. */
  merchantLogoUrl?: string | null;
  kotNumber: number | null;
  orderNumber: string;
  createdAt: string | null;
  fulfillmentType: string;
  tableName?: string | null;
  tableNumber?: number | null;
  customerName?: string | null;
  workerName?: string | null;
  notes?: string;
  items: KOTItem[];
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-MY", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function kotTicketFromReceipt(data: PosReceiptData): KOTTicketData {
  return {
    merchantName: data.merchant?.name || "ZENTRO",
    merchantLogoUrl: data.merchant?.logo_url || null,
    kotNumber: data.kot_number,
    orderNumber: data.order_number,
    createdAt: data.created_at || data.client_created_at,
    fulfillmentType: data.fulfillment_type,
    tableName: data.table?.name,
    tableNumber: data.table?.number,
    customerName: data.customer_name,
    workerName: data.worker_name,
    notes: data.notes || "",
    items: data.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      special_instructions: i.special_instructions || "",
      options: (i.options ?? []).map((o) => ({
        group_name: o.group_name,
        option_name: o.option_name,
      })),
    })),
  };
}

/**
 * Build a KOT ticket from a merchant-order record (OrderSerializer shape).
 * Accepts the order object with `items` or `order_items`, plus kot fields.
 */
export function kotTicketFromOrder(
  order: {
    id: string | number;
    merchant_name?: string;
    merchant_logo_url?: string | null;
    kot_number?: number | null;
    fulfillment_type?: string;
    table_name_snapshot?: string;
    table_number_snapshot?: number | null;
    customer_name?: string;
    guest_name_snapshot?: string;
    worker_name?: string;
    notes?: string;
    created_at: string;
    items?: Array<{ name: string; quantity: number; special_instructions?: string }>;
    order_items?: Array<{ name: string; quantity: number; special_instructions?: string }>;
  },
  itemKey: "items" | "order_items",
): KOTTicketData {
  const rawItems = order[itemKey] ?? order.items ?? order.order_items ?? [];
  return {
    merchantName: order.merchant_name ?? "",
    merchantLogoUrl: order.merchant_logo_url ?? null,
    kotNumber: order.kot_number ?? null,
    orderNumber: `#${String(order.id).slice(-6)}`,
    createdAt: order.created_at,
    fulfillmentType: order.fulfillment_type ?? "",
    tableName: order.table_name_snapshot,
    tableNumber: order.table_number_snapshot,
    customerName: order.customer_name ?? order.guest_name_snapshot,
    workerName: order.worker_name,
    notes: order.notes ?? "",
    items: rawItems.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      special_instructions: i.special_instructions ?? "",
    })),
  };
}

const DASH = `<hr style="border:none;border-top:1px dashed #000;margin:5px 0;">`;
const SOLID = `<hr style="border:none;border-top:2px solid #000;margin:7px 0;">`;

/**
 * The KOT, as a standalone HTML string.
 *
 * This is the only place a KOT is laid out. `printKOT` sends it to the printer
 * and the `KOTTicket` preview renders it verbatim, so what the cashier sees on
 * screen is exactly what the kitchen prints. Both used to be written separately
 * and had already drifted — different footers, different bolding — which is how
 * a printed ticket ends up not matching the screen a cashier approved.
 */
export function kotMarkup(ticket: KOTTicketData, paper: TicketPaper = "58mm"): string {
  const t = typeScale(paper);
  const table = tableLabel(ticket.tableName, ticket.tableNumber);
  const logo = ticket.merchantLogoUrl
    ? `<img src="${escapeHtml(ticket.merchantLogoUrl)}" alt="" style="display:block;margin:0 auto 2px;height:${LOGO_PX}px;width:${LOGO_PX}px;object-fit:contain;" crossorigin="anonymous" />`
    : "";

  const meta = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;gap:8px;font-size:${t.meta}px;line-height:1.4;">` +
    `<span>${escapeHtml(label)}</span>` +
    `<span style="font-weight:bold;text-align:right;">${escapeHtml(value)}</span></div>`;

  const head: string[] = [
    logo,
    `<div style="font-size:${t.merchant}px;font-weight:bold;line-height:1.25;">${escapeHtml(ticket.merchantName)}</div>`,
    `<div style="font-size:${t.title}px;font-weight:bold;letter-spacing:1px;margin-top:2px;">KITCHEN ORDER TICKET</div>`,
  ];
  if (ticket.kotNumber) {
    head.push(
      `<div style="display:inline-block;margin-top:5px;padding:2px 10px;border:2px solid #000;font-size:${t.badge}px;font-weight:bold;line-height:1.2;">` +
        `KOT #${escapeHtml(String(ticket.kotNumber).padStart(3, "0"))}</div>`,
    );
  }

  const rows: string[] = [
    meta("Order", ticket.orderNumber),
    meta("Date", formatDate(ticket.createdAt)),
  ];
  rows.push(meta("Type", ticket.fulfillmentType ? ticket.fulfillmentType.toUpperCase() : "-"));
  if (table) rows.push(meta("Table", table));
  if (ticket.customerName) rows.push(meta("Customer", ticket.customerName));
  if (ticket.workerName) rows.push(meta("Served by", ticket.workerName));

  const items: string[] = [];
  for (const item of ticket.items) {
    items.push(
      `<div style="font-size:${t.item}px;font-weight:bold;line-height:1.3;margin-top:3px;">` +
        `${item.quantity}&nbsp;x&nbsp;${escapeHtml(item.name)}</div>`,
    );
    for (const o of item.options ?? []) {
      items.push(
        `<div style="font-size:${t.sub}px;margin-left:9px;line-height:1.3;">&nbsp;&nbsp;+ ${
          o.group_name ? `${escapeHtml(o.group_name)}: ` : ""
        }${escapeHtml(o.option_name)}</div>`,
      );
    }
    if (item.special_instructions) {
      items.push(
        `<div style="font-size:${t.sub}px;margin-left:9px;line-height:1.3;">&nbsp;&nbsp;* ${escapeHtml(
          item.special_instructions,
        )}</div>`,
      );
    }
  }

  const notes = ticket.notes
    ? `${DASH}<div style="font-size:${t.heading}px;font-weight:bold;">NOTES</div>` +
      `<div style="font-size:${t.sub}px;white-space:pre-wrap;">${escapeHtml(ticket.notes)}</div>`
    : "";

  return [
    `<div style="text-align:center;margin-bottom:6px;">`,
    head.join(""),
    `</div>`,
    SOLID,
    rows.join(""),
    DASH,
    items.join(""),
    notes,
    SOLID,
    `<div style="text-align:center;font-size:${t.foot}px;letter-spacing:1px;">*** PLACE TICKET IN THE PLC ***</div>`,
  ].join("");
}

/** The print document wrapping a KOT. Shared by the on-screen and direct print paths. */
export function kotPrintDocument(ticket: KOTTicketData, paper: TicketPaper): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>KOT ${
    ticket.kotNumber ? `#${String(ticket.kotNumber).padStart(3, "0")} ` : ""
  }${escapeHtml(ticket.orderNumber)}</title>
<style>
  @page { size: ${paper} auto; margin: ${TICKET_MARGIN[paper]}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${TICKET_FONT}; line-height: 1.35; width: ${
    TICKET_WIDTH[paper]
  }; color: #000; background: #fff; }
  @media print { html, body { width: ${TICKET_WIDTH[paper]}; } .no-print { display: none !important; } }
</style>
</head><body><div class="no-print" style="padding: 8px; text-align: center; border-bottom: 1px solid #ccc; margin-bottom: 8px;">
  <button autofocus onclick="window.print(); window.close();" style="padding: 8px 16px; font-size: 14px; cursor: pointer; background: #1a1a1a; color: white; border: none; border-radius: 8px;">Print KOT</button>
</div>${kotMarkup(ticket, paper)}</body></html>`;
}

/**
 * Open the KOT in its own window, ready to print — or, when the terminal has
 * printers configured and the print bridge is up, send it to them silently.
 *
 * Routing first: a KOT configured for kitchen + reception prints on both with
 * no dialog. The window below is the fallback — it carries its own "Print KOT"
 * button rather than printing on open. A KOT goes to a shared thermal printer
 * behind the counter, and unlike the customer receipt — which auto-prints
 * because it is a by-product of taking payment — a mis-fired ticket means a
 * wasted re-print for the kitchen. Making the cashier confirm is the same
 * trade the draft bill makes.
 */
export async function printKOT(ticket: KOTTicketData, printSize: TicketPaper = "58mm") {
  const { mode } = await dispatchPrint("kot", (paper) => kotToEscPos(ticket, paper));
  if (mode === "bridge") return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(kotPrintDocument(ticket, printSize));
  printWindow.document.close();
}
