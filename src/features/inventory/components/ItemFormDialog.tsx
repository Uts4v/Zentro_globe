// src/features/inventory/components/ItemFormDialog.tsx
// "Add Stock Item" asks five plain questions. Everything else lives under
// Advanced. Editing never changes the quantity in stock.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import {
  InventoryApiError,
  inventoryApi,
  menuApi,
  type InventoryItem,
  type InventoryUnit,
  type ItemType,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChoiceGroup,
  Field,
  QuantityInput,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import { LocationSelect } from "@/features/inventory/components/ItemPicker";
import { copy } from "@/features/inventory/copy";
import {
  P,
  useCategories,
  useInventory,
  useLocations,
  useSuppliers,
  useUnits,
} from "@/features/inventory/context";

const c = copy.itemForm;
const ITEM_TYPES: ItemType[] = ["INGREDIENT", "PREPARED", "DIRECT_SALE", "SUPPLY"];
const COMMON_UNITS = ["kg", "g", "L", "ml", "piece"];

type LinkDraft = { menu_item: string; menu_item_name: string; quantity_per_unit: string };

interface Draft {
  name: string;
  item_type: ItemType;
  base_unit: number | null;
  default_location: number | null;
  opening_quantity: string;
  opening_unit_cost: string;
  category: number | null;
  sku: string;
  barcode: string;
  preferred_display_unit: number | null;
  par_level: string;
  reorder_point: string;
  critical_level: string;
  buyInPacks: boolean;
  purchase_unit_label: string;
  purchase_unit_conversion: string;
  primary_supplier: number | null;
}

function emptyDraft(defaultLocation: number | null, pieceUnit: number | null): Draft {
  return {
    name: "",
    item_type: "INGREDIENT",
    base_unit: pieceUnit,
    default_location: defaultLocation,
    opening_quantity: "",
    opening_unit_cost: "",
    category: null,
    sku: "",
    barcode: "",
    preferred_display_unit: null,
    par_level: "",
    reorder_point: "",
    critical_level: "",
    buyInPacks: false,
    purchase_unit_label: "",
    purchase_unit_conversion: "",
    primary_supplier: null,
  };
}

function trimZeros(v: string | null | undefined) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

function fromItem(item: InventoryItem): Draft {
  return {
    name: item.name,
    item_type: item.item_type,
    base_unit: item.base_unit,
    default_location: item.default_location,
    opening_quantity: "",
    opening_unit_cost: "",
    category: item.category,
    sku: item.sku ?? "",
    barcode: item.barcode ?? "",
    preferred_display_unit: item.preferred_display_unit,
    par_level: trimZeros(item.par_level),
    reorder_point: trimZeros(item.reorder_point),
    critical_level: trimZeros(item.critical_level),
    buyInPacks: Boolean(item.purchase_unit_conversion),
    purchase_unit_label: item.purchase_unit_label ?? "",
    purchase_unit_conversion: trimZeros(item.purchase_unit_conversion),
    primary_supplier: item.primary_supplier,
  };
}

function sortUnits(units: InventoryUnit[]) {
  return [...units].sort((a, b) => {
    const ia = COMMON_UNITS.indexOf(a.code);
    const ib = COMMON_UNITS.indexOf(b.code);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.name.localeCompare(b.name);
  });
}

export function ItemFormDialog({
  open,
  onOpenChange,
  item,
  onSaved,
  onOpenExisting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: InventoryItem | null;
  onSaved: (item: InventoryItem) => void;
  onOpenExisting?: (id: number) => void;
}) {
  const { can } = useInventory();
  const locations = useLocations();
  const categories = useCategories();
  const unitsQ = useUnits();
  const suppliers = useSuppliers(can(P.RECEIVE) || can(P.MANAGE_SUPPLIERS));
  const units = useMemo(() => sortUnits(unitsQ.data ?? []), [unitsQ.data]);
  const pieceId = units.find((u) => u.code === "piece")?.id ?? null;
  const defaultLocation = locations.active.find((l) => l.is_default)?.id ?? null;

  const [d, setD] = useState<Draft>(() => emptyDraft(defaultLocation, pieceId));
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [duplicate, setDuplicate] = useState<{ id: number; name: string } | null>(null);

  const menuItems = useQuery({
    queryKey: ["inventory", "menu-items"],
    queryFn: () => menuApi.myItems(),
    enabled: open && showAdvanced,
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError("");
    setDuplicate(null);
    setShowAdvanced(false);
    if (item) {
      setD(fromItem(item));
      setLinks(
        (item.menu_links ?? []).map((l) => ({
          menu_item: String(l.menu_item),
          menu_item_name: l.menu_item_name,
          quantity_per_unit: trimZeros(l.quantity_per_unit),
        })),
      );
    } else {
      setD(emptyDraft(defaultLocation, pieceId));
      setLinks([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  // Units/locations may arrive after the dialog opens.
  useEffect(() => {
    if (!item && open) {
      setD((prev) => ({
        ...prev,
        base_unit: prev.base_unit ?? pieceId,
        default_location: prev.default_location ?? defaultLocation,
      }));
    }
  }, [pieceId, defaultLocation, item, open]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const unit = units.find((u) => u.id === d.base_unit);
  const unitCode = unit?.code ?? "";
  const canAddStartingStock = !item && (can(P.RECEIVE) || can(P.ADJUST));

  async function submit(allowDuplicate = false) {
    const next: Record<string, string> = {};
    if (!d.name.trim()) next.name = c.needName;
    if (!d.base_unit) next.base_unit = c.needUnit;
    if (d.opening_quantity && Number(d.opening_quantity) > 0 && !d.default_location)
      next.default_location = c.needLocation;
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    setFormError("");
    const payload: Record<string, unknown> = {
      name: d.name.trim(),
      item_type: d.item_type,
      default_location: d.default_location,
      sku: d.sku.trim(),
      barcode: d.barcode.trim(),
      par_level: d.par_level || null,
      reorder_point: d.reorder_point || null,
      critical_level: d.critical_level || null,
      purchase_unit_label: d.buyInPacks ? d.purchase_unit_label.trim() : "",
      purchase_unit_conversion:
        d.buyInPacks && d.purchase_unit_conversion ? d.purchase_unit_conversion : null,
      preferred_display_unit: d.preferred_display_unit,
      menu_links: links
        .filter((l) => l.menu_item)
        .map((l) => ({
          menu_item: Number(l.menu_item),
          quantity_per_unit: l.quantity_per_unit || "1",
        })),
    };
    if (d.category) payload.category = d.category;
    if (d.primary_supplier !== undefined && (can(P.RECEIVE) || can(P.MANAGE_SUPPLIERS))) {
      payload.primary_supplier = d.primary_supplier;
    }
    if (allowDuplicate) payload.allow_duplicate_name = true;
    try {
      let saved: InventoryItem;
      if (item) {
        saved = await inventoryApi.patchItem(item.id, payload);
        toast.success(c.saved(saved.name));
      } else {
        payload.base_unit = d.base_unit;
        if (canAddStartingStock && d.opening_quantity) {
          payload.opening_quantity = d.opening_quantity;
          if (d.opening_unit_cost) payload.opening_unit_cost = d.opening_unit_cost;
        }
        saved = await inventoryApi.createItem(payload);
        toast.success(c.added(saved.name));
      }
      onOpenChange(false);
      onSaved(saved);
    } catch (e) {
      if (e instanceof InventoryApiError && e.code === "duplicate_name") {
        setDuplicate({ id: Number(e.data.duplicate_of), name: d.name.trim() });
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  const displayUnits = units.filter((u) => unit && u.kind === unit.kind && u.id !== unit.id);

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? c.editTitle : c.addTitle}</DialogTitle>
          {item && <DialogDescription>{c.editHint}</DialogDescription>}
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={`1. ${c.q1}`} htmlFor="item-name" error={errors.name}>
            <input
              id="item-name"
              className={inputCls}
              value={d.name}
              autoFocus
              maxLength={255}
              placeholder={c.q1Placeholder}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-foreground">2. {c.q2}</p>
            <ChoiceGroup
              label={c.q2}
              value={d.item_type}
              onChange={(v) => set("item_type", v)}
              options={ITEM_TYPES.map((t) => ({
                value: t,
                label: copy.itemType[t],
                hint: copy.itemTypeHint[t],
              }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={`3. ${c.q3}`}
              htmlFor="item-unit"
              hint={item ? undefined : c.q3Hint}
              error={errors.base_unit}
            >
              <select
                id="item-unit"
                className={inputCls}
                value={d.base_unit ?? ""}
                disabled={Boolean(item)}
                onChange={(e) => {
                  set("base_unit", e.target.value ? Number(e.target.value) : null);
                  set("preferred_display_unit", null);
                }}
              >
                <option value="" disabled>
                  {c.choose}
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code === u.name ? u.code : `${u.code} (${u.name})`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`4. ${c.q4}`} htmlFor="item-location" error={errors.default_location}>
              <LocationSelect
                id="item-location"
                value={d.default_location}
                onChange={(v) => set("default_location", v)}
                locations={locations.active}
              />
            </Field>
          </div>

          {canAddStartingStock && (
            <Field label={`5. ${c.q5}`} htmlFor="item-opening" hint={c.q5Hint} optional>
              <QuantityInput
                id="item-opening"
                value={d.opening_quantity}
                onChange={(v) => set("opening_quantity", v)}
                unit={unitCode}
              />
            </Field>
          )}

          {/* Advanced */}
          <div className="rounded-2xl border border-border">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>
                <span className="block text-sm font-semibold text-foreground">{c.advanced}</span>
                <span className="block text-xs text-muted-foreground">{c.advancedHint}</span>
              </span>
              <ChevronDown
                className={`h-5 w-5 transition ${showAdvanced ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {showAdvanced && (
              <div className="space-y-5 border-t border-border px-4 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={c.category} htmlFor="item-category" optional>
                    <select
                      id="item-category"
                      className={inputCls}
                      value={d.category ?? ""}
                      onChange={(e) =>
                        set("category", e.target.value ? Number(e.target.value) : null)
                      }
                    >
                      <option value="">{c.choose}</option>
                      {categories.active.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={c.displayUnit} htmlFor="item-display-unit" optional>
                    <select
                      id="item-display-unit"
                      className={inputCls}
                      value={d.preferred_display_unit ?? ""}
                      onChange={(e) =>
                        set(
                          "preferred_display_unit",
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">{unitCode || c.choose}</option>
                      {displayUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={c.sku} htmlFor="item-sku" optional>
                    <input
                      id="item-sku"
                      className={inputCls}
                      value={d.sku}
                      maxLength={120}
                      onChange={(e) => set("sku", e.target.value)}
                    />
                  </Field>
                  <Field label={c.barcode} htmlFor="item-barcode" optional>
                    <input
                      id="item-barcode"
                      inputMode="numeric"
                      className={inputCls}
                      value={d.barcode}
                      maxLength={120}
                      onChange={(e) => set("barcode", e.target.value)}
                    />
                  </Field>
                </div>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold text-foreground">{c.alerts}</legend>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={c.keepAround} htmlFor="item-par" hint={c.keepAroundHint} optional>
                      <QuantityInput
                        id="item-par"
                        value={d.par_level}
                        onChange={(v) => set("par_level", v)}
                        unit={unitCode}
                        placeholder=""
                      />
                    </Field>
                    <Field
                      label={c.warnMeBelow}
                      htmlFor="item-reorder"
                      hint={c.warnMeBelowHint}
                      optional
                    >
                      <QuantityInput
                        id="item-reorder"
                        value={d.reorder_point}
                        onChange={(v) => set("reorder_point", v)}
                        unit={unitCode}
                        placeholder=""
                      />
                    </Field>
                    <Field label={c.veryLow} htmlFor="item-critical" hint={c.veryLowHint} optional>
                      <QuantityInput
                        id="item-critical"
                        value={d.critical_level}
                        onChange={(v) => set("critical_level", v)}
                        unit={unitCode}
                        placeholder=""
                      />
                    </Field>
                  </div>
                </fieldset>

                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold text-foreground">{c.buying}</legend>
                  <p className="text-sm text-foreground">{c.howBuy}</p>
                  <ChoiceGroup
                    label={c.howBuy}
                    value={d.buyInPacks ? "packs" : "same"}
                    onChange={(v) => set("buyInPacks", v === "packs")}
                    options={[
                      { value: "same", label: c.sameAsCount },
                      { value: "packs", label: c.inPacks },
                    ]}
                  />
                  {d.buyInPacks && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={c.buyAs} htmlFor="item-pack-label">
                        <input
                          id="item-pack-label"
                          className={inputCls}
                          value={d.purchase_unit_label}
                          maxLength={80}
                          placeholder={c.buyAsPlaceholder}
                          onChange={(e) => set("purchase_unit_label", e.target.value)}
                        />
                      </Field>
                      <Field
                        label={c.oneContains(d.purchase_unit_label.toLowerCase())}
                        htmlFor="item-pack-size"
                      >
                        <QuantityInput
                          id="item-pack-size"
                          value={d.purchase_unit_conversion}
                          onChange={(v) => set("purchase_unit_conversion", v)}
                          unit={unitCode}
                        />
                      </Field>
                      {d.purchase_unit_label && d.purchase_unit_conversion && (
                        <p className="rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground sm:col-span-2">
                          {c.packSummary(
                            d.purchase_unit_label.toLowerCase(),
                            d.purchase_unit_conversion,
                            unitCode,
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {(can(P.RECEIVE) || can(P.MANAGE_SUPPLIERS)) &&
                    (suppliers.data?.length ?? 0) > 0 && (
                      <Field label={c.supplier} htmlFor="item-supplier" optional>
                        <select
                          id="item-supplier"
                          className={inputCls}
                          value={d.primary_supplier ?? ""}
                          onChange={(e) =>
                            set("primary_supplier", e.target.value ? Number(e.target.value) : null)
                          }
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
                  {canAddStartingStock && can(P.VIEW_COST) && d.opening_quantity && (
                    <Field label={c.startingCost} htmlFor="item-opening-cost" optional>
                      <QuantityInput
                        id="item-opening-cost"
                        value={d.opening_unit_cost}
                        onChange={(v) => set("opening_unit_cost", v)}
                        unit={unitCode ? `/ ${unitCode}` : ""}
                        placeholder=""
                      />
                    </Field>
                  )}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-foreground">{c.menuLinks}</legend>
                  <p className="text-xs text-muted-foreground">{c.menuLinksHint}</p>
                  {links.map((link, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        aria-label={c.menuItem}
                        className={`${inputCls} min-w-0 flex-1`}
                        value={link.menu_item}
                        onChange={(e) =>
                          setLinks((prev) =>
                            prev.map((l, j) => (j === i ? { ...l, menu_item: e.target.value } : l)),
                          )
                        }
                      >
                        <option value="">{c.menuItem}</option>
                        {link.menu_item &&
                          !(menuItems.data ?? []).some((m) => String(m.id) === link.menu_item) && (
                            <option value={link.menu_item}>{link.menu_item_name}</option>
                          )}
                        {(Array.isArray(menuItems.data) ? menuItems.data : [])
                          .filter((m) => m.status !== "archived")
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                      <div className="w-32 shrink-0">
                        <QuantityInput
                          ariaLabel={c.perSale}
                          value={link.quantity_per_unit}
                          onChange={(v) =>
                            setLinks((prev) =>
                              prev.map((l, j) => (j === i ? { ...l, quantity_per_unit: v } : l)),
                            )
                          }
                          unit={unitCode}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={copy.delivery.remove}
                        onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-bordeaux-soft hover:text-danger"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() =>
                      setLinks((prev) => [
                        ...prev,
                        { menu_item: "", menu_item_name: "", quantity_per_unit: "1" },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" /> {c.linkMenuItem}
                  </Button>
                </fieldset>
              </div>
            )}
          </div>

          {duplicate && (
            <div
              role="alert"
              className="space-y-3 rounded-2xl border border-warning/40 bg-butter-soft px-4 py-3 text-sm"
            >
              <p className="font-medium text-foreground">{c.duplicate(duplicate.name)}</p>
              <div className="flex flex-wrap gap-2">
                {onOpenExisting && (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={() => {
                      onOpenChange(false);
                      onOpenExisting(duplicate.id);
                    }}
                  >
                    {c.openExisting}
                  </Button>
                )}
                <Button type="button" className="h-11" onClick={() => submit(true)} disabled={busy}>
                  {c.addAnyway}
                </Button>
              </div>
            </div>
          )}
          {formError && (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-bordeaux-soft px-3 py-2 text-sm text-danger"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {copy.common.cancel}
            </Button>
            <Button type="submit" className="h-11 sm:min-w-32" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {item ? c.submitEdit : c.submitAdd}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
