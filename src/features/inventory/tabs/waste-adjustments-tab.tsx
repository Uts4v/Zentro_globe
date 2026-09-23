// src/features/inventory/tabs/waste-adjustments-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2, SlidersHorizontal } from "lucide-react";
import {
  inventoryApi,
  type Adjustment,
  type InventoryItem,
  type InventoryLocation,
  type WasteRecord,
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
  formatQty,
  inputCls,
  errorMessage,
} from "@/features/inventory/components/bits";

export function WasteAdjustmentsTab({
  sym,
  initialMode = "waste",
}: {
  sym: string;
  initialMode?: "waste" | "adjustment";
}) {
  const [waste, setWaste] = useState<WasteRecord[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  const [wasteOpen, setWasteOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  // Waste draft
  const [wItem, setWItem] = useState("");
  const [wLocation, setWLocation] = useState("");
  const [wQty, setWQty] = useState("");
  const [wReason, setWReason] = useState("SPOILAGE");
  const [wCustom, setWCustom] = useState("");
  const [wNote, setWNote] = useState("");

  // Adjustment draft
  const [aItem, setAItem] = useState("");
  const [aLocation, setALocation] = useState("");
  const [aDelta, setADelta] = useState("");
  const [aReason, setAReason] = useState("");
  const [aNote, setANote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [w, a] = await Promise.all([inventoryApi.waste({}), inventoryApi.adjustments()]);
      setWaste(w.results ?? []);
      setAdjustments(a.results ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load waste & adjustments"));
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
  }, []);

  useEffect(() => {
    if (initialMode === "adjustment") setAdjOpen(true);
  }, [initialMode]);

  async function submitWaste() {
    if (!wItem || !wLocation || !wQty || Number(wQty) <= 0) {
      setFormError("Item, location and a positive quantity are required.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.recordWaste({
        inventory_item: Number(wItem),
        location: Number(wLocation),
        quantity: Number(wQty),
        reason: wReason,
        custom_reason: wReason === "OTHER" ? wCustom : "",
        note: wNote || undefined,
      });
      setWasteOpen(false);
      setWItem("");
      setWLocation("");
      setWQty("");
      setWCustom("");
      setWNote("");
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to record waste"));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjustment() {
    if (!aItem || !aLocation || !aReason || !aDelta || aDelta === "0") {
      setFormError("Item, location, reason and a non-zero delta are required.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.createAdjustment({
        inventory_item: Number(aItem),
        location: Number(aLocation),
        quantity_delta: Number(aDelta),
        reason: aReason,
        note: aNote || undefined,
      });
      setAdjOpen(false);
      setAItem("");
      setALocation("");
      setADelta("");
      setAReason("");
      setANote("");
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create adjustment"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Record Waste"
        subtitle="Record food or supplies that were spoiled, broken, spilled, or thrown away."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setFormError("");
                setAdjOpen(true);
              }}
            >
              <SlidersHorizontal className="h-4 w-4" /> Fix Stock
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                setWasteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" /> Record Waste
            </Button>
          </div>
        }
      />

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Waste */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Waste Records</h3>
            {waste.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                No waste recorded yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-4 py-2.5">Item</th>
                      <th className="px-4 py-2.5">Qty</th>
                      <th className="px-4 py-2.5">Reason</th>
                      <th className="px-4 py-2.5 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waste.map((w) => (
                      <tr key={w.id} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{w.item_name}</p>
                          <p className="text-xs text-muted-foreground">{w.location_name}</p>
                        </td>
                        <td className="px-4 py-2.5 text-rose-600">
                          -{formatQty(w.quantity)} <span className="text-xs">{w.unit_code}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{w.reason}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {formatDate(w.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Adjustments */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Stock Corrections</h3>
            {adjustments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                No adjustments yet.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-4 py-2.5">Item</th>
                      <th className="px-4 py-2.5">Add / Remove</th>
                      <th className="px-4 py-2.5">Reason</th>
                      <th className="px-4 py-2.5 text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((a) => {
                      const delta = Number(a.quantity_delta);
                      return (
                        <tr key={a.id} className="border-b border-border/50 last:border-0">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-foreground">{a.item_name}</p>
                            <p className="text-xs text-muted-foreground">{a.location_name}</p>
                          </td>
                          <td
                            className={`px-4 py-2.5 font-semibold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {delta >= 0 ? "+" : ""}
                            {formatQty(a.quantity_delta)}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{a.reason}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">
                            {formatDate(a.created_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Waste dialog */}
      <Dialog open={wasteOpen} onOpenChange={setWasteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Waste</DialogTitle>
            <DialogDescription>
              Removes stock explicitly. This is separate from count variance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Item">
                <select
                  className={inputCls}
                  value={wItem}
                  onChange={(e) => setWItem(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Location">
                <select
                  className={inputCls}
                  value={wLocation}
                  onChange={(e) => setWLocation(e.target.value)}
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <input
                  type="number"
                  step="any"
                  min="0"
                  className={inputCls}
                  value={wQty}
                  onChange={(e) => setWQty(e.target.value)}
                />
              </Field>
              <Field label="Reason">
                <select
                  className={inputCls}
                  value={wReason}
                  onChange={(e) => setWReason(e.target.value)}
                >
                  <option value="SPOILAGE">Spoiled</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="OVERPRODUCTION">Overproduction</option>
                  <option value="STAFF">Staff</option>
                  <option value="THEFT">Theft/Loss</option>
                  <option value="BREAKAGE">Breakage</option>
                  <option value="CONTAMINATION">Contamination</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
            </div>
            {wReason === "OTHER" && (
              <Field label="Custom Reason">
                <input
                  className={inputCls}
                  value={wCustom}
                  onChange={(e) => setWCustom(e.target.value)}
                />
              </Field>
            )}
            <Field label="Note" optional>
              <input
                className={inputCls}
                value={wNote}
                onChange={(e) => setWNote(e.target.value)}
              />
            </Field>
          </div>
          {formError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitWaste} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjustment dialog */}
      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fix Stock</DialogTitle>
            <DialogDescription>
              Correct a stock number when the previous count was wrong.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Item">
                <select
                  className={inputCls}
                  value={aItem}
                  onChange={(e) => setAItem(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Location">
                <select
                  className={inputCls}
                  value={aLocation}
                  onChange={(e) => setALocation(e.target.value)}
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Add stock or remove stock">
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={aDelta}
                  onChange={(e) => setADelta(e.target.value)}
                  placeholder="e.g. 2 or -2"
                />
              </Field>
              <Field label="Reason">
                <input
                  className={inputCls}
                  value={aReason}
                  onChange={(e) => setAReason(e.target.value)}
                  placeholder="e.g. Found unopened case"
                />
              </Field>
            </div>
            <Field label="Note" optional>
              <input
                className={inputCls}
                value={aNote}
                onChange={(e) => setANote(e.target.value)}
              />
            </Field>
          </div>
          {formError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAdjustment} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
