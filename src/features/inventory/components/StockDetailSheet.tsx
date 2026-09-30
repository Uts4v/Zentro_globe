// src/features/inventory/components/StockDetailSheet.tsx
// Tapping an item: the essentials first, quick task buttons, advanced
// information collapsed.
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ClipboardCheck,
  History,
  Pencil,
  SlidersHorizontal,
  Trash2,
  Truck,
  PackageMinus,
  type LucideIcon,
} from "lucide-react";
import { inventoryApi, type InventoryItem } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ErrorBlock,
  ListSkeleton,
  StatusBadge,
  errorMessage,
  formatDate,
  formatMoney,
  formatQty,
  friendlyMovementLabel,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const c = copy.detail;

function QuickButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        danger
          ? "border-danger/30 text-danger hover:bg-bordeaux-soft"
          : "border-border bg-card text-foreground hover:border-primary/40"
      }`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      {label}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function StockDetailSheet({
  itemId,
  onClose,
  onEdit,
  onDelete,
}: {
  itemId: number | null;
  onClose: () => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  const { can, go, sym } = useInventory();
  const detail = useQuery({
    queryKey: ["inventory", "item", itemId],
    queryFn: () => inventoryApi.itemDetail(itemId as number),
    enabled: itemId !== null,
  });
  const history = useQuery({
    queryKey: ["inventory", "item-history", itemId],
    queryFn: () => inventoryApi.itemMovements(itemId as number, { page_size: 5 }),
    enabled: itemId !== null && can(P.VIEW_REPORTS),
  });
  const item = detail.data;

  function goto(view: Parameters<typeof go>[0], extra: Record<string, number | undefined> = {}) {
    onClose();
    go(view, { item: item?.id, ...extra });
  }

  return (
    <Sheet open={itemId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {detail.isLoading && <ListSkeleton rows={3} />}
        {detail.isError && (
          <ErrorBlock
            message={errorMessage(detail.error, copy.errors.load)}
            onRetry={() => detail.refetch()}
          />
        )}
        {item && (
          <div className="space-y-6">
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-2xl">{item.name}</SheetTitle>
              <SheetDescription>
                {copy.itemType[item.item_type]} · {item.category_name}
              </SheetDescription>
            </SheetHeader>

            <div className="rounded-3xl bg-primary px-5 py-4 text-primary-foreground">
              <p className="text-sm opacity-80">{c.currentStock}</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums">
                {formatQty(item.total_stock)}{" "}
                <span className="text-xl font-normal opacity-80">{item.base_unit_code}</span>
              </p>
              <div className="mt-2">
                <StatusBadge status={item.status} size="md" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Fact label={c.usuallyKeptIn} value={item.location_name || "—"} />
              <Fact label={c.status} value={copy.status[item.status]} />
              <Fact
                label={c.lastCounted}
                value={item.last_count_at ? formatDate(item.last_count_at) : c.never}
              />
              <Fact
                label={c.lastDelivery}
                value={item.last_received_at ? formatDate(item.last_received_at) : c.never}
              />
            </div>

            {item.locations.length > 1 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">{c.whereItIs}</p>
                <ul className="divide-y divide-border rounded-2xl border border-border">
                  {item.locations.map((l) => (
                    <li
                      key={l.location}
                      className="flex items-center justify-between px-4 py-2.5 text-sm"
                    >
                      <span className="text-foreground">{l.location_name}</span>
                      <span className="font-semibold tabular-nums">
                        {formatQty(l.on_hand)} {item.base_unit_code}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {can(P.COUNT) && (
                <QuickButton
                  icon={ClipboardCheck}
                  label={c.count}
                  onClick={() => goto("count", { location: item.default_location ?? undefined })}
                />
              )}
              {can(P.RECEIVE) && (
                <QuickButton icon={Truck} label={c.addDelivery} onClick={() => goto("delivery")} />
              )}
              {can(P.TRANSFER) && (
                <QuickButton icon={ArrowLeftRight} label={c.move} onClick={() => goto("move")} />
              )}
              {can(P.RECORD_WASTE) && (
                <QuickButton
                  icon={PackageMinus}
                  label={c.recordWaste}
                  onClick={() => goto("waste")}
                />
              )}
            </div>

            {(can(P.MANAGE_ITEMS) || can(P.ADJUST) || can(P.VIEW_REPORTS)) && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {can(P.MANAGE_ITEMS) && (
                  <QuickButton icon={Pencil} label={c.editItem} onClick={() => onEdit(item)} />
                )}
                {can(P.ADJUST) && (
                  <QuickButton
                    icon={SlidersHorizontal}
                    label={c.fixStock}
                    onClick={() => goto("fix")}
                  />
                )}
                {can(P.VIEW_REPORTS) && (
                  <QuickButton
                    icon={History}
                    label={c.viewHistory}
                    onClick={() => goto("history")}
                  />
                )}
                {can(P.MANAGE_ITEMS) && (
                  <QuickButton
                    icon={Trash2}
                    label={c.deleteItem}
                    danger
                    onClick={() => onDelete(item)}
                  />
                )}
              </div>
            )}

            <details className="rounded-2xl border border-border">
              <summary className="flex min-h-[48px] cursor-pointer items-center px-4 text-sm font-semibold text-foreground">
                {c.more}
              </summary>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border px-4 py-4 text-sm">
                <dt className="text-muted-foreground">{c.keepAround}</dt>
                <dd className="text-right font-medium">
                  {item.par_level ? `${formatQty(item.par_level)} ${item.base_unit_code}` : "—"}
                </dd>
                <dt className="text-muted-foreground">{c.warnMeBelow}</dt>
                <dd className="text-right font-medium">
                  {item.reorder_point
                    ? `${formatQty(item.reorder_point)} ${item.base_unit_code}`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">{c.veryLowLevel}</dt>
                <dd className="text-right font-medium">
                  {item.critical_level
                    ? `${formatQty(item.critical_level)} ${item.base_unit_code}`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">{c.howYouBuy}</dt>
                <dd className="text-right font-medium">
                  {item.purchase_unit_conversion
                    ? copy.itemForm.packSummary(
                        item.purchase_unit_label || "pack",
                        formatQty(item.purchase_unit_conversion),
                        item.base_unit_code,
                      )
                    : item.base_unit_code}
                </dd>
                <dt className="text-muted-foreground">{c.code}</dt>
                <dd className="text-right font-medium">{item.sku || "—"}</dd>
                <dt className="text-muted-foreground">{c.barcode}</dt>
                <dd className="text-right font-medium">{item.barcode || "—"}</dd>
                <dt className="text-muted-foreground">{c.supplier}</dt>
                <dd className="text-right font-medium">{item.supplier_name || "—"}</dd>
                {can(P.VIEW_COST) && item.stock_value !== null && (
                  <>
                    <dt className="text-muted-foreground">{c.stockValue}</dt>
                    <dd className="text-right font-medium">{formatMoney(item.stock_value, sym)}</dd>
                    <dt className="text-muted-foreground">{c.averageCost}</dt>
                    <dd className="text-right font-medium">
                      {item.avg_cost
                        ? `${formatMoney(item.avg_cost, sym)} / ${item.base_unit_code}`
                        : "—"}
                    </dd>
                  </>
                )}
              </dl>
            </details>

            {can(P.VIEW_REPORTS) && (history.data?.results.length ?? 0) > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">{c.recentChanges}</p>
                <ul className="divide-y divide-border rounded-2xl border border-border">
                  {history.data?.results.map((m) => {
                    const qty = Number(m.quantity_change);
                    return (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">
                            {friendlyMovementLabel(m.movement_type)}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {formatDate(m.created_at)} · {m.location_name}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 font-semibold tabular-nums ${qty >= 0 ? "text-olive" : "text-danger"}`}
                        >
                          {qty >= 0 ? "+" : "−"}
                          {formatQty(Math.abs(qty))} {m.unit_code}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
