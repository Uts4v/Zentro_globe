// src/features/tables/TablesAreasPage.tsx
// Tables & Areas: organise tables by where customers sit.
// The QR belongs to the table — renaming or moving never changes it.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  Armchair,
  Download,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { areaApi, merchantApi, tableApi, type MerchantTable, type TableArea } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  ListSkeleton,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import { useAccess } from "@/features/team/access";

const t = {
  title: "Tables & Areas",
  subtitle: "Organize your tables by area.",
  addArea: "Add Area",
  manage: "Manage",
  tables: (n: number) => `${n} table${n === 1 ? "" : "s"}`,
  off: "Turned off",
  areaName: "Area name",
  areaNamePlaceholder: "e.g. Bar",
  howMany: "How many tables?",
  prefix: "Table prefix",
  prefixHint: "Tables are named with this, like B1, B2…",
  start: "Starting number",
  seats: "Seats per table",
  preview: "Preview",
  createArea: "Create Area",
  addTables: "Add Tables",
  rename: "Rename Area",
  turnOff: "Turn Off Area",
  turnOn: "Turn On Area",
  removeArea: "Delete Area",
  editTable: "Edit Table",
  tableName: "Table name",
  area: "Area",
  seatsOne: "Seats",
  available: "Available",
  qr: "QR Code",
  viewQr: "View QR",
  downloadQr: "Download QR",
  printQr: "Print QR",
  newQr: "Make a new QR code",
  newQrConfirm: "Make a new QR code?",
  newQrBody:
    "The printed QR code for this table will stop working. Moving or renaming a table never needs this.",
  deleteTable: "Delete Table",
  deleteTableBody: "Tables with past orders are hidden, not deleted, so history stays correct.",
  save: "Save",
  noAreas: "No areas yet.",
  noAreasHint: "Add your first area, like Main Dining or Bar, and its tables.",
  noTables: "No tables in this area yet.",
  qrOrdering: "Customers can order from the table QR",
  qrOrderingHint: "Scanning a table's QR opens your menu for that table.",
  seatsShort: (n: number) => `${n} seat${n === 1 ? "" : "s"}`,
  unassigned: "Tables without an area",
};

function suggestPrefix(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words.length === 1
    ? words[0][0].toUpperCase()
    : words
        .map((w) => w[0].toUpperCase())
        .join("")
        .slice(0, 3);
}

function previewNames(prefix: string, count: number, start: number) {
  const n = Math.min(Math.max(count, 0), 200);
  const names = Array.from({ length: Math.min(n, 12) }, (_, i) => `${prefix}${start + i}`);
  return { names, more: Math.max(n - names.length, 0) };
}

function BulkFields({
  value,
  onChange,
}: {
  value: { count: string; prefix: string; start: string; seats: string };
  onChange: (v: { count: string; prefix: string; start: string; seats: string }) => void;
}) {
  const set = (k: keyof typeof value, v: string) => onChange({ ...value, [k]: v });
  const { names, more } = previewNames(
    value.prefix,
    Number(value.count) || 0,
    Number(value.start) || 1,
  );
  const num = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.howMany} htmlFor="bulk-count">
          <input
            id="bulk-count"
            inputMode="numeric"
            className={inputCls}
            value={value.count}
            onChange={(e) => set("count", num(e.target.value))}
          />
        </Field>
        <Field label={t.prefix} htmlFor="bulk-prefix" hint={t.prefixHint}>
          <input
            id="bulk-prefix"
            className={inputCls}
            maxLength={20}
            value={value.prefix}
            onChange={(e) => set("prefix", e.target.value)}
          />
        </Field>
        <Field label={t.start} htmlFor="bulk-start">
          <input
            id="bulk-start"
            inputMode="numeric"
            className={inputCls}
            value={value.start}
            onChange={(e) => set("start", num(e.target.value))}
          />
        </Field>
        <Field label={t.seats} htmlFor="bulk-seats">
          <input
            id="bulk-seats"
            inputMode="numeric"
            className={inputCls}
            value={value.seats}
            onChange={(e) => set("seats", num(e.target.value))}
          />
        </Field>
      </div>
      {names.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">{t.preview}</p>
          <div className="flex flex-wrap gap-1.5">
            {names.map((n) => (
              <span
                key={n}
                className="rounded-lg border border-border bg-muted px-2.5 py-1 text-sm font-semibold text-foreground"
              >
                {n}
              </span>
            ))}
            {more > 0 && (
              <span className="px-1 py-1 text-sm text-muted-foreground">+{more} more</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const emptyBulk = { count: "", prefix: "", start: "1", seats: "4" };
const toBulk = (b: typeof emptyBulk) => ({
  table_count: Number(b.count) || 0,
  prefix: b.prefix.trim(),
  start_number: Number(b.start) || 1,
  seats: Number(b.seats) || 4,
});

export function TablesAreasPage() {
  const qc = useQueryClient();
  const { merchantProfile } = useAuth();
  const { can } = useAccess();
  const canManage = can("tables.manage");
  const canSettings = can("settings.manage");
  const data = useQuery({ queryKey: ["tables", "areas"], queryFn: areaApi.list });
  const profile = useQuery({ queryKey: ["merchant", "me"], queryFn: merchantApi.me });
  const refresh = () => qc.invalidateQueries({ queryKey: ["tables"] });

  const [openArea, setOpenArea] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [areaName, setAreaName] = useState("");
  const [bulk, setBulk] = useState(emptyBulk);
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [addTablesTo, setAddTablesTo] = useState<TableArea | null>(null);
  const [renaming, setRenaming] = useState<TableArea | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<MerchantTable | null>(null);
  const [draft, setDraft] = useState({ name: "", area: 0, seats: "4", is_active: true });
  const [qrFor, setQrFor] = useState<MerchantTable | null>(null);
  const [confirm, setConfirm] = useState<null | {
    kind: "newQr" | "deleteTable" | "toggleArea" | "deleteArea";
    table?: MerchantTable;
    area?: TableArea;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const areas = data.data?.areas ?? [];
  const activeAreas = areas.filter((a) => a.is_active);
  const current = areas.find((a) => a.id === openArea) ?? null;
  const slug = profile.data?.slug ?? merchantProfile?.slug ?? "";
  const businessName = profile.data?.business_name ?? merchantProfile?.business_name ?? "";
  const qrUrl = (table: MerchantTable) =>
    `${window.location.origin}/m/${slug}/table/${table.public_token}`;

  async function run(fn: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      done?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function openEdit(table: MerchantTable) {
    setError("");
    setEditing(table);
    setDraft({
      name: table.name,
      area: table.area ?? 0,
      seats: String(table.seats),
      is_active: table.is_active,
    });
  }

  function downloadQr(table: MerchantTable) {
    const svg = document.getElementById("table-qr-svg")?.querySelector("svg");
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 500;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 400, 500);
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(businessName, 200, 35);
      ctx.font = "16px sans-serif";
      ctx.fillText(table.name, 200, 60);
      ctx.drawImage(img, 60, 80, 280, 280);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#666666";
      ctx.fillText("Scan to view menu and order", 200, 400);
      ctx.fillText("Powered by Zentro", 200, 430);
      const link = document.createElement("a");
      link.download = `${table.name.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(new XMLSerializer().serializeToString(svg));
  }

  const sortedTables = useMemo(
    () => (current ? [...current.tables].sort((a, b) => a.table_number - b.table_number) : []),
    [current],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-foreground">{t.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        {canManage && (
          <Button
            className="h-11"
            onClick={() => {
              setAreaName("");
              setBulk(emptyBulk);
              setPrefixTouched(false);
              setError("");
              setAddOpen(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> {t.addArea}
          </Button>
        )}
      </div>

      {canSettings && profile.data && (
        <div className="flex items-center justify-between gap-6 rounded-2xl border border-border bg-card px-4 py-3">
          <div>
            <p id="qr-ordering" className="font-semibold text-foreground">
              {t.qrOrdering}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.qrOrderingHint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={profile.data.table_ordering_enabled}
            aria-labelledby="qr-ordering"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await merchantApi.update({
                  table_ordering_enabled: !profile.data!.table_ordering_enabled,
                });
                await qc.invalidateQueries({ queryKey: ["merchant", "me"] });
              })
            }
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              profile.data.table_ordering_enabled ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${profile.data.table_ordering_enabled ? "translate-x-7" : "translate-x-1"}`}
            />
          </button>
        </div>
      )}

      {error && !addOpen && !editing && !addTablesTo && !renaming && <ErrorBlock message={error} />}

      {data.isLoading ? (
        <ListSkeleton rows={3} />
      ) : data.isError ? (
        <ErrorBlock message={errorMessage(data.error)} onRetry={() => data.refetch()} />
      ) : areas.length === 0 ? (
        <EmptyState icon={MapPin} title={t.noAreas} body={t.noAreasHint} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {areas.map((area) => (
            <div
              key={area.id}
              className={`flex items-center justify-between gap-3 rounded-2xl border p-4 shadow-sm ${
                area.id === openArea ? "border-primary bg-primary/5" : "border-border bg-card"
              } ${area.is_active ? "" : "opacity-70"}`}
            >
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">{area.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t.tables(area.table_count)}
                  {!area.is_active && ` · ${t.off}`}
                </p>
              </div>
              <Button
                variant={area.id === openArea ? "default" : "outline"}
                className="h-11"
                onClick={() => setOpenArea(area.id === openArea ? null : area.id)}
              >
                {t.manage}
              </Button>
            </div>
          ))}
        </div>
      )}

      {current && (
        <section
          className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5"
          aria-label={current.name}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-foreground">{current.name}</h2>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-11"
                  onClick={() => {
                    const numbers = current.tables.map((x) =>
                      Number(/(\d+)$/.exec(x.name)?.[1] ?? 0),
                    );
                    const prefix =
                      /^(.*?)(\d+)$/.exec(current.tables[0]?.name ?? "")?.[1] ??
                      suggestPrefix(current.name);
                    setBulk({
                      count: "",
                      prefix,
                      start: String(Math.max(0, ...numbers) + 1),
                      seats: String(current.tables[0]?.seats ?? 4),
                    });
                    setError("");
                    setAddTablesTo(current);
                  }}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> {t.addTables}
                </Button>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => {
                    setNewName(current.name);
                    setError("");
                    setRenaming(current);
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" /> {t.rename}
                </Button>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => setConfirm({ kind: "toggleArea", area: current })}
                >
                  {current.is_active ? t.turnOff : t.turnOn}
                </Button>
                {current.tables.length === 0 && (
                  <Button
                    variant="outline"
                    className="h-11 text-danger"
                    onClick={() => setConfirm({ kind: "deleteArea", area: current })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> {t.removeArea}
                  </Button>
                )}
              </div>
            )}
          </div>
          {sortedTables.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              {t.noTables}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {sortedTables.map((table) => (
                <li key={table.id}>
                  <button
                    type="button"
                    onClick={() => (canManage ? openEdit(table) : setQrFor(table))}
                    className={`flex min-h-[84px] w-full flex-col items-start justify-between rounded-2xl border p-3 text-left transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      table.is_active
                        ? "border-border bg-background"
                        : "border-dashed border-border bg-muted/50 opacity-70"
                    }`}
                  >
                    <span className="text-lg font-semibold text-foreground">{table.name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Armchair className="h-3.5 w-3.5" aria-hidden="true" />
                      {t.seatsShort(table.seats)}
                      {!table.is_active && ` · ${t.off}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(data.data?.unassigned.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">{t.unassigned}</h2>
          <div className="flex flex-wrap gap-2">
            {data.data?.unassigned.map((table) => (
              <Button
                key={table.id}
                variant="outline"
                className="h-11"
                onClick={() => openEdit(table)}
              >
                {table.name}
              </Button>
            ))}
          </div>
        </section>
      )}

      {/* Add area */}
      <Dialog open={addOpen} onOpenChange={(v) => !busy && setAddOpen(v)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.addArea}</DialogTitle>
            <DialogDescription>{t.subtitle}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                async () => {
                  const created = await areaApi.create(areaName.trim(), toBulk(bulk));
                  toast.success(`${created.name} created with ${t.tables(created.table_count)}.`);
                  setOpenArea(created.id);
                },
                () => setAddOpen(false),
              );
            }}
          >
            <Field label={t.areaName} htmlFor="area-name">
              <input
                id="area-name"
                autoFocus
                className={inputCls}
                maxLength={100}
                placeholder={t.areaNamePlaceholder}
                value={areaName}
                onChange={(e) => {
                  setAreaName(e.target.value);
                  if (!prefixTouched)
                    setBulk((b) => ({ ...b, prefix: suggestPrefix(e.target.value) }));
                }}
              />
            </Field>
            <BulkFields
              value={bulk}
              onChange={(v) => {
                if (v.prefix !== bulk.prefix) setPrefixTouched(true);
                setBulk(v);
              }}
            />
            {error && <ErrorBlock message={error} />}
            <Button type="submit" className="h-11 w-full" disabled={busy || !areaName.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t.createArea}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add more tables */}
      <Dialog open={Boolean(addTablesTo)} onOpenChange={(v) => !busy && !v && setAddTablesTo(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t.addTables} · {addTablesTo?.name}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!addTablesTo) return;
              run(
                async () => {
                  const made = await areaApi.addTables(addTablesTo.id, toBulk(bulk));
                  toast.success(`${t.tables(made.length)} added to ${addTablesTo.name}.`);
                },
                () => setAddTablesTo(null),
              );
            }}
          >
            <BulkFields value={bulk} onChange={setBulk} />
            {error && <ErrorBlock message={error} />}
            <Button type="submit" className="h-11 w-full" disabled={busy || !Number(bulk.count)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {t.addTables}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename area */}
      <Dialog open={Boolean(renaming)} onOpenChange={(v) => !busy && !v && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.rename}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming) return;
              run(
                () => areaApi.update(renaming.id, { name: newName.trim() }),
                () => setRenaming(null),
              );
            }}
          >
            <Field label={t.areaName} htmlFor="rename-area">
              <input
                id="rename-area"
                autoFocus
                className={inputCls}
                maxLength={100}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            {error && <ErrorBlock message={error} />}
            <Button type="submit" className="h-11 w-full" disabled={busy || !newName.trim()}>
              {t.save}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit table */}
      <Dialog open={Boolean(editing)} onOpenChange={(v) => !busy && !v && setEditing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.editTable}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  async () => {
                    await tableApi.update(editing.id, {
                      name: draft.name.trim(),
                      area: draft.area || undefined,
                      seats: Number(draft.seats) || 1,
                      is_active: draft.is_active,
                    } as Partial<MerchantTable>);
                    toast.success(`${draft.name.trim()} saved.`);
                  },
                  () => setEditing(null),
                );
              }}
            >
              <Field label={t.tableName} htmlFor="table-name">
                <input
                  id="table-name"
                  className={inputCls}
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label={t.area} htmlFor="table-area">
                <select
                  id="table-area"
                  className={inputCls}
                  value={draft.area || ""}
                  onChange={(e) => setDraft({ ...draft, area: Number(e.target.value) })}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {(activeAreas.some((a) => a.id === draft.area) ? activeAreas : areas).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.seatsOne} htmlFor="table-seats">
                <input
                  id="table-seats"
                  inputMode="numeric"
                  className={inputCls}
                  value={draft.seats}
                  onChange={(e) =>
                    setDraft({ ...draft, seats: e.target.value.replace(/\D/g, "").slice(0, 3) })
                  }
                />
              </Field>
              <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-border px-3">
                <span className="text-sm font-medium text-foreground">{t.available}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--primary)]"
                  checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                />
              </label>
              <div>
                <p className="mb-1.5 text-sm font-medium text-foreground">{t.qr}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => setQrFor(editing)}
                  >
                    <QrCode className="h-4 w-4" aria-hidden="true" /> {t.viewQr}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 text-muted-foreground"
                    onClick={() => setConfirm({ kind: "newQr", table: editing })}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t.newQr}
                  </Button>
                </div>
              </div>
              {error && <ErrorBlock message={error} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 text-danger"
                  onClick={() => setConfirm({ kind: "deleteTable", table: editing })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t.deleteTable}
                </Button>
                <Button
                  type="submit"
                  className="h-11 sm:min-w-32"
                  disabled={busy || !draft.name.trim()}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t.save}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* QR */}
      <Dialog open={Boolean(qrFor)} onOpenChange={(v) => !v && setQrFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{qrFor?.name}</DialogTitle>
            <DialogDescription>{businessName}</DialogDescription>
          </DialogHeader>
          {qrFor && (
            <div className="space-y-4 text-center">
              <div id="table-qr-svg" className="mx-auto inline-block rounded-2xl bg-white p-4">
                <QRCodeSVG value={qrUrl(qrFor)} size={220} />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button className="h-11" onClick={() => downloadQr(qrFor)}>
                  <Download className="h-4 w-4" aria-hidden="true" /> {t.downloadQr}
                </Button>
                <Button variant="outline" className="h-11" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" aria-hidden="true" /> {t.printQr}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm?.kind === "newQr"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={t.newQrConfirm}
        danger
        busy={busy}
        confirmLabel={t.newQr}
        body={<p>{t.newQrBody}</p>}
        onConfirm={() =>
          run(
            async () => {
              if (confirm?.table) setEditing(await tableApi.regenerateQR(confirm.table.id));
            },
            () => setConfirm(null),
          )
        }
      />
      <ConfirmDialog
        open={confirm?.kind === "deleteTable"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`${t.deleteTable}: ${confirm?.table?.name ?? ""}?`}
        danger
        busy={busy}
        confirmLabel={t.deleteTable}
        body={<p>{t.deleteTableBody}</p>}
        onConfirm={() =>
          run(
            async () => {
              if (confirm?.table) await tableApi.delete(confirm.table.id);
            },
            () => {
              setConfirm(null);
              setEditing(null);
            },
          ).finally(() => setConfirm(null))
        }
      />
      <ConfirmDialog
        open={confirm?.kind === "toggleArea"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`${confirm?.area?.is_active ? t.turnOff : t.turnOn}: ${confirm?.area?.name ?? ""}?`}
        busy={busy}
        confirmLabel={confirm?.area?.is_active ? t.turnOff : t.turnOn}
        onConfirm={() =>
          run(async () => {
            if (confirm?.area)
              await areaApi.update(confirm.area.id, { is_active: !confirm.area.is_active });
          }).finally(() => setConfirm(null))
        }
      />
      <ConfirmDialog
        open={confirm?.kind === "deleteArea"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={`${t.removeArea}: ${confirm?.area?.name ?? ""}?`}
        danger
        busy={busy}
        confirmLabel={t.removeArea}
        onConfirm={() =>
          run(
            async () => {
              if (confirm?.area) await areaApi.remove(confirm.area.id);
            },
            () => setOpenArea(null),
          ).finally(() => setConfirm(null))
        }
      />
    </div>
  );
}
