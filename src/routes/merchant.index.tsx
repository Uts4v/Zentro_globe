import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp, Users, Coffee, Loader2, Activity, ShoppingBag, RefreshCw, Clock, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { analyticsApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DashboardOrderChart } from "@/components/charts";

export const Route = createFileRoute("/merchant/")({
  head: () => ({ meta: [{ title: "Overview · Merchant · Zentro" }] }),
  component: Overview,
});

interface TopItem {
  id: string;
  name: string;
  emoji: string;
  sold: number;
}

interface OverviewStats {
  trend: { date: string; count: number; revenue: number }[];
  velocity_change: number;
  active_members: number;
  today: { orders: number; revenue: number };
}

interface AnalyticsDailyRow {
  date: string;
  revenue: number;
  orders: number;
}

interface AnalyticsTopItem {
  name: string;
  total_qty: number;
  total_revenue: number;
}

interface AnalyticsResponse {
  daily_revenue?: AnalyticsDailyRow[];
  today?: { orders: number; revenue: number };
  yesterday?: { orders: number; revenue: number };
  loyalty?: { active_members?: number };
  top_customers?: { name: string; order_count: number; total_spent: number }[];
  top_items?: AnalyticsTopItem[];
}

// Build a today-centric OverviewStats from the Django analytics response.
// The backend already returns a zero-filled daily series (in the merchant's
// local timezone) plus explicit today/yesterday summaries.
function buildOverviewStats(data: AnalyticsResponse): OverviewStats {
  const daily = data.daily_revenue ?? [];

  const trend = daily.slice(-12).map((d) => ({
    date: d.date,
    count: Number(d.orders ?? 0),
    revenue: Number(d.revenue ?? 0),
  }));

  const todayRev = Number(data.today?.revenue ?? 0);
  const yesterdayRev = Number(data.yesterday?.revenue ?? 0);
  const velocityChange =
    yesterdayRev > 0 ? Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100) : 0;

  return {
    trend,
    velocity_change: velocityChange,
    active_members: Number(data.loyalty?.active_members ?? data.top_customers?.length ?? 0),
    today: {
      orders: Number(data.today?.orders ?? 0),
      revenue: todayRev,
    },
  };
}

function formatMoney(value: number | string | null | undefined, sym = "Rs") {
  return `${sym} ${Number(value ?? 0).toLocaleString()}`;
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

function Overview() {
  const { merchantProfile } = useAuth();

  const sym = merchantProfile?.currency_symbol || "Rs";

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadOverview = useCallback(
    async (isRefresh = false) => {
      if (!merchantProfile?.id) return;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const data = await analyticsApi.merchant(30);
        setStats(buildOverviewStats(data));

        // Top items from Django analytics
        const rankedItems = (data.top_items ?? [])
          .slice(0, 4)
          .map((item: AnalyticsTopItem, index: number) => ({
            id: `${index}-${item.name}`,
            name: item.name,
            emoji: "☕",
            sold: item.total_qty ?? 0,
          }));
        setTopItems(rankedItems);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load merchant overview");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [merchantProfile?.id],
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const today = stats?.today ?? {
    orders: 0,
    revenue: 0,
  };

  const activeMembers = stats?.active_members ?? 0;
  const velocity = stats?.trend ?? [];
  const velocityChange = stats?.velocity_change ?? 0;

  const averageOrderValue = today.orders > 0 ? Number(today.revenue ?? 0) / today.orders : 0;

  const maxVelocity = Math.max(...velocity.map((item) => item.count), 1);

  const statCards = useMemo(
    () => [
      {
        label: "Today's revenue",
        value: formatMoney(today.revenue, sym),
        icon: TrendingUp,
      },
      {
        label: "Orders today",
        value: String(today.orders),
        icon: Coffee,
      },
      {
        label: "Active members",
        value: String(activeMembers),
        icon: Users,
      },
      {
        label: "Average order",
        value: formatMoney(averageOrderValue, sym),
        icon: ShoppingBag,
      },
    ],
    [today.orders, today.revenue, activeMembers, averageOrderValue, sym],
  );

  if (!merchantProfile || loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Onboarding Pending Admin Approval Banner */}
      {merchantProfile && !merchantProfile.is_approved && (
        <div className="rounded-3xl border border-amber-300/80 bg-gradient-to-r from-amber-50 to-orange-50/60 p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-amber-500/20 text-amber-700">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold text-amber-900">
                    Store Under Review — Admin Approval Pending
                  </h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-200/80 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-600 animate-pulse" />
                    Pending Approval
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-amber-800/90 max-w-2xl">
                  Your store profile has been created and is currently awaiting administrator review. During this review period, public customer URLs (<code className="rounded bg-amber-200/50 px-1 py-0.5 font-mono text-[11px]">/m/{merchantProfile.slug}</code>) remain private.
                </p>
                <p className="mt-1.5 text-[11px] text-amber-700">
                  ✅ <strong>What you can do right now:</strong> Configure your menu catalog, set up tables and QR codes, test the POS register, and train staff. Everything will immediately go live once approved!
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="glass-strong rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p
              suppressHydrationWarning
              className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground"
            >
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>

            <h1
              suppressHydrationWarning
              className="font-display mt-3 text-4xl leading-tight text-ink sm:text-5xl"
            >
              {getGreeting()}, {(merchantProfile.business_name ?? "there").split(" ")[0]}.
            </h1>

            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Your store has received <span className="font-medium text-ink">{today.orders}</span>{" "}
              orders today with{" "}
              <span className="font-medium text-ink">{formatMoney(today.revenue, sym)}</span> in
              revenue.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => loadOverview(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-medium text-ink hover:bg-mist transition-colors disabled:opacity-50"
              title="Refresh live metrics"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-ember" : ""}`} />
              Refresh
            </button>

            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-mist px-4 py-2">
              <Activity className="h-4 w-4 text-ink" />
              <span className="text-xs font-medium text-ink">
                {velocityChange >= 0 ? "+" : ""}
                {velocityChange}% order velocity
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon;

          return (
            <div key={card.label} className="glass-strong rounded-3xl p-5">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-mist">
                <Icon className="h-4 w-4 text-ink" />
              </div>

              <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {card.label}
              </p>

              <p className="font-display mt-1 truncate text-2xl text-ink sm:text-3xl">
                {card.value}
              </p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="glass-strong rounded-3xl p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Last 12 days
              </p>
              <h2 className="font-display mt-1 text-2xl text-ink">Order trend</h2>
            </div>

            <span
              className={`font-display text-3xl ${
                velocityChange >= 0 ? "text-ember" : "text-muted-foreground"
              }`}
            >
              {velocityChange >= 0 ? "+" : ""}
              {velocityChange}%
            </span>
          </div>

          <div className="mt-4">
            <DashboardOrderChart data={velocity} currencySymbol={sym} />
          </div>
        </div>

        <div className="glass-strong rounded-3xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Menu performance
              </p>
              <h2 className="font-display mt-1 text-2xl text-ink">Top sellers</h2>
            </div>
          </div>

          <ul className="mt-5 space-y-3">
            {topItems.map((item, index) => (
              <li key={item.id} className="flex items-center gap-3">
                <span className="font-display w-5 text-sm text-muted-foreground">{index + 1}</span>

                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-mist text-xl">
                  {item.emoji}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.sold} sold</p>
                </div>
              </li>
            ))}

            {topItems.length === 0 && (
              <li className="rounded-3xl bg-mist/50 px-4 py-6 text-center text-sm text-muted-foreground">
                No top sellers yet
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
