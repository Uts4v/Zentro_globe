// src/features/inventory/tabs/receiving-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, Trash2, ReceiptText } from "lucide-react";
import {
  inventoryApi,
  type InventoryItem,
  type InventoryLocation,
  type Receiving,
  type Supplier,
} from "@/lib/api";
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
  formatMoney,
  formatQty,
  inputCls,
  errorMessage,
} from "@/features/inventory/components/bits";

interface LineDraft {
  item_id: string;
  quantity: string;
  unit_cost: string;
}

export function ReceivingTab({ sym }: { sym: string }) {
  const [rows, setRows] = useState<Receiving[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [supplier, setSupplier] = useState("");
  const [location, setLocation] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ item_id: "", quantity: "", unit_cost: "" }]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryApi.receiving();
      setRows(data.results ?? []);
      setCount(data.count ?? data.results?.length ?? 0);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load receiving records"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    inventoryApi
      .items({ include_balance: 0 })
      .then((d) => setItems(d.results ?? []))
      .catch(() => void 0);
    inventoryApi
      .locations()
      .then((d) => {
        if (Array.isArray(d)) setLocations(d);
      })
      .catch(() => void 0);
    inventoryApi
      .suppliers(true)
      .then((d) => {
        if (Array.isArray(d)) setSuppliers(d);
      })
      .catch(() => void 0);
  }, []);

  function resetForm() {
    setSupplier("");
    setLocation("");
    setReference("");
    setNote("");
    setLines([{ item_id: "", quantity: "", unit_cost: "" }]);
    setFormError("");
  }

  function openCreate() {
    resetForm();
    setOpen(true);
  }

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!location) {
      setFormError("A receiving location is required.");
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
      await inventoryApi.createReceiving({
        supplier: supplier ? Number(supplier) : null,
        purchase_order: null,
        location: Number(location),
        reference: reference || undefined,
        note: note || undefined,
        lines: clean.map((l) => ({
          item_id: Number(l.item_id),
          quantity: Number(l.quantity),
          unit_cost: l.unit_cost ? Number(l.unit_cost) : null,
        })),
      });
      setOpen(false);
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create receiving record"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Add Delivery"
        subtitle="New stock arrived. Add it to the right place."
        action={
            <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Add Delivery
          </Button>
        }
      />

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No receiving records yet. Record your first delivery.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3 text-right">Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                      <ReceiptText className="h-4 w-4 text-muted-foreground" />
                      {r.receipt_number}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{r.supplier_name || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.location_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.reference || "—"}</td>
                  <td className="px-4 py-3 text-right font-medium text-foreground">
                    {formatMoney(r.total_value, sym)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {formatDate(r.received_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {count > 0 && <p className="text-xs text-muted-foreground">{count} record(s)</p>}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Delivery</DialogTitle>
            <DialogDescription>
              Add what arrived. Zentro handles pack and unit conversions for you.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Location">
                <select
                  className={inputCls}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier" optional>
                <select
                  className={inputCls}
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                >
                  <option value="">— None —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                  <Field label="Invoice / reference" optional>
                <input
                  className={inputCls}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Supplier invoice / delivery note"
                />
              </Field>
              <Field label="Note" optional>
                <input
                  className={inputCls}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  What arrived?
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setLines((prev) => [...prev, { item_id: "", quantity: "", unit_cost: "" }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              {lines.map((l, i) => {
                const item = items.find((it) => String(it.id) === l.item_id);
                return (
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
                    <div className="w-28">
                      <Field label="Cost per item" optional>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className={inputCls}
                          value={l.unit_cost}
                          onChange={(e) => setLine(i, { unit_cost: e.target.value })}
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
                    {item?.purchase_unit_label && (
                      <span className="pb-2 text-[11px] text-muted-foreground">
                        {item.purchase_unit_label}
                      </span>
                    )}
                  </div>
                );
              })}
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
              Add to Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
