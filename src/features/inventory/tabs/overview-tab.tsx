// src/features/inventory/tabs/overview-tab.tsx
import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  ClipboardCheck,
  PackagePlus,
  Trash2,
  Wallet,
  AlertTriangle,
  PackageX,
  TrendingUp,
  CalendarClock,
  FileText,
} from "lucide-react";
import { inventoryApi, type InventoryOverview } from "@/lib/api";
import {
  ErrorBlock,
  LoadingBlock,
  SectionHeader,
  StatCard,
  StatusBadge,
  formatMoney,
  formatQty,
  formatDate,
  errorMessage,
  ActionCard,
} from "@/features/inventory/components/bits";

export function OverviewTab({
  sym,
  onNavigate,
}: {
  sym: string;
  onNavigate: (tab: "counts" | "actions") => void;
}) {
  const [data, setData] = useState<InventoryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    inventoryApi
      .overview()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, "Failed to load overview"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={error || "No data"} />;

  const attention = data.needs_attention ?? [];
  const movements = data.recent_movements ?? [];
  const dueList = data.counts_due_list ?? [];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ActionCard icon={ClipboardCheck} title="Count Stock" description="Check what is left." onClick={() => onNavigate("counts")} />
        <ActionCard icon={PackagePlus} title="Add Delivery" description="New stock arrived." onClick={() => onNavigate("actions")} />
        <ActionCard icon={ArrowLeftRight} title="Move Stock" description="Move items to another area." onClick={() => onNavigate("actions")} />
        <ActionCard icon={Trash2} title="Record Waste" description="Something was lost or thrown away." onClick={() => onNavigate("actions")} />
      </div>
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Stock Value"
          value={formatMoney(data.inventory_value, sym)}
          icon={Wallet}
        />
        <StatCard
          label="Low Stock"
          value={data.low_stock_count}
          icon={AlertTriangle}
          tone={data.low_stock_count > 0 ? "warn" : "ok"}
        />
        <StatCard
          label="Out of Stock"
          value={data.out_of_stock_count}
          icon={PackageX}
          tone={data.out_of_stock_count > 0 ? "danger" : "ok"}
        />
        <StatCard
          label="Overstock"
          value={data.overstock_count}
          icon={TrendingUp}
          tone={data.overstock_count > 0 ? "warn" : "ok"}
        />
        <StatCard label="Counts Due" value={data.counts_due} icon={CalendarClock} />
        <StatCard
          label="Open POs"
          value={data.open_purchase_orders}
          icon={FileText}
          tone={data.open_purchase_orders > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Needs attention */}
        <div className="space-y-3">
          <SectionHeader
            title="Needs Attention"
            subtitle="Items that may need a quick check"
          />
          {attention.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              All items are at a healthy stock level.
            </div>
          ) : (
            <div className="space-y-2">
              {attention.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatQty(a.available)} {a.unit} left · {a.location}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <StatusBadge status={a.status} />
                    {a.next_count_due && (
                      <span className="hidden text-[11px] text-muted-foreground sm:block">
                        Count due {formatDate(a.next_count_due)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent movements */}
        <div className="space-y-3">
          <SectionHeader
            title="Recent Movements"
            subtitle="Latest stock activity across locations"
          />
          {movements.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              No movements recorded yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-sm">
                <tbody>
                  {movements.map((m) => {
                    const qty = Number(m.quantity_change);
                    const up = qty >= 0;
                    return (
                      <tr key={m.id} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              up ? "text-emerald-600" : "text-rose-600"
                            }`}
                          >
                            {m.movement_type.replace(/_/g, " ")}
                          </span>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {m.item} · {m.location}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span
                            className={`text-sm font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}
                          >
                            {up ? "+" : ""}
                            {formatQty(m.quantity_change)}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-right text-xs text-muted-foreground sm:table-cell">
                          {formatDate(m.created_at)}
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

      {/* Counts due list */}
      {dueList.length > 0 && (
        <div className="space-y-3">
          <SectionHeader title="Counts Due Soon" subtitle="Hit their scheduled frequency window" />
          <div className="flex flex-wrap gap-2">
            {dueList.map((d, i) => (
              <div
                key={i}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700"
              >
                {d.item} · {d.label} {d.due ? `(${formatDate(d.due)})` : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
