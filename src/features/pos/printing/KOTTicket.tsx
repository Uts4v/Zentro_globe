import { useRef } from "react";
import { PosReceiptData } from "../api";

/**
 * Kitchen Order Ticket — the ticket sent to the kitchen.
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

export function printKOT(ticket: KOTTicketData, printSize: "58mm" | "80mm" = "58mm") {
  const lines: string[] = [];

  const row = (label: string, value: string) =>
    `<div style="display:flex;justify-content:space-between;"><span>${label}</span><span style="font-weight:bold;">${value}</span></div>`;
  const dash = `<hr style="border:none;border-top:1px dashed #000;margin:4px 0;">`;
  const thick = `<hr style="border:none;border-top:2px solid #000;margin:6px 0;">`;

  lines.push(`<div style="text-align:center;margin-bottom:6px;">`);
  lines.push(`<p style="font-size:14px;font-weight:bold;margin:0;">${ticket.merchantName}</p>`);
  lines.push(
    `<p style="font-size:11px;font-weight:bold;letter-spacing:1px;margin:2px 0 0;">KITCHEN ORDER TICKET</p>`,
  );
  if (ticket.kotNumber) {
    lines.push(
      `<p style="font-size:16px;font-weight:bold;margin:4px 0 0;border:2px solid #000;display:inline-block;padding:2px 10px;">KOT #${String(ticket.kotNumber).padStart(3, "0")}</p>`,
    );
  }
  lines.push(`</div>`);
  lines.push(thick);

  lines.push(row("Order", ticket.orderNumber));
  lines.push(row("Date", formatDate(ticket.createdAt)));
  lines.push(row("Type", ticket.fulfillmentType ? ticket.fulfillmentType.toUpperCase() : "-"));
  if (ticket.tableName || ticket.tableNumber != null) {
    lines.push(row("Table", ticket.tableName || `#${ticket.tableNumber}`));
  }
  if (ticket.customerName) lines.push(row("Customer", ticket.customerName));
  if (ticket.workerName) lines.push(row("Served by", ticket.workerName));
  lines.push(dash);

  for (const item of ticket.items) {
    lines.push(
      `<div style="font-size:12px;"><span style="font-weight:bold;">${item.quantity}x ${item.name}</span></div>`,
    );
    for (const o of item.options ?? []) {
      lines.push(
        `<div style="font-size:10px;color:#000;margin-left:8px;">&nbsp;&nbsp;+ ${o.group_name ? `${o.group_name}: ` : ""}${o.option_name}</div>`,
      );
    }
    if (item.special_instructions) {
      lines.push(
        `<div style="font-size:10px;color:#000;margin-left:8px;">&nbsp;&nbsp;* ${item.special_instructions}</div>`,
      );
    }
  }

  if (ticket.notes) {
    lines.push(dash);
    lines.push(
      `<div style="font-size:10px;font-weight:bold;">NOTES</div><div style="font-size:10px;">${ticket.notes}</div>`,
    );
  }

  lines.push(thick);
  lines.push(
    `<div style="text-align:center;font-size:9px;letter-spacing:1px;">*** PLACE TICKET AT THE TOP OF THE PLC ***</div>`,
  );

  const body = lines.join("\n");

  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  printWindow.document.write(`
    <!DOCTYPE html>
    <html><head><title>KOT ${ticket.kotNumber ? `#${String(ticket.kotNumber).padStart(3, "0")} ` : ""}${ticket.orderNumber}</title>
    <style>
      @page { size: ${printSize} auto; margin: 3mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: "Courier New", "Lucida Console", monospace; font-size: 11px; line-height: 1.35; width: ${printSize === "58mm" ? "48mm" : "72mm"}; color: #000; background: #fff; }
      @media print { html, body { width: ${printSize === "58mm" ? "48mm" : "72mm"}; } .no-print { display: none !important; } }
    </style>
    </head><body>
      <div class="no-print" style="padding:8px;text-align:center;border-bottom:1px solid #ccc;margin-bottom:8px;">
        <button onclick="window.print(); window.close();" style="padding:8px 16px;font-size:14px;cursor:pointer;background:#1a1a1a;color:white;border:none;border-radius:8px;">Print KOT</button>
      </div>
      ${body}
    </body></html>
  `);
  printWindow.document.close();
}

interface KOTTicketProps {
  ticket: KOTTicketData;
  showPrintButton?: boolean;
  printSize?: "58mm" | "80mm";
}

export default function KOTTicket({
  ticket,
  showPrintButton = true,
  printSize = "58mm",
}: KOTTicketProps) {
  const kotRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!kotRef.current) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const css = `
      @page { size: ${printSize} auto; margin: 3mm; }
      * { box-sizing: border-box; }
      body { font-family: "Courier New","Lucida Console",monospace; font-size: 11px; line-height: 1.35; width: ${printSize === "58mm" ? "48mm" : "72mm"}; color:#000; background:#fff; }
      @media print { html, body { width: ${printSize === "58mm" ? "48mm" : "72mm"}; } .no-print { display:none !important; } }
    `;
    printWindow.document.write(`
      <!DOCTYPE html><html><head><title>KOT ${ticket.orderNumber}</title><style>${css}</style></head>
      <body><div>${kotRef.current.innerHTML}</div></body></html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <div className="relative">
      {showPrintButton && (
        <button
          onClick={handlePrint}
          className="no-print mb-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Print KOT
        </button>
      )}
      <div
        ref={kotRef}
        className="rounded border border-border bg-white p-4 font-mono text-[12px] text-black"
        style={{ width: printSize === "58mm" ? "48mm" : "72mm", margin: "0 auto" }}
      >
        <div className="text-center">
          <p className="text-sm font-bold">{ticket.merchantName}</p>
          <p className="text-[11px] font-bold tracking-widest">KITCHEN ORDER TICKET</p>
          {ticket.kotNumber && (
            <p className="mt-1 inline-block border-2 border-black px-2 py-0.5 text-base font-bold">
              KOT #{String(ticket.kotNumber).padStart(3, "0")}
            </p>
          )}
        </div>

        <hr className="my-1.5 border-t border-dashed border-black" />
        <div className="space-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span>Order</span>
            <span className="font-bold">{ticket.orderNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>Date</span>
            <span>{formatDate(ticket.createdAt)}</span>
          </div>
          <div className="flex justify-between">
            <span>Type</span>
            <span className="font-bold uppercase">{ticket.fulfillmentType || "-"}</span>
          </div>
          {(ticket.tableName || ticket.tableNumber != null) && (
            <div className="flex justify-between">
              <span>Table</span>
              <span className="font-bold">{ticket.tableName || `#${ticket.tableNumber}`}</span>
            </div>
          )}
          {ticket.customerName && (
            <div className="flex justify-between">
              <span>Customer</span>
              <span>{ticket.customerName}</span>
            </div>
          )}
          {ticket.workerName && (
            <div className="flex justify-between">
              <span>Served by</span>
              <span>{ticket.workerName}</span>
            </div>
          )}
        </div>

        <hr className="my-1.5 border-t border-dashed border-black" />
        <div className="space-y-1">
          {ticket.items.map((item, i) => (
            <div key={i}>
              <p className="text-[12px] font-bold">
                {item.quantity}x {item.name}
              </p>
              {(item.options ?? []).map((o, j) => (
                <p key={j} className="ml-2 text-[10px]">
                  + {o.group_name ? `${o.group_name}: ` : ""}
                  {o.option_name}
                </p>
              ))}
              {item.special_instructions && (
                <p className="ml-2 text-[10px]">* {item.special_instructions}</p>
              )}
            </div>
          ))}
        </div>

        {ticket.notes && (
          <>
            <hr className="my-1.5 border-t border-dashed border-black" />
            <p className="text-[10px] font-bold">NOTES</p>
            <p className="whitespace-pre-wrap text-[10px]">{ticket.notes}</p>
          </>
        )}

        <hr className="my-1.5 border-t-2 border-black" />
        <p className="text-center text-[9px] tracking-widest">*** PLACE TICKET IN THE PLC ***</p>
      </div>
    </div>
  );
}
