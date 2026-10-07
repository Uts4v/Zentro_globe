/**
 * Printers & Routing — the terminal's multi-printer setup.
 *
 * Define each printer once (network IP or USB name), then choose which
 * printers each document type goes to: KOTs to kitchen + reception, bills to
 * reception only. Saves to localStorage immediately — printers belong to this
 * machine, not to the merchant account, so they are independent of the main
 * Save Settings button above.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Bluetooth,
  Check,
  Download,
  Loader2,
  Network,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
  Usb,
  Wifi,
  X,
} from "lucide-react";
import {
  emptyPrinterSettings,
  loadPrinterSettings,
  newPrinterId,
  PRINT_DOC_LABELS,
  savePrinterSettings,
  type PrintDocType,
  type PrinterConfig,
  type PrinterConnection,
  type PrinterSettings,
} from "./printers";
import {
  bridgeInstallPrinter,
  bridgeListDevices,
  bridgeListPrinters,
  bridgePrintJob,
  bridgeScanNetwork,
  bridgeStatus,
  type BridgeNetworkHost,
  type BridgePrinterDevice,
} from "./print-bridge";
import { testTicketToEscPos } from "./escpos";
import type { TicketPaper } from "./ticket-style";

const DOC_TYPES: PrintDocType[] = ["kot", "bill", "zreport"];

interface FormState {
  editingId: string | null;
  name: string;
  connection: PrinterConnection;
  address: string;
  paper: TicketPaper;
}

const EMPTY_FORM: FormState = {
  editingId: null,
  name: "",
  connection: "network",
  address: "",
  paper: "58mm",
};

const FIELD =
  "w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink";

export function PrinterSettingsSection() {
  const [settings, setSettings] = useState<PrinterSettings>(emptyPrinterSettings());
  const [bridge, setBridge] = useState<"checking" | "online" | "offline">("checking");
  const [osPrinters, setOsPrinters] = useState<string[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [devices, setDevices] = useState<BridgePrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [installingPort, setInstallingPort] = useState<string | null>(null);
  const [netHosts, setNetHosts] = useState<BridgeNetworkHost[]>([]);
  const [netSubnets, setNetSubnets] = useState<string[]>([]);
  const [netScanning, setNetScanning] = useState(false);
  const [downloadingInstaller, setDownloadingInstaller] = useState(false);

  const persist = useCallback((next: PrinterSettings) => {
    setSettings(next);
    savePrinterSettings(next);
  }, []);

  const scanDevices = useCallback(async () => {
    setScanning(true);
    try {
      setDevices(await bridgeListDevices());
    } finally {
      setScanning(false);
    }
  }, []);

  /** Probe this terminal's LAN for raw printers on port 9100. */
  const scanNetwork = useCallback(async () => {
    setNetScanning(true);
    try {
      const result = await bridgeScanNetwork();
      setNetHosts(result.hosts);
      setNetSubnets(result.subnets);
      if (result.hosts.length === 0) {
        toast.info(
          `No printers found on ${result.subnets.join(", ") || "the local network"} (${result.scanned} hosts probed).`,
        );
      }
    } finally {
      setNetScanning(false);
    }
  }, []);

  const checkBridge = useCallback(async () => {
    setBridge("checking");
    const online = await bridgeStatus();
    setBridge(online ? "online" : "offline");
    if (online) {
      const names = await bridgeListPrinters();
      setOsPrinters(names);
      // Hardware scan runs in the background — it must not delay the status dot.
      void scanDevices();
    }
  }, [scanDevices]);

  // localStorage is unavailable during SSR, so settings load after mount.
  useEffect(() => {
    setSettings(loadPrinterSettings());
    void checkBridge();
  }, [checkBridge]);

  /** Download the terminal's one-click agent installer, filled with this app's address. */
  const downloadAgentInstaller = useCallback(async () => {
    setDownloadingInstaller(true);
    try {
      const res = await fetch("/printer-agent/setup-print-agent.bat");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const template = await res.text();
      const filled = template.replaceAll("__APP_ORIGIN__", window.location.origin);
      const blob = new Blob([filled], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "setup-print-agent.bat";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Downloaded setup-print-agent.bat — double-click it on this PC.");
    } catch (err) {
      toast.error(`Could not prepare the download: ${(err as Error).message}`);
    } finally {
      setDownloadingInstaller(false);
    }
  }, []);

  function startAdd() {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function startEdit(printer: PrinterConfig) {
    setForm({
      editingId: printer.id,
      name: printer.name,
      connection: printer.connection,
      address: printer.address,
      paper: printer.paper,
    });
    setFormOpen(true);
  }

  function submitForm() {
    const name = form.name.trim();
    const address = form.address.trim();
    if (!name || !address) {
      toast.error("Give the printer a name and an address.");
      return;
    }
    const next: PrinterSettings = { ...settings, printers: [...settings.printers] };
    if (form.editingId) {
      next.printers = next.printers.map((p) =>
        p.id === form.editingId
          ? { ...p, name, connection: form.connection, address, paper: form.paper }
          : p,
      );
    } else {
      next.printers.push({
        id: newPrinterId(),
        name,
        connection: form.connection,
        address,
        paper: form.paper,
        enabled: true,
      });
    }
    persist(next);
    setFormOpen(false);
    toast.success(form.editingId ? `Updated "${name}".` : `Added "${name}".`);
  }

  function removePrinter(printer: PrinterConfig) {
    const next: PrinterSettings = {
      printers: settings.printers.filter((p) => p.id !== printer.id),
      routing: {
        kot: settings.routing.kot.filter((id) => id !== printer.id),
        bill: settings.routing.bill.filter((id) => id !== printer.id),
        zreport: settings.routing.zreport.filter((id) => id !== printer.id),
      },
    };
    persist(next);
    toast.success(`Removed "${printer.name}".`);
  }

  function toggleRouting(doc: PrintDocType, printerId: string) {
    const current = settings.routing[doc];
    const routing = {
      ...settings.routing,
      [doc]: current.includes(printerId)
        ? current.filter((id) => id !== printerId)
        : [...current, printerId],
    };
    persist({ ...settings, routing });
  }

  async function testPrint(printer: PrinterConfig) {
    setTestingId(printer.id);
    try {
      await bridgePrintJob(printer, testTicketToEscPos(printer));
      toast.success(`Test ticket sent to "${printer.name}".`);
    } catch (err) {
      toast.error(`Test failed on "${printer.name}": ${(err as Error).message}`);
      void checkBridge();
    } finally {
      setTestingId(null);
    }
  }

  /** Prefill the add-printer form from a detected device that has a queue. */
  function selectQueue(queue: string) {
    setForm({ editingId: null, name: queue, connection: "usb", address: queue, paper: "58mm" });
    setFormOpen(true);
  }

  /** Prefill the add-printer form from a scanned network printer. */
  function selectNetworkHost(host: BridgeNetworkHost) {
    setForm({
      editingId: null,
      name: `Printer ${host.ip}`,
      connection: "network",
      address: host.ip,
      paper: "58mm",
    });
    setFormOpen(true);
  }

  /** Create the missing Windows queue for a device that is plugged in but unrouted. */
  async function installDevice(device: BridgePrinterDevice) {
    if (!device.port) return;
    setInstallingPort(device.port);
    try {
      const queueName = `${device.name} ${device.port}`;
      const created = await bridgeInstallPrinter({ name: queueName, port: device.port });
      toast.success(`Installed queue "${created}" — now click "Use in app".`);
      await scanDevices();
      setOsPrinters(await bridgeListPrinters());
    } catch (err) {
      toast.error(`Could not install queue: ${(err as Error).message}`);
    } finally {
      setInstallingPort(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">Printers & Routing</h2>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              bridge === "online"
                ? "text-green-600"
                : bridge === "offline"
                  ? "text-amber-600"
                  : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                bridge === "online"
                  ? "bg-green-500"
                  : bridge === "offline"
                    ? "bg-amber-500"
                    : "bg-muted-foreground/50 animate-pulse"
              }`}
            />
            {bridge === "checking"
              ? "Checking bridge…"
              : bridge === "online"
                ? "Print bridge online"
                : "Print bridge offline"}
          </span>
          <button
            type="button"
            onClick={() => void checkBridge()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted"
            aria-label="Recheck print bridge"
            title="Recheck print bridge"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${bridge === "checking" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {bridge === "offline" && (
        <div className="mb-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-800">
            Silent multi-printer printing needs the local print agent on this terminal. Until it's
            installed, prints use the browser dialog as before.
          </p>
          <button
            type="button"
            onClick={() => void downloadAgentInstaller()}
            disabled={downloadingInstaller}
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloadingInstaller ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {downloadingInstaller ? "Preparing…" : "Download print agent (Windows)"}
          </button>
          <p className="mt-2 text-xs text-amber-800">
            Run the downloaded <code className="font-semibold">setup-print-agent.bat</code> on this
            PC, wait for "Done!", then click Recheck above. No admin rights or Python needed.
          </p>
        </div>
      )}

      {/* Printers */}
      <div className="space-y-3">
        {settings.printers.map((printer) => (
          <div
            key={printer.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3"
          >
            <Printer className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{printer.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-semibold uppercase">
                  {printer.connection}
                </span>{" "}
                {printer.address} · {printer.paper}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void testPrint(printer)}
                disabled={testingId !== null || bridge !== "online"}
                title={bridge !== "online" ? "Print bridge is offline" : "Print a test ticket"}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                {testingId === printer.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                Test
              </button>
              <button
                type="button"
                onClick={() => startEdit(printer)}
                aria-label={`Edit ${printer.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => removePrinter(printer)}
                aria-label={`Delete ${printer.name}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {settings.printers.length === 0 && !formOpen && (
          <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
            No printers yet. Add your kitchen and reception printers to send KOTs and bills straight
            to them without the browser print dialog.
          </p>
        )}

        {/* Add / edit form */}
        {formOpen && (
          <div className="space-y-3 rounded-xl border border-ink/40 bg-background p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Printer name</label>
                <input
                  className={FIELD}
                  placeholder="Kitchen / Reception"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Connection</label>
                <select
                  className={FIELD}
                  value={form.connection}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, connection: e.target.value as PrinterConnection }))
                  }
                >
                  <option value="network">Network (IP address)</option>
                  <option value="usb">USB / installed printer</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {form.connection === "network" ? "Printer IP address" : "Printer name (OS)"}
                </label>
                <input
                  className={FIELD}
                  list={form.connection === "usb" ? "zentro-os-printers" : undefined}
                  placeholder={form.connection === "network" ? "192.168.1.50" : "TVSE RP3200 Lite"}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Paper size</label>
                <select
                  className={FIELD}
                  value={form.paper}
                  onChange={(e) => setForm((f) => ({ ...f, paper: e.target.value as TicketPaper }))}
                >
                  <option value="58mm">58mm (narrow roll)</option>
                  <option value="80mm">80mm (standard roll)</option>
                  <option value="a4">A4</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {form.connection === "network"
                ? "Find the printer's IP from its panel or router. Raw port 9100 is used automatically."
                : "Pick from printers installed on this PC, or type a device path like /dev/usb/lp0."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitForm}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-4 text-xs font-bold text-white hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" />
                {form.editingId ? "Update printer" : "Add printer"}
              </button>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-xs font-semibold text-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          </div>
        )}

        {!formOpen && (
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            Add printer
          </button>
        )}
      </div>

      {/* Hardware detection — what this terminal can actually reach */}
      {bridge === "online" && (
        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Detected on this PC
            </h3>
            <button
              type="button"
              onClick={() => void scanDevices()}
              disabled={scanning}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              {scanning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Scan
            </button>
          </div>
          {!scanning && devices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No printer hardware found. Check the USB connection and click Scan again.
            </p>
          )}
          <div className="space-y-2">
            {devices.map((device, index) => {
              const portKey = device.port ?? `dev-${index}`;
              const alreadyAdded =
                !!device.queue &&
                settings.printers.some((p) => p.connection === "usb" && p.address === device.queue);
              return (
                <div
                  key={portKey}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5"
                >
                  {device.bluetooth ? (
                    <Bluetooth className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Usb className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{device.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {device.bluetooth ? "Bluetooth" : (device.port ?? "unknown port")}
                      {device.queue ? (
                        <>
                          {" → queue "}
                          <span className="font-medium text-foreground">{device.queue}</span>
                        </>
                      ) : device.bluetooth ? (
                        " → pair it in Windows Settings first"
                      ) : (
                        " → no print queue yet"
                      )}
                    </p>
                  </div>
                  {device.queue ? (
                    alreadyAdded ? (
                      <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-green-50 px-2.5 text-xs font-semibold text-green-700">
                        <Check className="h-3.5 w-3.5" />
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectQueue(device.queue as string)}
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                      >
                        Use in app
                      </button>
                    )
                  ) : !device.bluetooth ? (
                    <button
                      type="button"
                      onClick={() => void installDevice(device)}
                      disabled={!device.port || installingPort !== null}
                      title="Create a print queue for this printer, then add it in the app"
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {installingPort === device.port ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Install queue
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            A plugged-in printer only receives jobs after it has a print queue. Use a detected
            printer above to prefill the form, or install its queue first.
          </p>

          {/* Network printers — WiFi/Ethernet devices on this terminal's LAN */}
          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Wifi className="h-3.5 w-3.5" />
                  Network printers (WiFi / Ethernet)
                </h3>
                {netSubnets.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {netSubnets.join(", ")} · {netHosts.length} found
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void scanNetwork()}
                disabled={netScanning}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {netScanning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Network className="h-3.5 w-3.5" />
                )}
                {netScanning ? "Scanning…" : "Scan network"}
              </button>
            </div>
            {!netScanning && netHosts.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Scans this terminal's local subnet on port 9100 (raw printing) — private addresses
                only. Click Scan network to look for printers without an installed queue.
              </p>
            )}
            <div className="space-y-2">
              {netHosts.map((host) => {
                const alreadyAdded = settings.printers.some(
                  (p) => p.connection === "network" && p.address.split(":")[0] === host.ip,
                );
                return (
                  <div
                    key={host.ip}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5"
                  >
                    <Network className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{host.ip}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {host.escpos ? "ESC/POS printer" : "device on port 9100"} ·{" "}
                        {host.latency_ms} ms
                      </p>
                    </div>
                    {alreadyAdded ? (
                      <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-green-50 px-2.5 text-xs font-semibold text-green-700">
                        <Check className="h-3.5 w-3.5" />
                        Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => selectNetworkHost(host)}
                        className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                      >
                        Use in app
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Routing */}
      <div className="mt-6 border-t border-border pt-4">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Where each document prints
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Tick every printer a document should reach — e.g. KOT on Kitchen + Reception, Bill on
          Reception only. Unrouted documents keep using the browser print dialog.
        </p>
        <div className="space-y-4">
          {DOC_TYPES.map((doc) => (
            <div key={doc}>
              <p className="mb-2 text-sm font-medium text-foreground">{PRINT_DOC_LABELS[doc]}</p>
              <div className="flex flex-wrap gap-2">
                {settings.printers.map((printer) => {
                  const selected = settings.routing[doc].includes(printer.id);
                  return (
                    <button
                      key={printer.id}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggleRouting(doc, printer.id)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition ${
                        selected
                          ? "border-ink bg-ink text-white"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {printer.name}
                    </button>
                  );
                })}
                {settings.printers.length === 0 && (
                  <span className="text-xs text-muted-foreground">Add a printer first.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <datalist id="zentro-os-printers">
        {osPrinters.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </section>
  );
}
