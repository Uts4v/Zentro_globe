/**
 * ESC/POS encoding for the tickets this app already lays out.
 *
 * The print bridge sends raw bytes to a thermal printer, so the KOT, bill and
 * Z-Report can no longer be HTML — they have to be escape-code streams. The
 * layouts here mirror the on-screen documents (kot-markup.ts, Receipt.tsx,
 * ZReportScreen.tsx) so a ticket printed through the bridge matches the one
 * the cashier previewed.
 *
 * Column budgets: a 58mm roll fits 32 monospace characters per line, 80mm fits
 * 48 — the same trade the HTML type scale in ticket-style.ts makes for fonts.
 */

import { formatCurrency } from "@/lib/currency";
import { paymentMethodLabel } from "@/lib/payment-methods";
import type { PosReceiptData, PosZReportData } from "../api";
import type { KOTTicketData } from "./kot-markup";
import type { PrinterConfig } from "./printers";
import { tableLabel } from "./table-label";
import type { TicketPaper } from "./ticket-style";

const encoder = new TextEncoder();

// ESC/POS command bytes.
const ESC = 0x1b;
const GS = 0x1d;

export function charsPerLine(paper: TicketPaper): number {
  if (paper === "58mm") return 32;
  return 48;
}

/** Greedy word wrap; words longer than the line are hard-broken. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    if (paragraph === "") {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
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

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

type Align = "left" | "center" | "right";

/** A growable ESC/POS byte stream with the layout verbs this app needs. */
class Ticket {
  private chunks: number[] = [];
  readonly cols: number;

  constructor(paper: TicketPaper) {
    this.cols = charsPerLine(paper);
    this.raw([ESC, 0x40]); // ESC @ — reset the printer
  }

  raw(cmd: number[]): this {
    this.chunks.push(...cmd);
    return this;
  }

  text(s: string): this {
    this.chunks.push(...encoder.encode(s));
    return this;
  }

  nl(times = 1): this {
    for (let i = 0; i < times; i += 1) this.chunks.push(0x0a);
    return this;
  }

  align(a: Align): this {
    return this.raw([ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2]);
  }

  bold(on = true): this {
    return this.raw([ESC, 0x45, on ? 1 : 0]);
  }

  double(on = true): this {
    return this.raw([GS, 0x21, on ? 0x11 : 0x00]);
  }

  /** Wrapped plain lines. */
  lines(text: string): this {
    for (const line of wrapText(text, this.cols)) this.text(line).nl();
    return this;
  }

  /** Wrapped lines, centered. */
  center(text: string): this {
    for (const line of wrapText(text, this.cols)) {
      const pad = Math.max(0, Math.floor((this.cols - line.length) / 2));
      this.text(" ".repeat(pad) + line).nl();
    }
    return this;
  }

  /** Label on the left, value on the right (value bold); wraps when tight. */
  meta(label: string, value: string): this {
    const v = String(value ?? "");
    if (label.length + v.length + 1 <= this.cols) {
      const gap = Math.max(1, this.cols - label.length - v.length);
      this.text(label + " ".repeat(gap));
      this.bold();
      this.text(v);
      this.bold(false);
      this.nl();
    } else {
      this.text(label).nl();
      for (const line of wrapText(v, this.cols)) {
        this.text(" ".repeat(Math.max(0, this.cols - line.length)) + line).nl();
      }
    }
    return this;
  }

  /** Bold double-size key-value line (the TOTAL). */
  bigMeta(label: string, value: string): this {
    const cols = Math.floor(this.cols / 2);
    const v = String(value ?? "");
    const gap = Math.max(1, cols - label.length - v.length);
    this.bold();
    this.double();
    this.text(label + " ".repeat(gap) + v);
    this.double(false);
    this.bold(false);
    this.nl();
    return this;
  }

  /** `2 x Chicken Tikka` with an optional right-aligned amount. */
  item(qty: number, name: string, amount?: string): this {
    const label = `${qty} x ${name}`;
    if (amount === undefined) {
      this.bold();
      for (const line of wrapText(label, this.cols)) this.text(line).nl();
      this.bold(false);
      return this;
    }
    const inner = Math.max(10, this.cols - amount.length - 1);
    const wrapped = wrapText(label, inner);
    const gap = Math.max(1, this.cols - wrapped[0].length - amount.length);
    this.bold();
    this.text(wrapped[0] + " ".repeat(gap) + amount);
    this.bold(false);
    this.nl();
    for (const line of wrapped.slice(1)) this.text(line).nl();
    return this;
  }

  rule(ch = "-"): this {
    return this.text(ch.repeat(this.cols)).nl();
  }

  cut(): this {
    this.nl(3);
    // GS V 65 — partial cut, feeding a few lines first so the ticket drops free.
    return this.raw([GS, 0x56, 0x41, 0x00]);
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export function kotToEscPos(ticket: KOTTicketData, paper: TicketPaper): Uint8Array {
  const t = new Ticket(paper);
  const table = tableLabel(ticket.tableName, ticket.tableNumber);

  t.align("center");
  t.bold();
  t.center(ticket.merchantName || "ZENTRO");
  t.bold(false);
  t.center("KITCHEN ORDER TICKET");
  if (ticket.kotNumber) {
    t.bold();
    t.center(`KOT #${String(ticket.kotNumber).padStart(3, "0")}`);
    t.bold(false);
  }

  t.align("left");
  t.rule("-");
  t.meta("Order", ticket.orderNumber);
  t.meta("Date", formatDate(ticket.createdAt));
  t.meta("Type", ticket.fulfillmentType ? ticket.fulfillmentType.toUpperCase() : "-");
  if (table) t.meta("Table", table);
  if (ticket.customerName) t.meta("Customer", ticket.customerName);
  if (ticket.workerName) t.meta("Served by", ticket.workerName);
  t.rule("-");

  ticket.items.forEach((item, index) => {
    if (index > 0) t.nl();
    t.bold();
    for (const line of wrapText(`${item.quantity} x ${item.name}`, t.cols)) {
      t.text(line).nl();
    }
    t.bold(false);
    for (const o of item.options ?? []) {
      const label = o.group_name ? `${o.group_name}: ${o.option_name}` : o.option_name;
      t.lines(`  + ${label}`);
    }
    if (item.special_instructions) t.lines(`  * ${item.special_instructions}`);
  });

  if (ticket.notes) {
    t.rule("-");
    t.bold();
    t.text("NOTES");
    t.bold(false);
    t.nl();
    t.lines(ticket.notes);
  }

  t.rule("=");
  t.align("center");
  t.center("*** PLACE TICKET IN THE PLC ***");
  t.align("left");
  return t.cut().bytes();
}

export function receiptToEscPos(data: PosReceiptData, paper: TicketPaper): Uint8Array {
  const t = new Ticket(paper);
  const symbol = data.currency_symbol || "Rs";
  const table = tableLabel(data.table?.name, data.table?.number);
  const cur = (v: string | number) => formatCurrency(v, symbol);

  t.align("center");
  t.bold();
  t.center(data.merchant?.name || "ZENTRO");
  t.bold(false);
  if (data.merchant?.address) t.center(data.merchant.address);
  if (data.merchant?.phone) t.center(data.merchant.phone);

  t.align("left");
  t.rule("-");
  t.meta("Order", data.order_number);
  if (data.kot_number) t.meta("KOT", `#${String(data.kot_number).padStart(3, "0")}`);
  t.meta("Date", formatDate(data.created_at || data.client_created_at));
  t.meta("Type", data.fulfillment_type || "-");
  if (table) t.meta("Table", table);
  if (data.customer_name) t.meta("Customer", data.customer_name);
  if (data.worker_name) t.meta("Served by", data.worker_name);
  t.rule("=");

  data.items.forEach((item) => {
    const amount = Number(item.price) === 0 ? "FREE" : cur(item.subtotal);
    t.item(item.quantity, item.name, amount);
    if (item.quantity > 1 && Number(item.price) > 0) {
      const line = `@ ${cur(item.price)} each`;
      t.text(" ".repeat(Math.max(0, t.cols - line.length)) + line).nl();
    }
  });

  t.rule("-");
  t.meta("Subtotal", cur(data.subtotal));
  for (const d of data.discounts.filter((d) => Number(d.amount) > 0)) {
    const label =
      (d.label && d.label !== "Discount" ? d.label : "Discount") +
      (d.type === "percentage" ? ` (${d.value}%)` : "");
    t.meta(label, `-${cur(d.amount)}`);
  }
  if (Number(data.discount_amount) > 0 && data.discounts.length === 0) {
    t.meta("Discount", `-${cur(data.discount_amount)}`);
  }
  if (data.charges && data.charges.length > 0) {
    for (const c of data.charges) t.meta(c.label, cur(c.amount));
  } else if (Number(data.service_charge) > 0) {
    t.meta("Service Charge", cur(data.service_charge));
  }
  if (
    Number(data.taxable_amount ?? 0) > 0 &&
    (Number(data.discount_amount) > 0 || Number(data.service_charge) > 0)
  ) {
    t.meta("Taxable Amount", cur(data.taxable_amount ?? 0));
  }
  for (const tax of data.tax_breakdown ?? []) {
    t.meta(`${tax.name} (${tax.rate}%)${data.prices_include_tax ? " incl." : ""}`, cur(tax.amount));
  }
  t.rule("=");
  t.bigMeta("TOTAL", cur(data.total_amount));

  if (data.type === "receipt" && data.payments.length > 0) {
    t.rule("-");
    t.bold();
    t.text("Payment");
    t.bold(false);
    t.nl();
    for (const p of data.payments) {
      t.meta(paymentMethodLabel(p.method), cur(p.amount));
    }
    t.meta("Paid", cur(data.total_paid));
    if (Number(data.change) > 0) t.meta("Change", cur(data.change));
    t.meta("Payment Status", String(data.payment_status).toUpperCase());
  }

  t.rule("-");
  t.align("center");
  if (data.payment_status !== "paid" && data.payment_status !== "fulfilled") {
    t.bold();
    t.center("** AWAITING PAYMENT **");
    t.bold(false);
  } else {
    t.bold();
    t.center("Thank you!");
    t.bold(false);
  }
  if (data.is_offline_receipt && data.sync_status !== "synced") {
    t.center("OFFLINE - Pending Sync");
  }
  t.align("left");
  return t.cut().bytes();
}

export function zReportToEscPos(
  data: PosZReportData,
  paper: TicketPaper,
  currencySymbol = "Rs",
): Uint8Array {
  const t = new Ticket(paper);
  const cur = (v: string | number) => formatCurrency(v, currencySymbol);
  const revenue = Number(data.total_revenue);
  const avgOrder = data.total_orders > 0 ? revenue / data.total_orders : 0;

  t.align("center");
  t.bold();
  t.center(data.merchant?.name || "ZENTRO");
  t.bold(false);
  if (data.merchant?.address) t.center(data.merchant.address);
  if (data.merchant?.phone) t.center(data.merchant.phone);
  t.center(data.report_label || "Z-Report");
  t.center(formatDate(data.generated_at));
  t.align("left");

  t.rule("=");
  t.meta("Total Orders", String(data.total_orders));
  t.meta("Revenue", cur(revenue));
  t.meta("Avg Order", cur(avgOrder));
  t.meta("Discounts", cur(data.total_discounts_value));

  t.rule("=");
  t.align("center");
  t.bold();
  t.text("CASH SUMMARY");
  t.bold(false);
  t.nl();
  t.align("left");
  t.meta("Cash In", cur(data.cash_summary.total_cash_in));
  t.meta("Change Given", `-${cur(data.cash_summary.total_cash_out_change)}`);
  t.meta("Expected Drawer", cur(data.cash_summary.total_expected_cash));
  t.meta("Actual Closing", cur(data.cash_summary.total_actual_cash));
  const diff = Number(data.cash_summary.total_difference);
  if (diff !== 0) t.meta(diff > 0 ? "Over" : "Short", cur(Math.abs(diff)));
  if (Number(data.cash_summary.total_payouts) > 0) {
    t.meta("Pay-outs", `-${cur(data.cash_summary.total_payouts)}`);
  }
  if (Number(data.cash_summary.total_payins) > 0) {
    t.meta("Pay-ins", `+${cur(data.cash_summary.total_payins)}`);
  }

  if (data.payment_methods.length > 0) {
    t.rule("=");
    t.align("center");
    t.bold();
    t.text("PAYMENT METHODS");
    t.bold(false);
    t.nl();
    t.align("left");
    for (const pm of data.payment_methods) {
      t.meta(paymentMethodLabel(pm.method), cur(pm.amount));
      t.text(`  ${pm.count} payment${pm.count !== 1 ? "s" : ""}`).nl();
    }
  }

  if (data.order_status_breakdown.length > 0) {
    t.rule("=");
    t.align("center");
    t.bold();
    t.text("ORDER STATUS");
    t.bold(false);
    t.nl();
    t.align("left");
    for (const s of data.order_status_breakdown) {
      t.meta(STATUS_LABELS[s.status] || s.status, String(s.count));
    }
  }

  if (data.top_selling_items.length > 0) {
    t.rule("=");
    t.align("center");
    t.bold();
    t.text("TOP SELLING ITEMS");
    t.bold(false);
    t.nl();
    t.align("left");
    data.top_selling_items.slice(0, 8).forEach((item, i) => {
      t.meta(`${i + 1}. ${item.name}`, cur(item.revenue));
      t.text(`  ${item.quantity_sold} sold`).nl();
    });
  }

  if (Number(data.refund_count) > 0) {
    t.rule("-");
    t.meta("Refund Count", String(data.refund_count));
    t.meta("Refund Total", cur(data.refund_total));
  }

  t.rule("=");
  t.align("center");
  t.bold();
  t.text("CREDIT / DEBIT");
  t.bold(false);
  t.nl();
  t.align("left");
  t.meta("Credit Sales", cur(data.credit_summary.sales));
  t.meta("Repayments", cur(data.credit_summary.repayments));
  t.meta("Debit Purchases", cur(data.debit_summary.purchases));
  t.meta("Wallet Top-ups", cur(data.debit_summary.topups));

  if (data.staff_breakdown.length > 0) {
    t.rule("=");
    t.align("center");
    t.bold();
    t.text("STAFF PERFORMANCE");
    t.bold(false);
    t.nl();
    t.align("left");
    for (const staff of data.staff_breakdown) {
      t.meta(staff.worker_name || "Staff", cur(staff.total_revenue));
      t.text(`  ${staff.order_count} orders`).nl();
    }
  }

  if (data.shifts.length > 0) {
    t.rule("=");
    t.align("center");
    t.bold();
    t.text("SHIFT DETAILS");
    t.bold(false);
    t.nl();
    t.align("left");
    for (const s of data.shifts) {
      t.bold();
      t.lines(`${s.opened_by} -> ${s.closed_by || "(open)"}`);
      t.bold(false);
      t.meta("Status", s.status.toUpperCase());
      t.meta("Opening", cur(s.opening_cash));
      if (s.closing_cash !== null) t.meta("Closing", cur(s.closing_cash));
      t.nl();
    }
  }

  t.rule("-");
  t.align("center");
  t.center(`Generated ${formatDate(data.generated_at)}`);
  t.align("left");
  return t.cut().bytes();
}

/** Alignment/ladder ticket used by the Test Print button in settings. */
export function testTicketToEscPos(printer: PrinterConfig): Uint8Array {
  const t = new Ticket(printer.paper);
  t.align("center");
  t.bold();
  t.center("ZENTRO");
  t.bold(false);
  t.center("PRINT TEST");
  t.align("left");
  t.rule("=");
  t.meta("Printer", printer.name);
  t.meta("Connection", printer.connection === "network" ? "Network" : "USB");
  t.meta("Address", printer.address);
  t.meta("Paper", printer.paper);
  t.meta("Time", new Date().toLocaleString());
  t.rule("-");
  t.center(`${t.cols} columns`);
  t.center("ABCDEFGHIJKLMNOP");
  t.center("QRSTUVWXYZ");
  t.center("0123456789");
  t.align("left");
  return t.cut().bytes();
}
