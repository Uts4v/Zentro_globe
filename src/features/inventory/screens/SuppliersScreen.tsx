// src/features/inventory/screens/SuppliersScreen.tsx
// Suppliers and Orders From Suppliers (manager feature). Receiving an order
// adds only what actually arrived, through the stock movement service.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Loader2, Trash2, Building2, PackageCheck } from "lucide-react";
import {
  inventoryApi,
  type InventoryItem,
  type InventoryLocation,
  type PurchaseOrder,
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
  ScreenHeader,
  SectionHeader,
  formatDate,
  formatMoney,
  formatQty,
  inputCls,
  errorMessage,
  uid,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";

const PO_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-mist text-muted-foreground",
  SENT: "bg-periwinkle-soft text-info",
  PARTIALLY_RECEIVED: "bg-butter-soft text-[#8a5d1f]",
  RECEIVED: "bg-olive-soft text-olive",
  CANCELLED: "bg-bordeaux-soft text-danger",
};

const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Ordered",
  PARTIALLY_RECEIVED: "Partly delivered",
  RECEIVED: "Delivered",
  CANCELLED: "Cancelled",
};

interface POLine {
  inventory_item: string;
  quantity: string;
  unit_cost: string;
}

export function SuppliersTab({
  sym,
  canCost = true,
  onBack,
}: {
  sym: string;
  canCost?: boolean;
  onBack?: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  // Supplier create
  const [supOpen, setSupOpen] = useState(false);
  const [supName, setSupName] = useState("");
  const [supContact, setSupContact] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supTerms, setSupTerms] = useState("");
  // PO create
  const [poOpen, setPoOpen] = useState(false);
  const [poSupplier, setPoSupplier] = useState("");
  const [poLocation, setPoLocation] = useState("");
  const [poDate, setPoDate] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<POLine[]>([
    { inventory_item: "", quantity: "", unit_cost: "" },
  ]);
  // PO receive
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [recvLocation, setRecvLocation] = useState("");
  const [recvQty, setRecvQty] = useState<Record<number, string>>({});
  const [recvCost, setRecvCost] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, p] = await Promise.all([
        inventoryApi.suppliers(true),
        inventoryApi.purchaseOrders({}),
      ]);
      if (Array.isArray(s)) setSuppliers(s);
      setPos(p.results ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load suppliers & purchase orders"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    inventoryApi
      .items({ include_balance: 0, page_size: 200 })
      .then((d) => setItems(d.results ?? []))
      .catch(() => void 0);
    inventoryApi
      .locations()
      .then((d) => {
        if (Array.isArray(d)) setLocations(d);
      })
      .catch(() => void 0);
  }, []);

  async function createSupplier() {
    if (!supName.trim()) {
      setFormError("Supplier name is required.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.createSupplier({
        name: supName.trim(),
        contact_person: supContact || "",
        phone: supPhone || "",
        payment_terms: supTerms || "",
        is_active: true,
      });
      setSupOpen(false);
      setSupName("");
      setSupContact("");
      setSupPhone("");
      setSupTerms("");
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create supplier"));
    } finally {
      setBusy(false);
    }
  }

  function setPoLine(i: number, patch: Partial<POLine>) {
    setPoLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createPO() {
    if (!poSupplier || !poLocation) {
      setFormError("Supplier and delivery location are required.");
      return;
    }
    const clean = poLines.filter((l) => l.inventory_item && l.quantity && Number(l.quantity) > 0);
    if (clean.length === 0) {
      setFormError("Add at least one line.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.createPurchaseOrder({
        supplier: Number(poSupplier),
        delivery_location: Number(poLocation),
        expected_date: poDate || null,
        notes: poNotes || "",
        lines: clean.map((l) => ({
          inventory_item: Number(l.inventory_item),
          quantity: Number(l.quantity),
          unit_cost: l.unit_cost ? Number(l.unit_cost) : 0,
        })),
      });
      setPoOpen(false);
      setPoLines([{ inventory_item: "", quantity: "", unit_cost: "" }]);
      load();
    } catch (e: unknown) {
      setFormError(errorMessage(e, "Failed to create purchase order"));
    } finally {
      setBusy(false);
    }
  }

  const receiveKey = useRef(uid("po-recv"));

  function openReceive(po: PurchaseOrder) {
    receiveKey.current = uid("po-recv");
    setReceiving(po);
    setRecvLocation("");
    const q: Record<number, string> = {};
    const c: Record<number, string> = {};
    po.lines.forEach((l) => {
      q[l.id] = formatQty(l.remaining);
      c[l.id] = formatQty(l.unit_cost);
    });
    setRecvQty(q);
    setRecvCost(c);
    setFormError("");
  }

  async function submitReceive() {
    if (!receiving) return;
    const received: Record<string, { quantity: number; unit_cost: number | null }> = {};
    receiving.lines.forEach((l) => {
      const q = recvQty[l.id];
      if (q && Number(q) > 0) {
        received[String(l.id)] = {
          quantity: Number(q),
          unit_cost: recvCost[l.id] ? Number(recvCost[l.id]) : null,
        };
      }
    });
    if (Object.keys(received).length === 0) {
      setFormError("Enter a received quantity for at least one line.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await inventoryApi.receivePurchaseOrder(receiving.id, {
        received,
        location: recvLocation ? Number(recvLocation) : null,
        idempotency_key: receiveKey.current,
      });
      setReceiving(null);
      load();
    } catch (e: unknown) {
      setFormError(
        `Delivery was not added. Your stock has not changed. ${errorMessage(e, "")}`.trim(),
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelPO(po: PurchaseOrder) {
    if (
      !window.confirm(
        `Cancel order ${po.po_number}? Nothing has arrived yet, so stock does not change.`,
      )
    )
      return;
    try {
      await inventoryApi.cancelPurchaseOrder(po.id);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Could not cancel this order."));
    }
  }

  return (
    <div className="space-y-8">
      {onBack && <ScreenHeader title={copy.suppliers.title} onBack={onBack} />}
      {/* Suppliers */}
      <div className="space-y-4">
        <SectionHeader
          title="Suppliers"
          subtitle="People and businesses you buy stock from."
          action={
            <Button
              onClick={() => {
                setFormError("");
                setSupOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Add Supplier
            </Button>
          }
        />

        {error && <ErrorBlock message={error} />}

        {loading ? (
          <LoadingBlock />
        ) : suppliers.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No suppliers yet. Add your first vendor.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((s) => (
              <div key={s.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-mist">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.contact_person || "—"} {s.phone ? `· ${s.phone}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] text-muted-foreground">
                    {s.item_mappings.length} item(s)
                  </span>
                  {s.payment_terms && (
                    <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] text-muted-foreground">
                      {s.payment_terms}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Purchase orders */}
      <div className="space-y-4">
        <SectionHeader
          title="Orders from Suppliers"
          subtitle="Plan an order, then add stock when the delivery arrives."
          action={
            <Button
              onClick={() => {
                setFormError("");
                setPoOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New Supplier Order
            </Button>
          }
        />

        {pos.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No supplier orders yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-3">Supplier Order</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="hidden px-4 py-3 md:table-cell">Expected</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((po) => (
                  <tr
                    key={po.id}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                        <PackageCheck className="h-4 w-4 text-muted-foreground" />
                        {po.po_number}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{po.supplier_name}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${PO_STATUS_STYLE[po.status] ?? "bg-mist text-muted-foreground"}`}
                      >
                        {PO_STATUS_LABEL[po.status] ?? po.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground">
                      {canCost ? formatMoney(po.total_amount, sym) : "—"}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {formatDate(po.expected_date)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {(po.status === "DRAFT" || po.status === "SENT") && (
                          <Button size="sm" variant="outline" onClick={() => cancelPO(po)}>
                            Cancel
                          </Button>
                        )}
                        {["DRAFT", "SENT", "PARTIALLY_RECEIVED"].includes(po.status) && (
                          <Button size="sm" onClick={() => openReceive(po)}>
                            Add Delivery
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
      </div>

      {/* Supplier dialog */}
      <Dialog open={supOpen} onOpenChange={setSupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>
              Basic vendor details; items can be linked after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name">
              <input
                className={inputCls}
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Contact Person" optional>
                <input
                  className={inputCls}
                  value={supContact}
                  onChange={(e) => setSupContact(e.target.value)}
                />
              </Field>
              <Field label="Phone" optional>
                <input
                  className={inputCls}
                  value={supPhone}
                  onChange={(e) => setSupPhone(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Payment Terms" optional>
              <input
                className={inputCls}
                value={supTerms}
                onChange={(e) => setSupTerms(e.target.value)}
                placeholder="e.g. Net 30"
              />
            </Field>
          </div>
          {formError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createSupplier} disabled={busy || !supName.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add Supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New PO dialog */}
      <Dialog open={poOpen} onOpenChange={setPoOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Supplier Order</DialogTitle>
            <DialogDescription>
              Drafts the order. It becomes payable/expected stock only when received.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier">
                <select
                  className={inputCls}
                  value={poSupplier}
                  onChange={(e) => setPoSupplier(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Deliver to">
                <select
                  className={inputCls}
                  value={poLocation}
                  onChange={(e) => setPoLocation(e.target.value)}
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
              <Field label="Expected Date" optional>
                <input
                  type="date"
                  className={inputCls}
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                />
              </Field>
              <Field label="Notes" optional>
                <input
                  className={inputCls}
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Lines
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPoLines((prev) => [
                      ...prev,
                      { inventory_item: "", quantity: "", unit_cost: "" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add line
                </Button>
              </div>
              {poLines.map((l, i) => (
                <div
                  key={i}
                  className="flex items-end gap-2 rounded-xl border border-border bg-muted/30 p-2"
                >
                  <div className="min-w-0 flex-1">
                    <Field label="Item">
                      <select
                        className={inputCls}
                        value={l.inventory_item}
                        onChange={(e) => setPoLine(i, { inventory_item: e.target.value })}
                      >
                        <option value="">— Select —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                            {it.purchase_unit_label ? ` (${it.purchase_unit_label})` : ""}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="w-24">
                    <Field label="How many?">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputCls}
                        value={l.quantity}
                        onChange={(e) => setPoLine(i, { quantity: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field label="Unit Cost" optional>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        className={inputCls}
                        value={l.unit_cost}
                        onChange={(e) => setPoLine(i, { unit_cost: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={poLines.length === 1}
                    onClick={() => setPoLines((prev) => prev.filter((_, idx) => idx !== i))}
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
            <Button variant="outline" onClick={() => setPoOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createPO} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive PO dialog */}
      <Dialog open={!!receiving} onOpenChange={(v) => !v && setReceiving(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Delivery · {receiving?.po_number ?? ""}</DialogTitle>
            <DialogDescription>
              Enter what actually arrived. Only these amounts are added to stock.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Where did it arrive?" optional>
              <select
                className={inputCls}
                value={recvLocation}
                onChange={(e) => setRecvLocation(e.target.value)}
              >
                <option value="">Delivery location ({receiving?.delivery_location_name})</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2 text-right">Ordered</th>
                    <th className="px-3 py-2 text-right">Remaining</th>
                    <th className="px-3 py-2 text-right">Arrived</th>
                    <th className="px-3 py-2 text-right">Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {receiving?.lines.map((l) => (
                    <tr key={l.id} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-2 font-medium text-foreground">{l.item_name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {formatQty(l.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {formatQty(l.remaining)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className={`${inputCls} w-28 text-right`}
                          value={recvQty[l.id] ?? ""}
                          onChange={(e) =>
                            setRecvQty((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          className={`${inputCls} w-28 text-right`}
                          value={recvCost[l.id] ?? ""}
                          onChange={(e) =>
                            setRecvCost((prev) => ({ ...prev, [l.id]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {formError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiving(null)}>
              Cancel
            </Button>
            <Button onClick={submitReceive} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add to Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
