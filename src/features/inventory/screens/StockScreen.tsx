// src/features/inventory/screens/StockScreen.tsx
// "How much do we have?" — search, simple status filters, real pagination.
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { inventoryApi, type InventoryItem, type InventoryStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ErrorBlock,
  FilterChips,
  ListSkeleton,
  Pager,
  ScreenHeader,
  StatusBadge,
  errorMessage,
  formatQty,
  inputCls,
  useDebounced,
} from "@/features/inventory/components/bits";
import { ItemFormDialog } from "@/features/inventory/components/ItemFormDialog";
import { DeleteItemDialog } from "@/features/inventory/components/DeleteItemDialog";
import { StockDetailSheet } from "@/features/inventory/components/StockDetailSheet";
import { copy } from "@/features/inventory/copy";
import { P, useCategories, useInventory, useLocations } from "@/features/inventory/context";

type StatusFilter = "" | "HEALTHY" | "LOW" | "CRITICAL" | "OUT" | "OVERSTOCK";
const PAGE_SIZE = 25;

export function StockScreen() {
  const { can, go, params, refresh } = useInventory();
  const locations = useLocations();
  const categories = useCategories();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [location, setLocation] = useState<number | null>(params.location ?? null);
  const [category, setCategory] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [openItem, setOpenItem] = useState<number | null>(params.item ?? null);
  const q = useDebounced(text.trim(), 300);

  useEffect(() => setPage(1), [q, status, location, category]);
  useEffect(() => {
    if (params.item) setOpenItem(params.item);
  }, [params.item]);

  const list = useQuery({
    queryKey: ["inventory", "items", { q, status, location, category, page }],
    queryFn: () =>
      inventoryApi.items({
        q: q || undefined,
        status: status || undefined,
        location: location ?? undefined,
        category: category ?? undefined,
        page,
        page_size: PAGE_SIZE,
        with_counts: 1,
      }),
    placeholderData: keepPreviousData,
  });

  const counts = list.data?.status_counts;
  const items = list.data?.results ?? [];
  const filtered = Boolean(q || status || location || category);
  const canManage = can(P.MANAGE_ITEMS);

  const chips: { value: StatusFilter; label: string; count?: number }[] = [
    { value: "", label: copy.common.all, count: counts?.ALL },
    { value: "HEALTHY", label: copy.status.HEALTHY, count: counts?.HEALTHY },
    { value: "LOW", label: copy.status.LOW, count: counts?.LOW },
    { value: "CRITICAL", label: copy.status.CRITICAL, count: counts?.CRITICAL },
    { value: "OUT", label: copy.status.OUT, count: counts?.OUT },
  ];
  if (counts?.OVERSTOCK)
    chips.push({ value: "OVERSTOCK", label: copy.status.OVERSTOCK, count: counts.OVERSTOCK });

  function qtyFor(item: InventoryItem) {
    return location && item.location_quantity !== null ? item.location_quantity : item.total_stock;
  }

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={copy.stock.title}
        subtitle={list.data ? copy.stock.items(list.data.total_count) : undefined}
        onBack={() => go("home")}
        action={
          canManage && (
            <Button
              className="h-11"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> {copy.stock.addItem}
            </Button>
          )
        }
      />

      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label={copy.stock.searchPlaceholder}
            className={`${inputCls} pl-9`}
            placeholder={copy.stock.searchPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <FilterChips
          label={copy.detail.status}
          value={status}
          options={chips}
          onChange={setStatus}
        />
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          <select
            aria-label={copy.reports.location}
            className={inputCls}
            value={location ?? ""}
            onChange={(e) => setLocation(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{copy.stock.allLocations}</option>
            {locations.active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            aria-label={copy.reports.category}
            className={inputCls}
            value={category ?? ""}
            onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{copy.stock.allCategories}</option>
            {categories.active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {list.isError && (
        <ErrorBlock
          message={errorMessage(list.error, copy.errors.load)}
          onRetry={() => list.refetch()}
        />
      )}

      {list.isLoading ? (
        <ListSkeleton />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={Search}
            title={copy.stock.noResults}
            body={copy.stock.noResultsHint}
            action={
              <Button
                variant="outline"
                className="h-11"
                onClick={() => {
                  setText("");
                  setStatus("");
                  setLocation(null);
                  setCategory(null);
                }}
              >
                {copy.stock.clearFilters}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={copy.home.emptyTitle}
            body={copy.home.emptyHint}
            action={
              <>
                {canManage && (
                  <Button className="h-11" onClick={() => setFormOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden="true" /> {copy.stock.addItem}
                  </Button>
                )}
                {can(P.IMPORT) && (
                  <Button variant="outline" className="h-11" onClick={() => go("io")}>
                    <Upload className="h-4 w-4" aria-hidden="true" /> {copy.stock.importInventory}
                  </Button>
                )}
              </>
            }
          />
        )
      ) : (
        <>
          {/* Phone: simple cards */}
          <ul className={`space-y-2 md:hidden ${list.isFetching ? "opacity-70" : ""}`}>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setOpenItem(item.id)}
                  className="flex min-h-[72px] w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-foreground">
                      {item.name}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {item.location_name || "—"}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-base font-semibold tabular-nums text-foreground">
                      {formatQty(qtyFor(item))}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        {item.base_unit_code}
                      </span>
                    </span>
                    <StatusBadge status={item.status as InventoryStatus} />
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* Desktop: table, task-based actions */}
          <div
            className={`hidden overflow-hidden rounded-2xl border border-border bg-card md:block ${list.isFetching ? "opacity-70" : ""}`}
          >
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3">{copy.stock.itemCol}</th>
                  <th className="px-4 py-3">{copy.detail.usuallyKeptIn}</th>
                  <th className="px-4 py-3 text-right">
                    {location
                      ? copy.stock.at(locations.active.find((l) => l.id === location)?.name ?? "")
                      : copy.detail.currentStock}
                  </th>
                  <th className="px-4 py-3">{copy.detail.status}</th>
                  {canManage && (
                    <th className="px-4 py-3 text-right">
                      <span className="sr-only">{copy.stock.actionsCol}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        className="min-h-[44px] text-left font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setOpenItem(item.id)}
                      >
                        {item.name}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {item.category_name}
                          {item.sku ? ` · ${item.sku}` : ""}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{item.location_name || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="font-semibold tabular-nums text-foreground">
                        {formatQty(qtyFor(item))}
                      </span>{" "}
                      <span className="text-xs text-muted-foreground">{item.base_unit_code}</span>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={item.status as InventoryStatus} />
                    </td>
                    {canManage && (
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            className="h-10 w-10 p-0"
                            aria-label={`${copy.common.edit} ${item.name}`}
                            title={copy.common.edit}
                            onClick={() => {
                              setEditing(item);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-10 w-10 p-0 text-danger hover:bg-bordeaux-soft hover:text-danger"
                            aria-label={`${copy.common.delete} ${item.name}`}
                            title={copy.common.delete}
                            onClick={() => setDeleting(item)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager page={page} totalPages={list.data?.total_pages ?? 1} onPage={setPage} />
        </>
      )}

      <ItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        onSaved={() => refresh()}
        onOpenExisting={(id) => setOpenItem(id)}
      />
      <DeleteItemDialog
        item={deleting}
        onOpenChange={(v) => !v && setDeleting(null)}
        onDeleted={refresh}
      />
      <StockDetailSheet
        itemId={openItem}
        onClose={() => setOpenItem(null)}
        onEdit={(item) => {
          setEditing(item);
          setFormOpen(true);
        }}
        onDelete={(item) => setDeleting(item)}
      />
    </div>
  );
}
