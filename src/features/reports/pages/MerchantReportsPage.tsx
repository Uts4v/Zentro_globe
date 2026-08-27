import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Loader2,
  Download,
  TrendingUp,
  TrendingDown,
  Receipt,
  Banknote,
  CreditCard,
  Smartphone,
  ShoppingCart,
  BarChart3,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import {
  DateRangeSelector,
  getDefaultDateRange,
  type DateRange,
} from "@/components/DateRangeSelector";
import {
  reportsApi,
  type SalesReportResponse,
  type PaymentAnalyticsResponse,
} from "@/lib/api/reports";
import { useAuth } from "@/lib/auth";

function fmt(
  value: number | string | null | undefined,
  symbol = "Rs",
  decimals = 0
): string {
  const num = Number(value ?? 0);
  return `${symbol} ${num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

type Tab = "overview" | "payments" | "tax" | "items" | "fiscal";

export function MerchantReportsPage() {
  const { merchantProfile } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange());
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [salesData, setSalesData] = useState<SalesReportResponse | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  const sym = merchantProfile?.currency_symbol || salesData?.currency_symbol || "Rs";
  const taxLabel = merchantProfile?.tax_components?.length
    ? merchantProfile.tax_components
        .filter((c) => (c.rate as number) > 0)
        .map((c) => c.name)
        .join(" + ")
    : salesData?.tax_label || "Tax";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sales, payments] = await Promise.all([
        reportsApi.sales({
          date_from: dateRange.dateFrom,
          date_to: dateRange.dateTo,
        }),
        reportsApi.payments({
          date_from: dateRange.dateFrom,
          date_to: dateRange.dateTo,
        }),
      ]);
      setSalesData(sales);
      setPaymentData(payments);
    } catch (e: any) {
      setError(e?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [dateRange.dateFrom, dateRange.dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleExport(type: "csv" | "pdf", reportType: string) {
    const params = {
      date_from: dateRange.dateFrom,
      date_to: dateRange.dateTo,
      type: reportType,
    };
    setExporting(true);
    try {
      if (type === "csv") await reportsApi.exportCsv(params);
      else await reportsApi.exportPdf(params);
    } catch (e: any) {
      setError(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "payments", label: "Payments" },
    { key: "tax", label: "Tax" },
    { key: "items", label: "Items" },
    { key: "fiscal", label: "Fiscal" },
  ];

  const ov = salesData?.overview;
  const cashOnline = salesData?.cash_online;
  const taxSum = salesData?.tax_summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Reports</p>
          <h1 className="font-display mt-1 text-4xl text-foreground">Sales & Reports</h1>
        </div>
        <DateRangeSelector value={dateRange} onChange={setDateRange} />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !salesData ? null : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-ink text-white"
                    : "bg-mist text-muted-foreground hover:bg-mist/80"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              <button
                disabled={exporting}
                onClick={() => handleExport("csv", activeTab === "fiscal" ? "fiscal" : activeTab)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                CSV
              </button>
              <button
                disabled={exporting}
                onClick={() => handleExport("pdf", activeTab === "fiscal" ? "fiscal" : activeTab)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                PDF
              </button>
            </div>
          </div>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* KPI Cards */}
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiCard
                  label="Total Sales"
                  value={fmt(ov?.total_sales, sym)}
                  icon={TrendingUp}
                />
                <KpiCard
                  label="Net Sales"
                  value={fmt(ov?.net_sales, sym)}
                  icon={TrendingUp}
                />
                <KpiCard
                  label="Orders"
                  value={String(ov?.total_orders ?? 0)}
                  icon={Receipt}
                />
                <KpiCard
                  label="Avg Order"
                  value={fmt(ov?.avg_order_value, sym, 2)}
                  icon={ShoppingCart}
                />
                <KpiCard
                  label="Tax Collected"
                  value={fmt(ov?.total_tax, sym)}
                  sub={taxLabel}
                  icon={BarChart3}
                />
                <KpiCard
                  label="Discounts"
                  value={fmt(ov?.total_discount, sym)}
                  icon={TrendingDown}
                />
                <KpiCard
                  label="Cash Collected"
                  value={fmt(cashOnline?.cash.amount, sym)}
                  sub={`${cashOnline?.cash.percentage ?? 0}%`}
                  icon={Banknote}
                />
                <KpiCard
                  label="Online Collected"
                  value={fmt(cashOnline?.online.amount, sym)}
                  sub={`${cashOnline?.online.percentage ?? 0}%`}
                  icon={CreditCard}
                />
              </section>

              {/* Refunds & Customers */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="glass-strong rounded-3xl p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Refunds</p>
                  <div className="mt-2 flex items-end justify-between">
                    <p className="font-display text-3xl font-bold text-foreground">
                      {salesData.refunds.count}
                    </p>
                    <p className="font-display text-lg text-rose-500">
                      {fmt(salesData.refunds.amount, sym)}
                    </p>
                  </div>
                </div>
                <div className="glass-strong rounded-3xl p-5">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Customers</p>
                  <div className="mt-2 flex items-end justify-between">
                    <p className="font-display text-3xl font-bold text-foreground">
                      {ov?.total_customers ?? 0}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ov?.guest_orders ?? 0} guest orders
                    </p>
                  </div>
                </div>
              </section>

              {/* Daily Trend */}
              <section className="glass-strong rounded-3xl p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Trend</p>
                <h3 className="font-display mt-1 text-2xl text-foreground">Daily Sales</h3>
                {salesData.daily_trend.length > 0 ? (
                  <div className="mt-4 h-40">
                    <MiniBarChart
                      data={salesData.daily_trend.map((d) => ({
                        label: d.date,
                        value: d.revenue,
                      }))}
                      color="#E85D3A"
                    />
                  </div>
                ) : (
                  <div className="mt-8 flex flex-col items-center justify-center py-6 text-center">
                    <BarChart3 className="mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No sales data for this period</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Data will appear here once orders are placed
                    </p>
                  </div>
                )}
              </section>

              {/* Top Items */}
              <section className="glass-strong rounded-3xl p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Items</p>
                <h3 className="font-display mt-1 text-2xl text-foreground">Top Selling Items</h3>
                {salesData.top_items.length > 0 ? (
                  <ul className="mt-4 space-y-2">
                    {salesData.top_items.slice(0, 10).map((item, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-2xl bg-mist px-4 py-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-background text-xs font-medium text-muted-foreground">
                          {i + 1}
                        </span>
                        <span className="flex-1 truncate text-sm text-foreground">{item.name}</span>
                        <span className="text-xs text-muted-foreground">{item.quantity_sold}×</span>
                        <span className="font-display text-sm font-medium text-foreground">
                          {fmt(item.revenue, sym)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-6 flex flex-col items-center justify-center py-4 text-center">
                    <ShoppingCart className="mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No item data for this period</p>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── PAYMENTS TAB ────────────────────────────────────────────── */}
          {activeTab === "payments" && paymentData && (
            <div className="space-y-6">
              {/* Cash vs Online */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="glass-strong rounded-3xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Banknote className="h-4 w-4 text-emerald-600" />
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cash</p>
                  </div>
                  <div className="space-y-3">
                    <StatRow label="Transactions" value={String(paymentData.cash.count)} />
                    <StatRow label="Total Collected" value={fmt(paymentData.cash.amount, sym)} />
                    <StatRow label="Average Transaction" value={fmt(paymentData.cash.average, sym, 2)} />
                    <StatRow label="% of Total Sales" value={`${paymentData.cash.percentage}%`} />
                    <StatRow label="Refunds" value={fmt(paymentData.cash.refunds, sym)} hint="subtracted" />
                    <StatRow label="Net Cash" value={fmt(paymentData.cash.net, sym)} bold />
                  </div>
                </div>
                <div className="glass-strong rounded-3xl p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="h-4 w-4 text-sky-600" />
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Online</p>
                  </div>
                  <div className="space-y-3">
                    <StatRow label="Transactions" value={String(paymentData.online.count)} />
                    <StatRow label="Total Collected" value={fmt(paymentData.online.amount, sym)} />
                    <StatRow label="Average Transaction" value={fmt(paymentData.online.average, sym, 2)} />
                    <StatRow label="% of Total Sales" value={`${paymentData.online.percentage}%`} />
                    <StatRow label="Refunds" value={fmt(paymentData.online.refunds, sym)} hint="subtracted" />
                    <StatRow label="Net Online" value={fmt(paymentData.online.net, sym)} bold />
                  </div>
                </div>
              </section>

              {/* Payment Method Breakdown */}
              <section className="glass-strong rounded-3xl p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Breakdown</p>
                <h3 className="font-display mt-1 text-2xl text-foreground">Payment Methods</h3>
                {paymentData.methods.length === 0 ? (
                  <p className="mt-5 text-sm text-muted-foreground">No payment data yet.</p>
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="pb-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Method
                          </th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Transactions
                          </th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Amount
                          </th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            %
                          </th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Refunds
                          </th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                            Net
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentData.methods.map((pm) => (
                          <tr key={pm.method} className="border-b border-border/50">
                            <td className="py-3 font-medium capitalize text-foreground">
                              {pm.method.replace(/_/g, " ")}
                            </td>
                            <td className="py-3 text-right text-muted-foreground">{pm.count}</td>
                            <td className="py-3 text-right font-medium text-foreground">
                              {fmt(pm.amount, sym)}
                            </td>
                            <td className="py-3 text-right text-muted-foreground">{pm.percentage}%</td>
                            <td className="py-3 text-right text-rose-500">{fmt(pm.refunds ?? 0, sym)}</td>
                            <td className="py-3 text-right font-medium text-foreground">
                              {fmt(pm.net ?? pm.amount, sym)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ── TAX TAB ──────────────────────────────────────────────────── */}
          {activeTab === "tax" && taxSum && (
            <div className="space-y-6">
              <section className="glass-strong rounded-3xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tax Summary</p>
                    <h3 className="font-display mt-1 text-2xl text-foreground">
                      {taxLabel} {taxSum.tax_rate}%
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      taxSum.tax_enabled
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {taxSum.tax_enabled ? "Enabled" : "Disabled"}
                  </span>
                </div>

                <div className="space-y-3">
                  <StatRow label="Taxable Sales" value={fmt(taxSum.taxable_sales, sym)} />
                  <StatRow label="Non-Taxable Sales" value={fmt(taxSum.nontaxable_sales, sym)} />
                  <StatRow label="Sales Before Tax" value={fmt(taxSum.sales_excluding_tax, sym)} />
                  <StatRow label="Tax Collected" value={fmt(taxSum.tax_collected, sym)} bold />
                  <StatRow label="Sales Including Tax" value={fmt(taxSum.sales_with_tax, sym)} />
                  <StatRow label="Refund Tax" value={fmt(taxSum.refund_tax, sym)} hint="returned" />
                  <StatRow label="Net Tax Collected" value={fmt(taxSum.net_tax, sym)} bold />
                </div>
              </section>

              {/* With Tax / Without Tax Toggle */}
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="glass-strong rounded-3xl p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
                    With Tax
                  </p>
                  <div className="space-y-2">
                    <StatRow label="Gross Sales" value={fmt(ov?.total_sales, sym)} />
                    <StatRow label="Tax" value={fmt(taxSum.tax_collected, sym)} />
                    <StatRow label="Total" value={fmt(taxSum.sales_with_tax, sym)} bold />
                  </div>
                </div>
                <div className="glass-strong rounded-3xl p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
                    Without Tax
                  </p>
                  <div className="space-y-2">
                    <StatRow label="Sales Excl. Tax" value={fmt(taxSum.sales_excluding_tax, sym)} />
                    <StatRow label="Discounts" value={fmt(ov?.total_discount, sym)} />
                    <StatRow label="Net" value={fmt(ov?.net_sales, sym)} bold />
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* ── ITEMS TAB ───────────────────────────────────────────────── */}
          {activeTab === "items" && salesData && (
            <div className="space-y-6">
              {/* Items table */}
              <section className="glass-strong rounded-3xl p-6">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Item Analytics</p>
                <h3 className="font-display mt-1 text-2xl text-foreground">Items Sold</h3>
                {salesData.top_items.length === 0 ? (
                  <p className="mt-5 text-sm text-muted-foreground">No item data yet.</p>
                ) : (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="pb-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">#</th>
                          <th className="pb-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Item</th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Qty Sold</th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Revenue</th>
                          <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Orders</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesData.top_items.map((item, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-3 text-muted-foreground">{i + 1}</td>
                            <td className="py-3 font-medium text-foreground">{item.name}</td>
                            <td className="py-3 text-right text-muted-foreground">{item.quantity_sold}</td>
                            <td className="py-3 text-right font-medium text-foreground">{fmt(item.revenue, sym)}</td>
                            <td className="py-3 text-right text-muted-foreground">{item.order_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Categories */}
              {salesData.categories.length > 0 && (
                <section className="glass-strong rounded-3xl p-6">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Categories</p>
                  <h3 className="font-display mt-1 text-2xl text-foreground">Revenue by Category</h3>
                  <div className="mt-5 space-y-3">
                    {salesData.categories.map((cat, i) => {
                      const maxRev = Math.max(...salesData.categories.map((c) => c.revenue), 1);
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-foreground">{cat.name}</span>
                            <span className="font-medium text-foreground">{fmt(cat.revenue, sym)}</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-mist">
                            <div
                              className="h-full rounded-full bg-ink"
                              style={{ width: `${(cat.revenue / maxRev) * 100}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── FISCAL TAB ──────────────────────────────────────────────── */}
          {activeTab === "fiscal" && (
            <FiscalTab dateFrom={dateRange.dateFrom} dateTo={dateRange.dateTo} sym={sym} />
          )}
        </>
      )}
    </div>
  );
}

// ── Fiscal Tab (lazy-loaded) ───────────────────────────────────────────────

function FiscalTab({
  dateFrom,
  dateTo,
  sym,
}: {
  dateFrom: string;
  dateTo: string;
  sym: string;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reportsApi
      .fiscal({ date_from: dateFrom, date_to: dateTo })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const fs = data.fiscal_summary;
  const pb = data.payment_breakdown;
  const cs = data.cash_summary;
  const os = data.online_summary;

  return (
    <div className="space-y-6">
      {/* Core Fiscal */}
      <section className="glass-strong rounded-3xl p-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Fiscal Summary</p>
        <h3 className="font-display mt-1 text-2xl text-foreground">
          {fs.tax_label} {fs.tax_rate}%
        </h3>
        <div className="mt-4 space-y-3">
          <StatRow label="Gross Sales" value={fmt(fs.gross_sales, sym)} />
          <StatRow label="Net Sales" value={fmt(fs.net_sales, sym)} />
          <StatRow label="Sales Before Tax" value={fmt(fs.sales_before_tax, sym)} />
          <StatRow label="Taxable Sales" value={fmt(fs.taxable_sales, sym)} />
          <StatRow label="Tax Collected" value={fmt(fs.tax_collected, sym)} bold />
          <StatRow label="Discounts" value={fmt(fs.discounts, sym)} hint="applied" />
          <StatRow label="Sales Including Tax" value={fmt(fs.sales_including_tax, sym)} />
          <StatRow label="Sales Excluding Tax" value={fmt(fs.sales_excluding_tax, sym)} />
          <StatRow label="Refunds" value={fmt(fs.refunds, sym)} hint={`${fs.refund_count} orders`} />
          <StatRow label="Cancelled / Voided" value={fmt(fs.cancelled_amount, sym)} hint={`${fs.cancelled_orders} orders`} />
          <StatRow label="Total Transactions" value={String(fs.total_transactions)} />
          <StatRow label="Average Order" value={fmt(fs.avg_order_value, sym, 2)} />
        </div>
      </section>

      {/* Payment Breakdown */}
      <section className="glass-strong rounded-3xl p-6">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Payment Collections</p>
        <h3 className="font-display mt-1 text-2xl text-foreground">Cash & Online Breakdown</h3>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-3 text-left text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Method</th>
                <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Amount</th>
                <th className="pb-3 text-right text-[10px] uppercase tracking-wider text-muted-foreground font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50 font-medium">
                <td className="py-3 text-foreground">Cash</td>
                <td className="py-3 text-right text-foreground">{fmt(pb.cash, sym)}</td>
                <td className="py-3 text-right text-muted-foreground">
                  {fs.gross_sales > 0 ? ((pb.cash / fs.gross_sales) * 100).toFixed(1) : 0}%
                </td>
              </tr>
              {pb.methods.map((m: any) => (
                <tr key={m.method} className="border-b border-border/50">
                  <td className="py-3 capitalize text-foreground">{m.method.replace(/_/g, " ")}</td>
                  <td className="py-3 text-right text-foreground">{fmt(m.amount, sym)}</td>
                  <td className="py-3 text-right text-muted-foreground">{m.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cash & Online Summaries */}
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Cash Summary</p>
          <div className="space-y-2">
            <StatRow label="Cash Sales" value={fmt(cs.cash_sales, sym)} />
            <StatRow label="Cash Refunds" value={fmt(cs.cash_refunds, sym)} />
            <StatRow label="Net Cash" value={fmt(cs.net_cash, sym)} bold />
            <StatRow label="Pay-ins" value={fmt(cs.payins, sym)} />
            <StatRow label="Pay-outs" value={fmt(cs.payouts, sym)} />
            <StatRow label="Cash Drops" value={fmt(cs.cash_drops, sym)} />
          </div>
        </div>
        <div className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">Online Summary</p>
          <div className="space-y-2">
            <StatRow label="Online Sales" value={fmt(os.online_sales, sym)} />
            <StatRow label="Online Refunds" value={fmt(os.online_refunds, sym)} />
            <StatRow label="Net Online" value={fmt(os.net_online, sym)} bold />
            <StatRow label="Card" value={fmt(os.card, sym)} />
            <StatRow label="QR" value={fmt(os.bank_qr, sym)} />
            <StatRow label="Mobile Wallet" value={fmt(os.mobile_wallet, sym)} />
          </div>
        </div>
      </section>

      {/* Daily Trend */}
      {data.daily_trend.length > 0 && (
        <section className="glass-strong rounded-3xl p-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Trend</p>
          <h3 className="font-display mt-1 text-2xl text-foreground">Daily Fiscal Trend</h3>
          <div className="mt-4 h-40">
            <MiniBarChart
              data={data.daily_trend.map((d: any) => ({ label: d.date, value: d.revenue }))}
              color="#E85D3A"
            />
          </div>
        </section>
      )}
    </div>
  );
}

// ── Shared Components ───────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
}) {
  return (
    <div className="glass-strong rounded-3xl p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="numeric mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function StatRow({
  label,
  value,
  hint,
  bold,
}: {
  label: string;
  value: string;
  hint?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-2.5">
      <div>
        <p className={`text-sm ${bold ? "font-medium" : ""} text-foreground`}>{label}</p>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <p className={`numeric text-sm ${bold ? "font-bold" : "font-medium"} text-foreground`}>{value}</p>
    </div>
  );
}

function MiniBarChart({
  data,
  color = "#E85D3A",
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(100 / data.length - 1, 2);

  return (
    <div className="flex h-full items-end gap-px">
      {data.map((d, i) => {
        const height = d.value > 0 ? Math.max((d.value / max) * 100, 5) : 2;
        const dateLabel = new Date(`${d.label}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <div
            key={i}
            className="group flex flex-1 flex-col items-center justify-end"
            title={`${dateLabel}: ${d.value.toLocaleString()}`}
          >
            <div
              className="w-full rounded-t transition-opacity group-hover:opacity-100"
              style={{
                height: `${height}%`,
                backgroundColor: color,
                opacity: 0.35 + (i / data.length) * 0.65,
                minWidth: 4,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
