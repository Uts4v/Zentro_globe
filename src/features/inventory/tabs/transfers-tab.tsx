// src/features/inventory/tabs/transfers-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Trash2, ArrowLeftRight } from "lucide-react";
import { inventoryApi, type InventoryItem, type InventoryLocation, type Transfer } from "@/lib/api";
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
  uid,
} from "@/features/inventory/components/bits";

interface LineDraft {
  item_id: string;
  quantity: string;
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-mist text-muted-foreground",
  IN_TRANSIT: "bg-amber-100 text-amber-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-600",
};

export function TransfersTab() {
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ item_id: "", quantity: "" }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryApi.transfers();
      setRows(data.results ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load transfers"));
    } finally {
      setLoading(false);
    }
  }, []);

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
    inventoryApi
      .items({ include_balance: 0 })
      .then((d) => setItems(d.results ?? []))
      .catch(() => void 0);
  }, []);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!fromLoc || !toLoc) {
      setFormError("Both locations are required.");
      return;
    }
    if (fromLoc === toLoc) {
      setFormError("Source and destination must differ.");
      return;
    }
    const clean = lines.filter((l) => l.item_id && l.quantity && Number(l.quantity) > 0);
    if (clean.length === 0) {
      setFormError("Add at least one line with a quantity.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.createTransfer({
        from_location: Number(fromLoc),
        to_location: Number(toLoc),
        note: note || undefined,
        lines: clean.map((l) => ({
          item_id: Number(l.item_id),
          quantity: Number(l.quantity),
        })),
      });
      setOpen(false);
      setFromLoc("");
      setToLoc("");
      setNote("");
      setLines([{ item_id: "", quantity: "" }]);
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create transfer"));
    } finally {
      setBusy(false);
    }
  }

  async function complete(t: Transfer) {
    if (!window.confirm(`Complete transfer to ${t.to_name}? This moves stock and is irreversible.`))
      return;
    setBusy(true);
    try {
      await inventoryApi.completeTransfer(t.id, uid("transfer"));
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to complete transfer"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelTransfer(t: Transfer) {
    if (!window.confirm(`Cancel transfer to ${t.to_name}?`)) return;
    try {
      await inventoryApi.cancelTransfer(t.id);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to cancel transfer"));
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Move Stock"
        subtitle="Move items from one area to another."
        action={
          <Button
            onClick={() => {
              setLines([{ item_id: "", quantity: "" }]);
              setFormError("");
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Move Stock
          </Button>
        }
      />

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No transfers yet. Create one to move stock between locations.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3">From → To</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 md:table-cell">Items</th>
                <th className="hidden px-4 py-3 lg:table-cell">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 font-medium text-foreground">
                      {t.from_name}
                      <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.to_name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[t.status] ?? "bg-mist text-muted-foreground"}`}
                    >
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {t.lines.map((l) => (
                      <span key={l.id} className="mr-1 whitespace-nowrap">
                        {l.item_name} × {formatQty(l.quantity)}
                      </span>
                    ))}
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                    {formatDate(t.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {t.status === "IN_TRANSIT" && (
                        <Button size="sm" onClick={() => complete(t)} disabled={busy}>
                          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Complete
                        </Button>
                      )}
                      {(t.status === "DRAFT" || t.status === "IN_TRANSIT") && (
                        <Button size="sm" variant="outline" onClick={() => cancelTransfer(t)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Move Stock</DialogTitle>
            <DialogDescription>
              Choose where it is moving and how much.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Move from">
                <select
                  className={inputCls}
                  value={fromLoc}
                  onChange={(e) => setFromLoc(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Move to">
                <select
                  className={inputCls}
                  value={toLoc}
                  onChange={(e) => setToLoc(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Note" optional>
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  What are you moving?
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, { item_id: "", quantity: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <Field label="Item">
                      <select
                        className={inputCls}
                        value={l.item_id}
                        onChange={(e) => setLine(i, { item_id: e.target.value })}
                      >
                        <option value="">— Select item —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="w-24">
                    <Field label="Amount">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputCls}
                        value={l.quantity}
                        onChange={(e) => setLine(i, { quantity: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
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
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Move Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
