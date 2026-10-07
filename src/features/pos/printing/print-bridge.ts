/**
 * The print dispatcher: one entry point every print action goes through.
 *
 * Routing decides where a document goes. When printers are configured AND the
 * local print bridge is reachable, the encoded ESC/POS bytes are shipped
 * straight to each target printer — no dialog, and a KOT can land on both the
 * kitchen and reception printers in one call. When nothing is configured, or
 * the bridge is down, the dispatcher reports "fallback" and the caller runs
 * its original browser print-dialog path, so nothing regresses.
 *
 * The bridge is `printer-agent/print_agent.py`, started with
 * `npm run dev:print-agent`.
 */

import { toast } from "sonner";
import type { TicketPaper } from "./ticket-style";
import {
  loadPrinterSettings,
  printersForDoc,
  type PrintDocType,
  type PrinterConfig,
} from "./printers";

export const PRINT_BRIDGE_URL = "http://127.0.0.1:8950";

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Is the local print bridge running? Cheap — used as the gate for dispatch. */
export async function bridgeStatus(timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${PRINT_BRIDGE_URL}/health`, {}, timeoutMs);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Printer names installed on the bridge machine — suggestions for USB targets. */
export async function bridgeListPrinters(timeoutMs = 2000): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${PRINT_BRIDGE_URL}/printers`, {}, timeoutMs);
    if (!res.ok) return [];
    const body = (await res.json()) as { printers?: string[] };
    return Array.isArray(body.printers) ? body.printers : [];
  } catch {
    return [];
  }
}

/** Printer hardware detected on the bridge machine, mapped to its print queue. */
export interface BridgePrinterDevice {
  name: string;
  status: string;
  /** USB port (e.g. "USB002") or CUPS device URI; null when it can't be read. */
  port: string | null;
  /** Installed print queue for this device, or null when none exists yet. */
  queue: string | null;
  /** Paired Bluetooth printer (prints through its OS queue like USB does). */
  bluetooth?: boolean;
}

export async function bridgeListDevices(timeoutMs = 15_000): Promise<BridgePrinterDevice[]> {
  try {
    const res = await fetchWithTimeout(`${PRINT_BRIDGE_URL}/devices`, {}, timeoutMs);
    if (!res.ok) return [];
    const body = (await res.json()) as { devices?: BridgePrinterDevice[] };
    return Array.isArray(body.devices) ? body.devices : [];
  } catch {
    return [];
  }
}

/** Hosts with raw-print port 9100 open on the bridge machine's LAN. */
export interface BridgeNetworkHost {
  ip: string;
  port: number;
  /** The host answered the ESC/POS status probe — a thermal printer. */
  escpos: boolean;
  latency_ms: number;
}

/**
 * Scan the bridge machine's private subnets for printers on port 9100.
 * Probes only local ranges (never public IPs) and marks ESC/POS responders.
 */
export async function bridgeScanNetwork(timeoutMs = 30_000): Promise<{
  hosts: BridgeNetworkHost[];
  scanned: number;
  subnets: string[];
}> {
  try {
    const res = await fetchWithTimeout(`${PRINT_BRIDGE_URL}/scan-network`, {}, timeoutMs);
    if (!res.ok) return { hosts: [], scanned: 0, subnets: [] };
    const body = (await res.json()) as {
      hosts?: BridgeNetworkHost[];
      scanned?: number;
      subnets?: string[];
    };
    return {
      hosts: Array.isArray(body.hosts) ? body.hosts : [],
      scanned: body.scanned ?? 0,
      subnets: Array.isArray(body.subnets) ? body.subnets : [],
    };
  } catch {
    return { hosts: [], scanned: 0, subnets: [] };
  }
}

/**
 * Create a print queue for a detected device that doesn't have one. Two
 * identical USB printers can be plugged in while only the first got a queue
 * when its driver was installed — jobs can only target a queue, so without
 * this the second printer silently never receives anything.
 */
export async function bridgeInstallPrinter(target: {
  name: string;
  port: string;
  driverName?: string;
}): Promise<string> {
  const res = await fetchWithTimeout(
    `${PRINT_BRIDGE_URL}/install-printer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    },
    30_000,
  );
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    queue?: { name?: string };
    error?: string;
  } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `bridge returned ${res.status}`);
  }
  return body.queue?.name || target.name;
}

/** Send one encoded job to one printer through the bridge. */
export async function bridgePrintJob(
  printer: PrinterConfig,
  data: Uint8Array,
  copies = 1,
): Promise<void> {
  let base64: string;
  const bytes = new Uint8Array(data);
  if (typeof Buffer !== "undefined") {
    // Node/SSR environments never reach here (printing is browser-only),
    // but btoa rejects bytes > 255, so this is the safe general path.
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  }

  const res = await fetchWithTimeout(
    `${PRINT_BRIDGE_URL}/print`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connection: printer.connection,
        address: printer.address,
        copies,
        data: base64,
      }),
    },
    20_000,
  );
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `bridge returned ${res.status}`);
  }
}

export interface DispatchResult {
  /** "bridge" = silent multi-printer print happened; "fallback" = use the dialog path. */
  mode: "bridge" | "fallback";
  sent: string[];
  failed: Array<{ printer: string; error: string }>;
}

/**
 * A silent-print backend. The dispatcher asks each registered backend whether
 * it is available and routes jobs through the first one that is — today that
 * is always the local Python bridge, but a QZ Tray backend (WebSocket to
 * localhost:8199) can register here later without touching any call site.
 */
export interface PrintBackend {
  id: string;
  isAvailable(): Promise<boolean>;
  print(printer: PrinterConfig, data: Uint8Array, copies?: number): Promise<void>;
}

export const bridgeBackend: PrintBackend = {
  id: "bridge",
  isAvailable: () => bridgeStatus(),
  print: (printer, data, copies) => bridgePrintJob(printer, data, copies),
};

/** Registered backends, tried in order. Add qzBackend here when needed. */
export const PRINT_BACKENDS: PrintBackend[] = [bridgeBackend];

async function resolveBackend(): Promise<PrintBackend | null> {
  for (const backend of PRINT_BACKENDS) {
    if (await backend.isAvailable()) return backend;
  }
  return null;
}

/**
 * Print `doc` to every printer routed to it.
 *
 * `encode` receives the target printer's paper size, so a 58mm kitchen printer
 * and an 80mm reception printer each get a ticket laid out for their own roll.
 */
export async function dispatchPrint(
  doc: PrintDocType,
  encode: (paper: TicketPaper) => Uint8Array,
): Promise<DispatchResult> {
  const settings = loadPrinterSettings();
  const targets = printersForDoc(settings, doc);
  const empty: DispatchResult = { mode: "fallback", sent: [], failed: [] };

  // No routing configured — behave exactly as before this feature existed.
  if (targets.length === 0) return empty;

  const backend = await resolveBackend();
  if (!backend) {
    toast.warning("Print bridge is offline — using the browser print dialog instead.");
    return empty;
  }

  const sent: string[] = [];
  const failed: Array<{ printer: string; error: string }> = [];
  for (const printer of targets) {
    try {
      await backend.print(printer, encode(printer.paper));
      sent.push(printer.name);
    } catch (err) {
      failed.push({ printer: printer.name, error: (err as Error).message });
    }
  }

  if (failed.length > 0) {
    toast.error(
      `Could not print on: ${failed.map((f) => f.printer).join(", ")} — ${failed[0].error}`,
    );
  }

  // Nothing made it to paper — let the caller's dialog path rescue the print.
  if (sent.length === 0) return empty;
  return { mode: "bridge", sent, failed };
}
