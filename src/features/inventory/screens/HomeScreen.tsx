// src/features/inventory/screens/HomeScreen.tsx
// "What needs attention?" and "What do you want to do?" — tasks first,
// no wall of analytics cards.
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  ClipboardCheck,
  FileUp,
  History,
  Package,
  PackageMinus,
  Plus,
  SlidersHorizontal,
  Truck,
  Upload,
} from "lucide-react";
import { inventoryApi, type InventoryStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  ActionCard,
  EmptyState,
  ErrorBlock,
  ListSkeleton,
  StatusBadge,
  errorMessage,
  formatMoney,
  formatQty,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const h = copy.home;

export function HomeScreen() {
  const { can, go, root, sym } = useInventory();
  const { user } = useAuth();
  const overview = useQuery({
    queryKey: ["inventory", "overview"],
    queryFn: inventoryApi.overview,
  });
  const firstName = root.staff?.name ?? (user as { first_name?: string } | null)?.first_name ?? "";

  const tasks = [
    {
      show: can(P.VIEW),
      icon: Package,
      title: h.checkStock,
      hint: h.checkStockHint,
      view: "stock" as const,
    },
    {
      show: can(P.COUNT),
      icon: ClipboardCheck,
      title: h.countStock,
      hint: h.countStockHint,
      view: "count" as const,
    },
    {
      show: can(P.RECEIVE),
      icon: Truck,
      title: h.addDelivery,
      hint: h.addDeliveryHint,
      view: "delivery" as const,
    },
    {
      show: can(P.TRANSFER),
      icon: ArrowLeftRight,
      title: h.moveStock,
      hint: h.moveStockHint,
      view: "move" as const,
    },
    {
      show: can(P.RECORD_WASTE),
      icon: PackageMinus,
      title: h.recordWaste,
      hint: h.recordWasteHint,
      view: "waste" as const,
    },
  ].filter((t) => t.show);

  const managerTools = [
    {
      show: can(P.MANAGE_SUPPLIERS) || can(P.PURCHASE),
      icon: Building2,
      label: copy.nav.suppliers,
      view: "suppliers" as const,
    },
    {
      show: can(P.VIEW_REPORTS),
      icon: BarChart3,
      label: copy.nav.reports,
      view: "reports" as const,
    },
    { show: can(P.VIEW_REPORTS), icon: History, label: copy.nav.history, view: "history" as const },
    {
      show: can(P.ADJUST),
      icon: SlidersHorizontal,
      label: copy.actions.fixStock,
      view: "fix" as const,
    },
    { show: can(P.IMPORT), icon: FileUp, label: copy.nav.importExport, view: "io" as const },
  ].filter((t) => t.show);

  const data = overview.data;
  const attention = data?.needs_attention ?? [];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-lg text-muted-foreground">{h.greeting(firstName)}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">{h.question}</h2>
      </div>

      {root.item_count === 0 ? (
        <EmptyState
          title={h.emptyTitle}
          body={h.emptyHint}
          action={
            <>
              {can(P.MANAGE_ITEMS) && (
                <Button className="h-11" onClick={() => go("stock")}>
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t, i) => (
            <ActionCard
              key={t.view}
              icon={t.icon}
              title={t.title}
              description={t.hint}
              onClick={() => go(t.view)}
              tone={i === 0 ? "primary" : "default"}
            />
          ))}
        </div>
      )}

      {data &&
        (data.counts_waiting_review > 0 || data.corrections_waiting > 0) &&
        (can(P.APPROVE_COUNT) || can(P.APPROVE_ADJUSTMENT)) && (
          <div className="space-y-2">
            {data.counts_waiting_review > 0 && can(P.APPROVE_COUNT) && (
              <button
                type="button"
                onClick={() => go("count")}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-warning/40 bg-butter-soft px-4 text-left text-sm font-medium text-foreground"
              >
                <ClipboardCheck className="h-5 w-5 text-warning" aria-hidden="true" />{" "}
                {h.waitingReview(data.counts_waiting_review)}
              </button>
            )}
            {data.corrections_waiting > 0 && can(P.APPROVE_ADJUSTMENT) && (
              <button
                type="button"
                onClick={() => go("actions")}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-warning/40 bg-butter-soft px-4 text-left text-sm font-medium text-foreground"
              >
                <SlidersHorizontal className="h-5 w-5 text-warning" aria-hidden="true" />{" "}
                {h.correctionsWaiting(data.corrections_waiting)}
              </button>
            )}
          </div>
        )}

      {root.item_count > 0 && (
        <section className="space-y-3" aria-labelledby="needs-attention">
          <div className="flex items-center justify-between gap-3">
            <h3 id="needs-attention" className="text-lg font-semibold text-foreground">
              {h.needsAttention}
            </h3>
            {data && data.attention_total > attention.length && (
              <Button variant="link" onClick={() => go("stock")}>
                {h.seeAllLow(data.attention_total)}
              </Button>
            )}
          </div>
          {overview.isLoading ? (
            <ListSkeleton rows={3} />
          ) : overview.isError ? (
            <ErrorBlock
              message={errorMessage(overview.error, copy.errors.load)}
              onRetry={() => overview.refetch()}
            />
          ) : attention.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-6 text-center">
              <p className="font-semibold text-foreground">{h.allGood}</p>
              <p className="mt-1 text-sm text-muted-foreground">{h.allGoodHint}</p>
            </div>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {attention.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => go("stock", { item: a.id })}
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-foreground">{a.name}</span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {a.location || "—"} · {h.left(formatQty(a.available), a.unit)}
                      </span>
                    </span>
                    <StatusBadge status={a.status as InventoryStatus} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {managerTools.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">{h.managerTools}</h3>
          <div className="flex flex-wrap gap-2">
            {managerTools.map((t) => (
              <Button key={t.view} variant="outline" className="h-11" onClick={() => go(t.view)}>
                <t.icon className="h-4 w-4" aria-hidden="true" /> {t.label}
              </Button>
            ))}
          </div>
          {can(P.VIEW_COST) && data?.inventory_value != null && (
            <p className="text-sm text-muted-foreground">
              {copy.detail.stockValue}:{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(data.inventory_value, sym)}
              </span>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
