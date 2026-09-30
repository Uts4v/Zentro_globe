// src/features/inventory/screens/HistoryScreen.tsx
// Stock History as a readable timeline. Undo creates an opposite entry;
// the original always stays.
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Undo2, X } from "lucide-react";
import { inventoryApi, type InventoryMovement } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  FilterChips,
  ListSkeleton,
  ScreenHeader,
  dayLabel,
  errorMessage,
  formatQty,
  formatTime,
  friendlyMovementLabel,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const hc = copy.history;
const GROUPS = [
  "",
  "deliveries",
  "counts",
  "waste",
  "moves",
  "corrections",
  "sales",
  "undo",
] as const;
type Group = (typeof GROUPS)[number];

function detailLine(m: InventoryMovement): string {
  switch (m.movement_type) {
    case "EXPLICIT_WASTE":
      return copy.waste.reasons[m.reason] ?? m.reason;
    case "COUNT_RECONCILIATION":
      return `${formatQty(m.balance_before)} ${m.unit_code} → ${formatQty(m.balance_after)} ${m.unit_code}`;
    case "RECEIVE":
      return m.note || "";
    case "MANUAL_ADJUSTMENT":
      return m.reason;
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return m.note || "";
    case "SALE":
      return m.reason;
    default:
      return m.reason && m.reason !== "Undo" && m.reason !== "Opening stock" ? m.reason : "";
  }
}

export function HistoryScreen() {
  const { can, go, params, refresh } = useInventory();
  const [group, setGroup] = useState<Group>("");
  const [itemId, setItemId] = useState<number | undefined>(params.item);
  const [undoing, setUndoing] = useState<InventoryMovement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const itemName = useQuery({
    queryKey: ["inventory", "item", itemId],
    queryFn: () => inventoryApi.itemDetail(itemId as number),
    enabled: Boolean(itemId),
  });

  const history = useInfiniteQuery({
    queryKey: ["inventory", "history", group, itemId],
    queryFn: ({ pageParam }) =>
      inventoryApi.movements({
        group: group || undefined,
        item: itemId,
        page: pageParam,
        page_size: 30,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const rows = history.data?.pages.flatMap((p) => p.results) ?? [];

  async function undo() {
    if (!undoing) return;
    setBusy(true);
    setError("");
    try {
      await inventoryApi.reverseMovement(undoing.id);
      toast.success(hc.undoToast);
      setUndoing(null);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
      setUndoing(null);
    } finally {
      setBusy(false);
    }
  }

  let lastDay = "";
  return (
    <div className="space-y-4">
      <ScreenHeader title={hc.title} subtitle={hc.subtitle} onBack={() => go("home")} />
      <FilterChips
        label={hc.title}
        value={group}
        onChange={setGroup}
        options={GROUPS.map((g) => ({ value: g, label: hc.filters[g || "all"] }))}
      />
      {itemId && (
        <button
          type="button"
          onClick={() => setItemId(undefined)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-4 text-sm font-medium text-foreground"
        >
          {itemName.data?.name ?? "…"}{" "}
          <X className="h-4 w-4" aria-label={copy.stock.clearFilters} />
        </button>
      )}
      {error && <ErrorBlock message={error} />}
      {history.isLoading ? (
        <ListSkeleton />
      ) : history.isError ? (
        <ErrorBlock
          message={errorMessage(history.error, copy.errors.load)}
          onRetry={() => history.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={hc.empty} />
      ) : (
        <ol className="space-y-2">
          {rows.map((m) => {
            const day = dayLabel(m.created_at);
            const showDay = day !== lastDay;
            lastDay = day;
            const qty = Number(m.quantity_change);
            const detail = detailLine(m);
            const canUndo = can(P.ADJUST) && m.movement_type !== "REVERSAL" && !m.is_reversed;
            return (
              <li key={m.id}>
                {showDay && (
                  <h3 className="mb-2 mt-4 text-sm font-semibold text-muted-foreground first:mt-0">
                    {day}
                  </h3>
                )}
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border bg-card p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {formatTime(m.created_at)} · {m.location_name}
                    </p>
                    <p className="mt-0.5 font-semibold text-foreground">
                      {m.item}{" "}
                      <span className={`tabular-nums ${qty >= 0 ? "text-olive" : "text-danger"}`}>
                        {qty >= 0 ? "+" : "−"}
                        {formatQty(Math.abs(qty))} {m.unit_code}
                      </span>
                    </p>
                    <p className="text-sm text-foreground">
                      {friendlyMovementLabel(m.movement_type)}
                      {detail ? ` · ${detail}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {hc.by(m.performed_by_name)}
                      {m.approved_by_name ? ` · ${hc.approvedBy(m.approved_by_name)}` : ""}
                    </p>
                  </div>
                  {m.is_reversed ? (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {hc.undone}
                    </span>
                  ) : (
                    canUndo && (
                      <Button variant="outline" className="h-11" onClick={() => setUndoing(m)}>
                        <Undo2 className="h-4 w-4" aria-hidden="true" /> {hc.undo}
                      </Button>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          className="h-11 w-full"
          disabled={history.isFetchingNextPage}
          onClick={() => history.fetchNextPage()}
        >
          {hc.loadMore}
        </Button>
      )}
      <ConfirmDialog
        open={Boolean(undoing)}
        onOpenChange={(v) => !v && setUndoing(null)}
        title={hc.undoTitle}
        busy={busy}
        confirmLabel={hc.undoConfirm}
        onConfirm={undo}
        body={
          <>
            {undoing && (
              <p className="text-base text-foreground">
                {undoing.item}: {friendlyMovementLabel(undoing.movement_type)}{" "}
                {Number(undoing.quantity_change) >= 0 ? "+" : "−"}
                {formatQty(Math.abs(Number(undoing.quantity_change)))} {undoing.unit_code}
              </p>
            )}
            <p>{hc.undoBody}</p>
          </>
        }
      />
    </div>
  );
}
