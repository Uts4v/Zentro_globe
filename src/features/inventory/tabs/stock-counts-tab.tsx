// src/features/inventory/tabs/stock-counts-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Check, CheckCheck, XCircle, ClipboardList } from "lucide-react";
import { inventoryApi, type InventoryLocation, type StockCount } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ErrorBlock,
  Field,
  LoadingBlock,
  SectionHeader,
  formatDate,
  formatQty,
  inputCls,
  errorMessage,
} from "@/features/inventory/components/bits";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-mist text-muted-foreground",
  SUBMITTED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-600",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Not Finished",
  SUBMITTED: "Waiting for Review",
  APPROVED: "Updated",
  CANCELLED: "Cancelled",
};

export function StockCountsTab() {
  const [rows, setRows] = useState<StockCount[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  // Working panel
  const [active, setActive] = useState<StockCount | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);
  const [savingLine, setSavingLine] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryApi.counts({ status: statusFilter || undefined });
      setRows(data.results ?? []);
      setCount(data.count ?? data.results?.length ?? 0);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load stock counts"));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    inventoryApi
      .locations()
      .then((d) => {
        if (Array.isArray(d)) setLocations(d);
      })
      .catch(() => void 0);
  }, []);

  async function createCount() {
    const locationName = locations.find((l) => String(l.id) === location)?.name;
    const countName =
      name.trim() || `${locationName || "All Stock"} Count · ${new Date().toLocaleDateString()}`;
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.createCount({
        name: countName,
        count_type: "Stock Count",
        location: location ? Number(location) : null,
        item_ids: [],
        note: note || "",
      });
      setOpen(false);
      setName("");
      setLocation("");
      setNote("");
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create count"));
    } finally {
      setBusy(false);
    }
  }

  async function openCount(c: StockCount) {
    setActive(c);
    setActiveLoading(true);
    setError("");
    try {
      const detail = await inventoryApi.countDetail(c.id);
      setActive(detail);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load count details"));
    } finally {
      setActiveLoading(false);
    }
  }

  async function saveLine(lineId: number, physical: string) {
    if (!active) return;
    setSavingLine(lineId);
    setError("");
    try {
      await inventoryApi.upsertCountLine(active.id, {
        line_id: lineId,
        physical_quantity: physical === "" ? null : Number(physical),
      });
      const detail = await inventoryApi.countDetail(active.id);
      setActive(detail);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to save count line"));
    } finally {
      setSavingLine(null);
    }
  }

  async function submitCount() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const updated = await inventoryApi.submitCount(active.id);
      setActive(updated);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to submit count"));
    } finally {
      setBusy(false);
    }
  }

  async function approveCount() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const updated = await inventoryApi.approveCount(active.id);
      setActive(updated);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to approve count"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCount() {
    if (!active) return;
    if (!window.confirm("Cancel this count? Submitted counts cannot be cancelled.")) return;
    setBusy(true);
    setError("");
    try {
      const updated = await inventoryApi.cancelCount(active.id);
      setActive(updated);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to cancel count"));
    } finally {
      setBusy(false);
    }
  }

  const canEdit = active && active.status === "DRAFT";
  const canSubmit = active && active.status === "DRAFT";
  const canApprove = active && active.status === "SUBMITTED";
  const canCancel = active && active.status === "DRAFT";

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Count Stock"
        subtitle="Check what is physically on the shelf."
        action={
          <div className="flex items-center gap-2">
            <select
              className={`${inputCls} w-36`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All counts</option>
              <option value="DRAFT">Not Finished</option>
              <option value="SUBMITTED">Waiting for Review</option>
              <option value="APPROVED">Updated</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <Button
              onClick={() => {
                setFormError("");
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Count Stock
            </Button>
          </div>
        }
      />

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : active ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <p className="font-semibold text-foreground">{active.name}</p>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[active.status] ?? "bg-mist text-muted-foreground"}`}
                >
                  {active.status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                  {active.location_name} · {active.counted_count} of {active.line_count} counted
                {active.approved_at ? ` · approved ${formatDate(active.approved_at)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setActive(null)}>
                Back to list
              </Button>
              {canSubmit && (
                <Button size="sm" onClick={submitCount} disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Finish Count
                </Button>
              )}
              {canApprove && (
                <Button size="sm" onClick={approveCount} disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="h-3.5 w-3.5" />
                  )}
                  Approve & Update Stock
                </Button>
              )}
              {canCancel && (
                <Button size="sm" variant="outline" onClick={cancelCount} disabled={busy}>
                  <XCircle className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </div>
          </div>

          {activeLoading ? (
            <LoadingBlock />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3 text-right">System Says</th>
                    <th className="px-4 py-3 text-right">You Counted</th>
                    <th className="px-4 py-3 text-right">Difference</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Last Count</th>
                  </tr>
                </thead>
                <tbody>
                  {active.lines.map((ln) => {
                    const diff =
                      ln.difference === null || ln.difference === undefined
                        ? null
                        : Number(ln.difference);
                    return (
                      <tr
                        key={ln.id}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground">{ln.item_name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{ln.location_name}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {formatQty(ln.book_quantity)}{" "}
                          <span className="text-xs">{ln.unit_code}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {canEdit ? (
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                className={`${inputCls} w-28 text-right`}
                                key={ln.id}
                                defaultValue={ln.physical_quantity ?? ""}
                                onBlur={(e) => {
                                  const v = e.target.value;
                                  if (v !== (ln.physical_quantity ?? "")) saveLine(ln.id, v);
                                }}
                              />
                              {savingLine === ln.id && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              )}
                            </span>
                          ) : (
                            <span className="font-medium text-foreground">
                              {formatQty(ln.physical_quantity)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {diff === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={`font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-muted-foreground"}`}
                            >
                              {diff === 0
                                ? "Matches"
                                : `${formatQty(Math.abs(diff))} ${ln.unit_code} ${diff > 0 ? "more" : "less"}`}
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-2.5 text-right text-xs text-muted-foreground lg:table-cell">
                          {formatDate(ln.previous_count_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No stock counts found. Start a new physical count to keep stock accurate.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3">Count</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Counted</th>
                <th className="hidden px-4 py-3 lg:table-cell">Started</th>
                <th className="px-4 py-3 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <button
                      className="font-medium text-primary hover:underline"
                      onClick={() => openCount(c)}
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.location_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[c.status] ?? "bg-mist text-muted-foreground"}`}
                    >
                      {STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {c.counted_count}/{c.line_count}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                    {formatDate(c.started_at || c.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => openCount(c)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!active && count > 0 && <p className="text-xs text-muted-foreground">{count} count(s)</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Stock Count</DialogTitle>
            <DialogDescription>
              Opens a count over all active items (or just a location). Physical entries here will
              reconcile balance on approval.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Daily kitchen count"
              />
            </Field>
            <Field label="Location" optional>
              <select
                className={inputCls}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note" optional>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {formError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createCount} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Start Count
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
