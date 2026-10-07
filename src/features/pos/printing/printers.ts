/**
 * Printer definitions and per-document print routing, stored per terminal.
 *
 * Printers are physical to the machine they are plugged into — the kitchen
 * printer is reachable from the counter terminal, not from the owner's laptop —
 * so this lives in localStorage rather than on the server.
 *
 * Routing is what makes multi-printer setups work: a KOT can fan out to the
 * kitchen AND reception printers at once, while the bill only ever goes to
 * reception. When no routing is configured, every print falls back to the
 * browser's own print dialog, which is the pre-existing behaviour.
 */

import type { TicketPaper } from "./ticket-style";

export type PrinterConnection = "network" | "usb";

/** The document kinds that can be routed to printers. */
export type PrintDocType = "kot" | "bill" | "zreport";

export const PRINT_DOC_LABELS: Record<PrintDocType, string> = {
  kot: "Kitchen Order Ticket (KOT)",
  bill: "Bill / Receipt",
  zreport: "Z-Report",
};

export interface PrinterConfig {
  id: string;
  /** Shown in settings and on test prints, e.g. "Kitchen". */
  name: string;
  connection: PrinterConnection;
  /**
   * network: printer IP or hostname (port 9100), e.g. "192.168.1.50".
   * usb: the printer's OS name (Windows printer name / CUPS queue) or a
   * device path such as "/dev/usb/lp0".
   */
  address: string;
  paper: TicketPaper;
  enabled: boolean;
}

export interface PrinterSettings {
  printers: PrinterConfig[];
  /** Printer ids each document type is sent to. */
  routing: Record<PrintDocType, string[]>;
}

export const PRINTER_SETTINGS_KEY = "pos_printer_settings";

export function emptyPrinterSettings(): PrinterSettings {
  return { printers: [], routing: { kot: [], bill: [], zreport: [] } };
}

/** True when nothing has been configured yet — printing behaves as before. */
export function isPrinterConfigured(settings: PrinterSettings): boolean {
  return settings.printers.length > 0;
}

export function loadPrinterSettings(): PrinterSettings {
  if (typeof localStorage === "undefined") return emptyPrinterSettings();
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY);
    if (!raw) return emptyPrinterSettings();
    const parsed = JSON.parse(raw) as Partial<PrinterSettings>;
    const printers = Array.isArray(parsed.printers)
      ? parsed.printers.filter(
          (p): p is PrinterConfig => !!p && typeof p.id === "string" && typeof p.name === "string",
        )
      : [];
    const routing = { ...emptyPrinterSettings().routing };
    if (parsed.routing && typeof parsed.routing === "object") {
      for (const doc of Object.keys(routing) as PrintDocType[]) {
        const ids = parsed.routing[doc];
        if (Array.isArray(ids)) {
          routing[doc] = ids.filter((id) => printers.some((p) => p.id === id));
        }
      }
    }
    return { printers, routing };
  } catch {
    return emptyPrinterSettings();
  }
}

export function savePrinterSettings(settings: PrinterSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(settings));
}

/** Enabled printers a document type should go to, in configuration order. */
export function printersForDoc(settings: PrinterSettings, doc: PrintDocType): PrinterConfig[] {
  const ids = settings.routing[doc] ?? [];
  return ids
    .map((id) => settings.printers.find((p) => p.id === id))
    .filter((p): p is PrinterConfig => !!p && p.enabled);
}

export function newPrinterId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `printer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
