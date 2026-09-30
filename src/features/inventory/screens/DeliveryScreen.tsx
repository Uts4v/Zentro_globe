// src/features/inventory/screens/DeliveryScreen.tsx
// "New stock arrived." Enter what arrived the way it was bought (sacks,
// boxes…); the backend converts to the counting unit.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { inventoryApi, type InventoryItem, type Receiving } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ChoiceGroup,
  ErrorBlock,
  Field,
  QuantityInput,
  ScreenHeader,
  StickyActions,
  SuccessPanel,
  errorMessage,
  formatQty,
  inputCls,
  parseAmount,
  uid,
} from "@/features/inventory/components/bits";
import { ItemPicker, LocationSelect } from "@/features/inventory/components/ItemPicker";
import { usePreselectedItem } from "@/features/inventory/components/usePreselectedItem";
import { copy } from "@/features/inventory/copy";
import { P, useInventory, useLocations, useSuppliers } from "@/features/inventory/context";

const c = copy.delivery;

interface Line {
  key: string;
  item: InventoryItem | null;
  qty: string;
  inPacks: boolean;
  cost: string;
}

const newLine = (item: InventoryItem | null = null): Line => ({
  key: uid("line"),
  item,
  qty: "",
  inPacks: Boolean(item?.purchase_unit_conversion),
  cost: "",
});

export function DeliveryScreen() {
  const { can, go, params, refresh, sym } = useInventory();
  const locations = useLocations();
  const suppliers = useSuppliers(can(P.RECEIVE));
  const [location, setLocation] = useState<number | null>(params.location ?? null);
  const [supplier, setSupplier] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Receiving | null>(null);
  const key = useRef(uid("delivery"));

  useEffect(() => {
    if (location === null && locations.active.length) {
      setLocation(locations.active.find((l) => l.is_default)?.id ?? locations.active[0].id);
    }
  }, [locations.active, location]);

  usePreselectedItem(params.item, (item) => {
    setLines([newLine(item)]);
    if (item.default_location) setLocation(item.default_location);
    if (item.primary_supplier) setSupplier(item.primary_supplier);
  });

  const setLine = (k: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  function reset() {
    setLines([newLine()]);
    setReference("");
    setSupplier(null);
    setResult(null);
    setError("");
    key.current = uid("delivery");
  }

  async function submit() {
    const ready = lines.filter((l) => l.item && (parseAmount(l.qty) ?? 0) > 0);
    if (
      !location ||
      ready.length === 0 ||
      ready.length !== lines.filter((l) => l.item || l.qty).length
    ) {
      setError(c.needItem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.createReceiving({
        location,
        supplier,
        reference: reference.trim(),
        idempotency_key: key.current,
        lines: ready.map((l) => ({
          item_id: l.item!.id,
          quantity: String(parseAmount(l.qty)),
          ...(l.inPacks && l.item!.purchase_unit_conversion
            ? {
                purchase_unit_label: l.item!.purchase_unit_label,
                purchase_unit_conversion: l.item!.purchase_unit_conversion,
              }
            : { purchase_unit_conversion: null }),
          unit_cost: l.cost ? String(parseAmount(l.cost)) : null,
        })),
      });
      setResult(res);
      refresh();
      const first = res.results?.[0];
      if (first) toast.success(c.toast(formatQty(first.new_stock), first.unit, first.item_name));
    } catch (e) {
      setError(`${c.failed} ${errorMessage(e, "")}`.trim());
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <SuccessPanel
        title={c.successTitle}
        lines={(result.results ?? []).map((r) => ({
          label: r.item_name,
          value: `+${formatQty(r.added)} ${r.unit}`,
          sub: `${r.location_name} · ${c.newStock}: ${formatQty(r.new_stock)} ${r.unit}`,
        }))}
        primary={{ label: copy.common.done, onClick: () => go("home") }}
        secondary={{ label: c.addAnotherDelivery, onClick: reset }}
      />
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <ScreenHeader title={c.title} onBack={() => go("actions")} />

      <Field label={c.where} htmlFor="delivery-location">
        <LocationSelect
          id="delivery-location"
          value={location}
          onChange={setLocation}
          locations={locations.active}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {(suppliers.data?.length ?? 0) > 0 && (
          <Field label={c.who} htmlFor="delivery-supplier" optional>
            <select
              id="delivery-supplier"
              className={inputCls}
              value={supplier ?? ""}
              onChange={(e) => setSupplier(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{c.noSupplier}</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={c.reference} htmlFor="delivery-ref" optional>
          <input
            id="delivery-ref"
            className={inputCls}
            value={reference}
            maxLength={120}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-base font-semibold text-foreground">{c.whatArrived}</legend>
        {lines.map((line, index) => {
          const item = line.item;
          const pack = item?.purchase_unit_conversion
            ? Number(item.purchase_unit_conversion)
            : null;
          const packLabel = (item?.purchase_unit_label || "pack").toLowerCase();
          const unit = line.inPacks && pack ? packLabel : (item?.base_unit_code ?? "");
          const qty = parseAmount(line.qty);
          return (
            <div key={line.key} className="space-y-3 rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={c.item} htmlFor={`delivery-item-${index}`}>
                    <ItemPicker
                      id={`delivery-item-${index}`}
                      value={item}
                      locationId={location}
                      onChange={(picked) =>
                        setLine(line.key, {
                          item: picked,
                          inPacks: Boolean(picked?.purchase_unit_conversion),
                        })
                      }
                    />
                  </Field>
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    aria-label={c.remove}
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    className="mt-7 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-bordeaux-soft hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              {item && (
                <>
                  {pack && (
                    <ChoiceGroup
                      label={c.howMany}
                      value={line.inPacks ? "pack" : "base"}
                      onChange={(v) => setLine(line.key, { inPacks: v === "pack" })}
                      options={[
                        { value: "pack", label: `${item.purchase_unit_label || "Pack"}s` },
                        { value: "base", label: item.base_unit_code },
                      ]}
                    />
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={c.howMany} htmlFor={`delivery-qty-${index}`}>
                      <QuantityInput
                        id={`delivery-qty-${index}`}
                        value={line.qty}
                        onChange={(v) => setLine(line.key, { qty: v })}
                        unit={unit}
                        large
                      />
                    </Field>
                    {can(P.VIEW_COST) && (
                      <Field
                        label={c.cost}
                        htmlFor={`delivery-cost-${index}`}
                        optional
                        hint={`${c.costHint} ${unit}`}
                      >
                        <QuantityInput
                          id={`delivery-cost-${index}`}
                          value={line.cost}
                          onChange={(v) => setLine(line.key, { cost: v })}
                          unit={sym}
                          placeholder=""
                        />
                      </Field>
                    )}
                  </div>
                  {line.inPacks && pack && (
                    <p className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
                      {copy.itemForm.packSummary(packLabel, formatQty(pack), item.base_unit_code)}
                      {qty
                        ? ` · ${formatQty(qty)} ${packLabel} = ${formatQty(qty * pack)} ${item.base_unit_code}`
                        : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full sm:w-auto"
          onClick={() => setLines((prev) => [...prev, newLine()])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> {c.addAnother}
        </Button>
      </fieldset>

      {error && <ErrorBlock message={error} />}

      <StickyActions>
        <Button
          type="button"
          variant="outline"
          className="h-12"
          onClick={() => go("actions")}
          disabled={busy}
        >
          {copy.common.cancel}
        </Button>
        <Button type="submit" className="h-12 sm:min-w-40" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {c.submit}
        </Button>
      </StickyActions>
    </form>
  );
}
