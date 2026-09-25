// src/features/inventory/tabs/items-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Search, Plus, Pencil, Archive, Loader2, X } from "lucide-react";
import {
  inventoryApi,
  menuApi,
  type InventoryCategory,
  type InventoryItem,
  type InventoryLocation,
  type InventoryUnit,
  type InventoryStatus,
  type MenuItem,
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
  StatusBadge,
  formatMoney,
  formatQty,
  inputCls,
  errorMessage,
  ITEM_TYPE_LABEL,
} from "@/features/inventory/components/bits";

const ITEM_TYPES = ["INGREDIENT", "PREPARED", "DIRECT_SALE", "SUPPLY"] as const;
const STATUS_FILTERS: ReadonlyArray<InventoryStatus | ""> = [
  "",
  "HEALTHY",
  "LOW",
  "CRITICAL",
  "OUT",
  "OVERSTOCK",
];

const PER_PAGE = 25;

function draftFields() {
  return {
    name: "",
    item_type: "INGREDIENT",
    category: "",
    default_location: "",
    base_unit: "",
    sku: "",
    purchase_unit_label: "",
    purchase_unit_conversion: "",
    par_level: "",
    reorder_point: "",
    critical_level: "",
    opening_quantity: "",
    opening_unit_cost: "",
  };
}

type MenuLinkDraft = { menu_item: string; menu_item_name: string; quantity_per_unit: string };

function ItemFormDialog({
  open,
  onOpenChange,
  item,
  categories,
  locations,
  units,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: InventoryItem | null;
  categories: InventoryCategory[];
  locations: InventoryLocation[];
  units: InventoryUnit[];
  onSaved: () => void;
}) {
  const [f, setF] = useState(draftFields);
  const [links, setLinks] = useState<MenuLinkDraft[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || menuItems.length > 0) return;
    menuApi
      .myItems()
      .then((d) => {
        if (Array.isArray(d)) setMenuItems(d.filter((m) => m.status !== "archived"));
      })
      .catch(() => void 0);
  }, [open, menuItems.length]);

  useEffect(() => {
    if (!open) return;
    setErr("");
    setLinks(
      (item?.menu_links ?? []).map((l) => ({
        menu_item: String(l.menu_item),
        menu_item_name: l.menu_item_name,
        quantity_per_unit: String(Number(l.quantity_per_unit)),
      })),
    );
    if (item) {
      setF({
        name: item.name,
        item_type: item.item_type,
        category: String(item.category ?? ""),
        default_location: String(item.default_location ?? ""),
        base_unit: String(item.base_unit ?? ""),
        sku: item.sku ?? "",
        purchase_unit_label: item.purchase_unit_label ?? "",
        purchase_unit_conversion: item.purchase_unit_conversion ?? "",
        par_level: item.par_level ?? "",
        reorder_point: item.reorder_point ?? "",
        critical_level: item.critical_level ?? "",
        opening_quantity: "",
        opening_unit_cost: "",
      });
    } else {
      setF(draftFields());
    }
  }, [open, item]);

  function set<K extends keyof typeof f>(k: K, v: string) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  function setLink(index: number, patch: Partial<MenuLinkDraft>) {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  const unitCode = units.find((u) => String(u.id) === f.base_unit)?.code ?? "";

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const payload: Record<string, unknown> = {
        name: f.name,
        item_type: f.item_type,
        category: f.category ? Number(f.category) : null,
        default_location: f.default_location ? Number(f.default_location) : null,
        base_unit: f.base_unit ? Number(f.base_unit) : null,
        sku: f.sku,
        purchase_unit_label: f.purchase_unit_label || undefined,
        purchase_unit_conversion: f.purchase_unit_conversion || null,
        par_level: f.par_level || null,
        reorder_point: f.reorder_point || null,
        critical_level: f.critical_level || null,
        menu_links: links
          .filter((l) => l.menu_item)
          .map((l) => ({
            menu_item: Number(l.menu_item),
            quantity_per_unit: l.quantity_per_unit || "1",
          })),
      };
      if (!item) {
        payload.opening_quantity = f.opening_quantity || null;
        payload.opening_unit_cost = f.opening_unit_cost || null;
        await inventoryApi.createItem(payload);
      } else {
        await inventoryApi.patchItem(item.id, payload);
      }
      onOpenChange(false);
      onSaved();
    } catch (e: unknown) {
      setErr(errorMessage(e, "Failed to save item"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Stock Item" : "Add Stock Item"}</DialogTitle>
          <DialogDescription>
            {item
              ? "Update the item details. Current stock is changed through stock actions."
              : "Add the things your restaurant keeps in stock."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="What is it called?">
            <input
              className={inputCls}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="What kind of item is it?">
              <select
                className={inputCls}
                value={f.item_type}
                onChange={(e) => set("item_type", e.target.value)}
              >
                {ITEM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category" optional>
              <select
                className={inputCls}
                value={f.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">— Select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="How do you count it?" optional>
              <select
                className={inputCls}
                value={f.base_unit}
                onChange={(e) => set("base_unit", e.target.value)}
              >
                <option value="">— Select —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} ({u.name})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Where is it usually stored?" optional>
              <select
                className={inputCls}
                value={f.default_location}
                onChange={(e) => set("default_location", e.target.value)}
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

          {!item && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="How much do you have now?" optional>
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={f.opening_quantity}
                  onChange={(e) => set("opening_quantity", e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="What did it cost?" optional>
                <input
                  type="number"
                  step="any"
                  className={inputCls}
                  value={f.opening_unit_cost}
                  onChange={(e) => set("opening_unit_cost", e.target.value)}
                  placeholder="0"
                />
              </Field>
            </div>
          )}

          <details className="rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Use Up When Sold{links.length > 0 && ` (${links.length})`}
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Dine-in orders for these menu items take stock from this item automatically.
              </p>
              {links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    aria-label="Menu item"
                    className={`${inputCls} min-w-0 flex-1`}
                    value={link.menu_item}
                    onChange={(e) => setLink(i, { menu_item: e.target.value })}
                  >
                    <option value="">— Menu item —</option>
                    {link.menu_item && !menuItems.some((m) => String(m.id) === link.menu_item) && (
                      <option value={link.menu_item}>{link.menu_item_name}</option>
                    )}
                    {menuItems.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    aria-label="Amount used per sale"
                    title="Amount used per sale"
                    className={`${inputCls} w-24`}
                    value={link.quantity_per_unit}
                    onChange={(e) => setLink(i, { quantity_per_unit: e.target.value })}
                  />
                  <span className="w-10 shrink-0 text-xs text-muted-foreground">{unitCode}</span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLinks((prev) => [
                    ...prev,
                    { menu_item: "", menu_item_name: "", quantity_per_unit: "1" },
                  ])
                }
              >
                <Plus className="h-4 w-4" />
                Link a menu item
              </Button>
            </div>
          </details>

          <details className="rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">
              Advanced Options
            </summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Item code" optional>
                  <input
                    className={inputCls}
                    value={f.sku}
                    onChange={(e) => set("sku", e.target.value)}
                  />
                </Field>
                <Field label="How do you buy it?" optional>
                  <input
                    className={inputCls}
                    value={f.purchase_unit_label}
                    onChange={(e) => set("purchase_unit_label", e.target.value)}
                    placeholder="e.g. bag, case, box"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
            <Field label="Keep Around" optional>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={f.par_level}
                onChange={(e) => set("par_level", e.target.value)}
              />
            </Field>
            <Field label="Warn Me Below" optional>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={f.reorder_point}
                onChange={(e) => set("reorder_point", e.target.value)}
              />
            </Field>
            <Field label="Very Low Level" optional>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={f.critical_level}
                onChange={(e) => set("critical_level", e.target.value)}
              />
            </Field>
              </div>
            </div>
          </details>
        </div>

        {err && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !f.name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {item ? "Save Changes" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ItemsTab({ sym }: { sym: string }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [page, setPage] = useState(1);

  const loadRefs = () => {
    inventoryApi
      .categories()
      .then((d) => {
        if (Array.isArray(d)) setCategories(d);
      })
      .catch(() => void 0);
    inventoryApi
      .locations()
      .then((d) => {
        if (Array.isArray(d)) setLocations(d);
      })
      .catch(() => void 0);
    inventoryApi
      .units()
      .then((d) => {
        if (Array.isArray(d)) setUnits(d);
      })
      .catch(() => void 0);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryApi.items({
        q: q || undefined,
        type: typeFilter || undefined,
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
        page,
      });
      setItems(data.results ?? []);
      setCount(data.count ?? data.results?.length ?? 0);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load items"));
    } finally {
      setLoading(false);
    }
  }, [q, typeFilter, statusFilter, categoryFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadRefs();
  }, []);

  const totalPages = Math.max(1, Math.ceil(count / PER_PAGE));

  async function archive(item: InventoryItem) {
    if (
      !window.confirm(
        `Archive "${item.name}"? History and stock remain intact; it is hidden from new use.`,
      )
    )
      return;
    try {
      await inventoryApi.archiveItem(item.id);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to archive item"));
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stock"
        subtitle={`${count} stock items`}
        action={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add Stock Item
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className={`${inputCls} w-64 pl-9`}
            placeholder="Search stock..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className={`${inputCls} w-40`}
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          className={`${inputCls} w-36`}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s ? ({ HEALTHY: "Good", LOW: "Low", CRITICAL: "Very Low", OUT: "Out", OVERSTOCK: "More Than Usual" } as Record<string, string>)[s] : "All statuses"}
            </option>
          ))}
        </select>
        <select
          className={`${inputCls} w-44`}
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No items found. Adjust filters or add your first item.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3 text-right">On Hand</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Stock Value</th>
                <th className="hidden px-4 py-3 text-right lg:table-cell">Reorder At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground">{it.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.sku || it.item_type.replace(/_/g, " ").toLowerCase()}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{it.category_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{it.location_name}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-foreground">
                      {formatQty(it.total_stock)}
                    </span>
                    <span className="ml-1 text-xs text-muted-foreground">{it.base_unit_code}</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={it.status} />
                  </td>
                  <td className="hidden px-4 py-3 text-right text-muted-foreground md:table-cell">
                    {formatMoney(it.stock_value, sym)}
                  </td>
                  <td className="hidden px-4 py-3 text-right text-muted-foreground lg:table-cell">
                    {it.reorder_point ? formatQty(it.reorder_point) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Edit"
                        onClick={() => {
                          setEditing(it);
                          setOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        title="Archive"
                        onClick={() => archive(it)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <ItemFormDialog
        open={open}
        onOpenChange={setOpen}
        item={editing}
        categories={categories}
        locations={locations}
        units={units}
        onSaved={() => {
          loadRefs();
          load();
        }}
      />
    </div>
  );
}
