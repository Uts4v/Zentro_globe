import {
  TrendingUp,
  TrendingDown,
  Users,
  Loader2,
  Search,
  X,
  Clock,
  Receipt,
  Sparkles,
  Gift,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { analyticsApi, orderApi, type Order, type OrderStatus } from "@/lib/api";

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
}
interface HourPoint {
  hour: number;
  count: number;
}
interface TopItem {
  name: string;
  total_qty: number;
  total_revenue: number;
}
interface TopCustomer {
  name: string;
  order_count: number;
  total_spent: number;
}

interface AnalyticsData {
  period_days: number;
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  today: { revenue: number; orders: number };
  yesterday: { revenue: number; orders: number };
  daily_revenue: DailyPoint[];
  hourly_velocity: HourPoint[];
  busiest_hours: HourPoint[];
  top_items: TopItem[];
  top_customers: TopCustomer[];
  orders_by_status: Record<string, number>;
  orders_by_fulfillment: Record<string, number>;
  orders_by_type: Record<string, number>;
  orders_by_source: Record<string, number>;
  orders_by_payment: { method: string; count: number; revenue: number }[];
  customers: {
    total_customers: number;
    new_customers: number;
    returning_customers: number;
    guest_orders: number;
  };
  weekly: {
    this_week: { revenue: number; orders: number };
    last_week: { revenue: number; orders: number };
  };
  loyalty: {
    active_members: number;
    points_issued: number;
    rewards_redeemed: number;
    punch_cards_redeemed: number;
  };
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-sky-100 text-sky-700",
  preparing: "bg-violet-100 text-violet-700",
  ready: "bg-emerald-100 text-emerald-700",
  completed: "bg-mist text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-500",
};

const FULFILLMENT_LABEL: Record<string, string> = {
  dine_in: "Dine In",
  pickup: "Pickup",
  delivery: "Delivery",
};

const TYPE_LABEL: Record<string, string> = {
  regular: "Regular",
  punch_card_redemption: "Punch Redemption",
  reward_redemption: "Reward Redemption",
};

const SOURCE_LABEL: Record<string, string> = {
  customer_app: "Customer App",
  table_qr: "Table QR",
  merchant_dashboard: "Dashboard",
  pos_online: "POS Online",
  pos_offline: "POS Offline",
};

const MAX_HISTORY_DAYS = 60;

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatNPR(value: number | string | null | undefined) {
  return `NPR ${Number(value ?? 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}`;
}

function formatDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MerchantAnalyticsPage() {
  const [range, setRange] = useState<14 | 30 | 90>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Order history state
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const perPage = 10;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    analyticsApi
      .merchant(range)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, "Failed to load analytics"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const orders = await orderApi.merchantHistory({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setHistoryOrders(orders);
      setHistoryPage(1);
    } catch (e: unknown) {
      setHistoryError(errorMessage(e, "Failed to load order history"));
    } finally {
      setHistoryLoading(false);
    }
  }, [searchQuery, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (loading)
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  if (error)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );

  const daily = data?.daily_revenue ?? [];
  const items = data?.top_items ?? [];
  const customers = data?.top_customers ?? [];
  const busiestHours = data?.busiest_hours ?? [];

  const todayRev = Number(data?.today?.revenue ?? 0);
  const yesterdayRev = Number(data?.yesterday?.revenue ?? 0);
  const todayOrders = Number(data?.today?.orders ?? 0);
  const yesterdayOrders = Number(data?.yesterday?.orders ?? 0);
  const revDelta =
    yesterdayRev > 0 ? Math.round(((todayRev - yesterdayRev) / yesterdayRev) * 100) : 0;
  const ordersDelta =
    yesterdayOrders > 0 ? Math.round(((todayOrders - yesterdayOrders) / yesterdayOrders) * 100) : 0;

  const thisWeek = data?.weekly?.this_week;
  const lastWeek = data?.weekly?.last_week;
  const weekRevDelta =
    thisWeek && lastWeek && lastWeek.revenue > 0
      ? Math.round(((thisWeek.revenue - lastWeek.revenue) / lastWeek.revenue) * 100)
      : 0;
  const weekOrdersDelta =
    thisWeek && lastWeek && lastWeek.orders > 0
      ? Math.round(((thisWeek.orders - lastWeek.orders) / lastWeek.orders) * 100)
      : 0;

  const statusRows = Object.entries(data?.orders_by_status ?? {}).filter(([, v]) => v > 0);
  const fulfillmentRows = Object.entries(data?.orders_by_fulfillment ?? {}).filter(
    ([, v]) => v > 0,
  );
  const typeRows = Object.entries(data?.orders_by_type ?? {}).filter(([, v]) => v > 0);
  const sourceRows = Object.entries(data?.orders_by_source ?? {}).filter(([, v]) => v > 0);
  const paymentRows = data?.orders_by_payment ?? [];

  const totalPages = Math.ceil(historyOrders.length / perPage);
  const pagedOrders = historyOrders.slice((historyPage - 1) * perPage, historyPage * perPage);

  return (
    <div className="space-y-8">
      {/* Header + range tabs */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Last {range} days
          </p>
          <h1 className="font-display mt-1 text-5xl text-foreground">Analytics</h1>
        </div>
        <div className="flex gap-1">
          {([14, 30, 90] as const).map((p) => (
            <button
              key={p}
              onClick={() => setRange(p)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                range === p ? "bg-ink text-primary-foreground" : "glass text-muted-foreground"
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Revenue"
          value={formatNPR(data?.total_revenue)}
          sub={`Last ${range} days`}
          icon={TrendingUp}
        />
        <Kpi
          label="Orders"
          value={String(data?.total_orders ?? 0)}
          sub={`Last ${range} days`}
          icon={Receipt}
        />
        <Kpi
          label="Avg order"
          value={formatNPR(data?.avg_order_value)}
          sub="Per order"
          icon={Receipt}
        />
        <Kpi
          label="Active members"
          value={String(data?.loyalty?.active_members ?? 0)}
          sub="Loyalty members"
          icon={Users}
        />
        <Kpi
          label="Today's revenue"
          value={formatNPR(todayRev)}
          delta={revDelta}
          sub="vs yesterday"
          icon={TrendingUp}
        />
        <Kpi
          label="Orders today"
          value={String(todayOrders)}
          delta={ordersDelta}
          sub="vs yesterday"
          icon={Receipt}
        />
        <Kpi
          label="New customers"
          value={String(data?.customers?.new_customers ?? 0)}
          sub={`Last ${range} days`}
          icon={Users}
        />
        <Kpi
          label="Guest orders"
          value={String(data?.customers?.guest_orders ?? 0)}
          sub="Walk-in, no account"
          icon={Receipt}
        />
      </section>

      {/* Trend + peak hours */}
      <section className="grid gap-3 lg:grid-cols-3">
        <section className="glass-strong rounded-3xl p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Revenue & orders
              </p>
              <h2 className="font-display mt-1 text-3xl text-foreground">
                Trend over {range} days
              </h2>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "#E85D3A" }} />
                Revenue
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                Orders
              </span>
            </div>
          </div>

          <div className="mt-6 h-48">
            {daily.length === 0 || daily.every((d) => d.revenue === 0 && d.orders === 0) ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No completed orders in this period yet
              </div>
            ) : (
              <TrendChart points={daily} />
            )}
          </div>
          <DateLabels points={daily} />
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Peak hours</p>
          <h2 className="font-display mt-1 text-3xl text-foreground">Busiest hours</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Orders by hour of day, last {range} days
          </p>
          <div className="mt-6">
            <BusiestHoursChart hours={busiestHours} />
          </div>
        </section>
      </section>

      {/* Weekly comparison */}
      <section className="grid gap-3 sm:grid-cols-2">
        <PeriodCard
          title="This week"
          revenue={thisWeek?.revenue ?? 0}
          orders={thisWeek?.orders ?? 0}
          deltaRev={weekRevDelta}
          deltaOrders={weekOrdersDelta}
          vsLabel="vs last week"
        />
        <PeriodCard
          title="Last week"
          revenue={lastWeek?.revenue ?? 0}
          orders={lastWeek?.orders ?? 0}
          vsLabel="previous 7 days"
        />
      </section>

      {/* Breakdowns */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Status</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Orders by status</h3>
          {statusRows.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2">
              {statusRows.map(([status, count]) => (
                <div key={status} className="rounded-2xl bg-mist p-3 text-center">
                  <p className="font-display text-2xl text-foreground">{count}</p>
                  <p
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] capitalize ${STATUS_COLOR[status as OrderStatus]}`}
                  >
                    {status}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Fulfillment
          </p>
          <h3 className="font-display mt-1 text-2xl text-foreground">How served</h3>
          {fulfillmentRows.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ProgressList
              items={fulfillmentRows.map(([key, value]) => ({
                label: FULFILLMENT_LABEL[key] ?? key,
                value,
              }))}
            />
          )}
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Order type</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Type mix</h3>
          {typeRows.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ProgressList
              items={typeRows.map(([key, value]) => ({
                label: TYPE_LABEL[key] ?? key,
                value,
              }))}
            />
          )}
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Source</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Order sources</h3>
          {sourceRows.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ProgressList
              items={sourceRows.map(([key, value]) => ({
                label: SOURCE_LABEL[key] ?? key,
                value,
              }))}
            />
          )}
        </section>
      </section>

      {/* Payments + loyalty */}
      <section className="grid gap-3 lg:grid-cols-2">
        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Payments</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Payment methods</h3>
          {paymentRows.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No payment data yet.</p>
          ) : (
            <PaymentList rows={paymentRows} />
          )}
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Loyalty</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Member activity</h3>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <LoyaltyStat
              icon={Sparkles}
              label="Points issued"
              value={String(Math.round(data?.loyalty?.points_issued ?? 0))}
            />
            <LoyaltyStat
              icon={Gift}
              label="Rewards redeemed"
              value={String(data?.loyalty?.rewards_redeemed ?? 0)}
            />
            <LoyaltyStat
              icon={Receipt}
              label="Punch redemptions"
              value={String(data?.loyalty?.punch_cards_redeemed ?? 0)}
            />
            <LoyaltyStat
              icon={Users}
              label="Active members"
              value={String(data?.loyalty?.active_members ?? 0)}
            />
          </div>

          <div className="mt-6 space-y-2">
            <StatRow
              label="New customers"
              value={String(data?.customers?.new_customers ?? 0)}
              hint={`Last ${range} days`}
            />
            <StatRow
              label="Returning customers"
              value={String(data?.customers?.returning_customers ?? 0)}
              hint={`Last ${range} days`}
            />
            <StatRow
              label="Guest / walk-in orders"
              value={String(data?.customers?.guest_orders ?? 0)}
              hint="No account on file"
            />
          </div>
        </section>
      </section>

      {/* Top items + top customers */}
      <section className="grid gap-3 lg:grid-cols-2">
        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Top items</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Best sellers</h3>
          {items.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mist text-xs font-medium text-foreground">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-foreground">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.total_qty}× sold</span>
                  <span className="font-display text-sm text-ember">
                    {formatNPR(item.total_revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass-strong rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Leaderboard
              </p>
              <h3 className="font-display mt-1 text-2xl text-foreground">Top customers</h3>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          {customers.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">No completed orders yet.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {customers.map((c, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium ${
                      i === 0
                        ? "bg-amber-100 text-amber-700"
                        : i === 1
                          ? "bg-slate-100 text-slate-600"
                          : i === 2
                            ? "bg-orange-100 text-orange-700"
                            : "bg-mist text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-foreground">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.order_count} order{c.order_count !== 1 ? "s" : ""}
                  </span>
                  <span className="font-display text-sm text-ember">
                    {formatNPR(c.total_spent)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      {/* ── Order History Section ──────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6 space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Order History
          </p>
          <h3 className="font-display mt-1 text-2xl text-foreground">
            Past orders (up to 2 months)
          </h3>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center bg-mist/30 p-4 rounded-3xl border border-border/40">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by customer or item..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-2xl bg-mist pl-10 pr-10 text-sm text-foreground outline-none border border-transparent focus:border-border transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-2xl bg-mist px-3 text-sm text-foreground outline-none border border-transparent focus:border-border transition-colors cursor-pointer"
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  const selected = new Date(val);
                  const minDate = new Date();
                  minDate.setDate(minDate.getDate() - MAX_HISTORY_DAYS);
                  if (selected < minDate) {
                    setDateFrom(toLocalDateStr(minDate));
                    return;
                  }
                }
                setDateFrom(val);
              }}
              max={dateTo || toLocalDateStr(new Date())}
              className="h-10 rounded-2xl bg-mist px-3 text-sm text-foreground outline-none border border-transparent focus:border-border transition-colors cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              max={toLocalDateStr(new Date())}
              className="h-10 rounded-2xl bg-mist px-3 text-sm text-foreground outline-none border border-transparent focus:border-border transition-colors cursor-pointer"
            />
          </div>
        </div>

        {historyError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {historyError}
          </div>
        )}

        {historyLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : historyOrders.length === 0 ? (
          <div className="rounded-2xl bg-mist/50 py-10 text-center text-sm text-muted-foreground">
            No orders found for the selected filters.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {pagedOrders.map((order) => (
                <HistoryOrderCard key={order.id} order={order} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={historyPage === 1}
                  className="h-9 rounded-xl bg-mist px-3 text-xs font-medium text-foreground disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {historyPage} of {totalPages}
                </span>
                <button
                  onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                  disabled={historyPage === totalPages}
                  className="h-9 rounded-xl bg-mist px-3 text-xs font-medium text-foreground disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ── History Order Card ────────────────────────────────────────────────────────

function HistoryOrderCard({ order }: { order: Order }) {
  const customerName = order.profiles?.full_name ?? order.customer_name ?? "Customer";
  const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  let timeLabel: string;
  if (days > 0) timeLabel = `${days}d ago`;
  else if (hours > 0) timeLabel = `${hours}h ago`;
  else if (mins > 0) timeLabel = `${mins}m ago`;
  else timeLabel = "Just now";

  const isPunchCard = order.order_type === "punch_card_redemption";
  const isReward = order.order_type === "reward_redemption";

  return (
    <div className="glass cv-auto rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            #{String(order.id).slice(0, 8)}
          </p>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-widest font-medium ${STATUS_COLOR[order.status]}`}
          >
            {order.status}
          </span>
          {isPunchCard && (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              Punch Card
            </span>
          )}
          {isReward && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              Reward
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-foreground truncate">{customerName}</p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {(order.order_items ?? []).slice(0, 3).map((item) => (
            <li key={item.id}>
              {item.quantity}× {item.name}
            </li>
          ))}
          {(order.order_items ?? []).length > 3 && <li>+{order.order_items.length - 3} more</li>}
        </ul>
      </div>

      <div className="flex items-center gap-4 sm:text-right shrink-0">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {timeLabel}
        </span>
        <span className="font-display text-base text-foreground">
          {Number(order.total_amount) > 0 ? formatNPR(order.total_amount) : "FREE"}
        </span>
      </div>
    </div>
  );
}

// ── KPI / delta helpers ───────────────────────────────────────────────────────

function Delta({ value, suffix = "%" }: { value: number; suffix?: string }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        up ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-600"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {value}
      {suffix}
    </span>
  );
}

function Kpi({
  label,
  value,
  delta,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  delta?: number;
  sub?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="glass-strong rounded-3xl p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="font-display mt-2 text-3xl text-foreground">{value}</p>
      {delta !== undefined && (
        <div className="mt-2">
          <Delta value={delta} />
        </div>
      )}
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
      <div>
        <p className="text-xs text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <p className="font-display text-xl text-foreground">{value}</p>
    </div>
  );
}

function LoyaltyStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-mist p-4">
      <Icon className="h-4 w-4 text-ember" />
      <p className="font-display mt-3 text-2xl text-foreground">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function PeriodCard({
  title,
  revenue,
  orders,
  deltaRev,
  deltaOrders,
  vsLabel,
}: {
  title: string;
  revenue: number;
  orders: number;
  deltaRev?: number;
  deltaOrders?: number;
  vsLabel?: string;
}) {
  return (
    <div className="glass-strong rounded-3xl p-6">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-3xl text-foreground">{formatNPR(revenue)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{orders} orders</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {deltaRev !== undefined && (
            <>
              <Delta value={deltaRev} />
              {deltaOrders !== undefined && <Delta value={deltaOrders} suffix=" orders" />}
              {vsLabel && <span className="text-[10px] text-muted-foreground">{vsLabel}</span>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Progress / payment lists ──────────────────────────────────────────────────

function ProgressList({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="mt-5 space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-center justify-between text-sm">
            <span className="capitalize text-foreground">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.value}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: "#E85D3A" }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PaymentList({ rows }: { rows: { method: string; count: number; revenue: number }[] }) {
  const maxRev = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <ul className="mt-5 space-y-4">
      {rows.map((row) => (
        <li key={row.method}>
          <div className="flex items-center justify-between text-sm">
            <span className="capitalize text-foreground">{row.method.replace(/_/g, " ")}</span>
            <span className="font-display text-sm text-foreground">{formatNPR(row.revenue)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist">
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.revenue / maxRev) * 100}%`, backgroundColor: "#E85D3A" }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">{row.count} orders</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────────

function DateLabels({ points }: { points: DailyPoint[] }) {
  const n = points.length;
  if (n === 0) return null;
  const indices =
    n <= 4
      ? points.map((_, i) => i)
      : [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1];
  return (
    <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
      {indices.map((i) => (
        <span key={i}>{formatDay(points[i].date)}</span>
      ))}
    </div>
  );
}

function TrendChart({ points }: { points: DailyPoint[] }) {
  const W = 320;
  const H = 120;
  const n = Math.max(points.length - 1, 1);
  const maxRev = Math.max(...points.map((p) => Number(p.revenue)), 1);
  const maxOrders = Math.max(...points.map((p) => Number(p.orders)), 1);

  const revLine = points
    .map((p, i) => {
      const x = (i / n) * W;
      const y = H - (Number(p.revenue) / maxRev) * (H - 8) - 4;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" L ");
  const revArea = `M ${revLine} L ${W},${H} L 0,${H} Z`;
  const barW = Math.max((W / points.length) * 0.4, 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-full w-full overflow-visible"
    >
      <defs>
        <linearGradient id="analytics-rev" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E85D3A" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#E85D3A" stopOpacity="0" />
        </linearGradient>
      </defs>

      {points.map((p, i) => {
        const center = ((i + 0.5) / points.length) * W;
        const bh = (Number(p.orders) / maxOrders) * (H - 8);
        return (
          <rect
            key={p.date}
            x={center - barW / 2}
            y={H - bh}
            width={barW}
            height={bh}
            rx={1.5}
            fill="#D8D5CE"
            opacity={0.7}
          />
        );
      })}

      <path d={revArea} fill="url(#analytics-rev)" />
      <path d={`M ${revLine}`} fill="none" stroke="#E85D3A" strokeWidth="1.5" />
    </svg>
  );
}

function BusiestHoursChart({ hours }: { hours: HourPoint[] }) {
  const max = Math.max(...hours.map((h) => h.count), 1);
  return (
    <div className="flex h-32 items-end gap-1">
      {hours.map((h) => {
        const height = h.count > 0 ? Math.max((h.count / max) * 100, 8) : 2;
        const showLabel = h.hour % 6 === 0;
        return (
          <div
            key={h.hour}
            className="group relative flex flex-1 flex-col items-center justify-end gap-1"
            title={`${h.hour}:00 — ${h.count} order${h.count === 1 ? "" : "s"}`}
          >
            <div
              className="w-full rounded-t transition-opacity group-hover:opacity-100"
              style={{
                height: `${height}%`,
                backgroundColor: "#E85D3A",
                opacity: h.count > 0 ? 0.85 : 0.12,
              }}
            />
            {showLabel && <span className="text-[9px] text-muted-foreground">{h.hour}:00</span>}
          </div>
        );
      })}
    </div>
  );
}
