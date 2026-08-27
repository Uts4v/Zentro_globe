import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  posStaffDailyReport,
  posListWorkers,
  PosStaffDailyReportData,
  ShiftWorker,
} from "../api";
import {
  Users,
  Loader2,
  RefreshCw,
  Calendar,
  DollarSign,
  ShoppingCart,
  Package,
  TrendingUp,
  ArrowDown,
} from "lucide-react";

export default function StaffDailyReportScreen() {
  const merchant = usePosStore((s) => s.merchant);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get("date") || undefined;
  const workerIdParam = params.get("worker_id") || undefined;

  const [data, setData] = useState<PosStaffDailyReportData | null>(null);
  const [workers, setWorkers] = useState<ShiftWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState(
    dateParam || new Date().toISOString().split("T")[0]
  );
  const [workerFilter, setWorkerFilter] = useState<string>(workerIdParam || "");

  useEffect(() => {
    loadWorkers();
  }, []);

  useEffect(() => {
    loadReport();
  }, [dateFilter, workerFilter]);

  async function loadWorkers() {
    try {
      const data = await posListWorkers();
      setWorkers(data);
    } catch {
      // ignore
    }
  }

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params: { date?: string; worker_id?: string } = {};
      if (dateFilter) params.date = dateFilter;
      if (workerFilter) params.worker_id = workerFilter;
      const result = await posStaffDailyReport(params);
      setData(result);
    } catch (err: any) {
      setError(err?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={loadReport}
          className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-ink" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Staff Daily Report</h1>
            <p className="text-xs text-muted-foreground">
              Performance breakdown by staff member
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          />
          <select
            value={workerFilter}
            onChange={(e) => setWorkerFilter(e.target.value)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">All Staff</option>
            {workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name}
              </option>
            ))}
          </select>
          <button
            onClick={loadReport}
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {data && (
        <>
          {/* Summary Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Total Revenue"
              value={formatCurrency(data.totals.total_revenue, currencySymbol)}
              icon={DollarSign}
              color="bg-green-100 text-green-600"
            />
            <StatCard
              label="Total Orders"
              value={String(data.totals.total_orders)}
              icon={ShoppingCart}
              color="bg-blue-100 text-blue-600"
            />
            <StatCard
              label="Items Sold"
              value={String(data.totals.total_items_sold)}
              icon={Package}
              color="bg-purple-100 text-purple-600"
            />
            <StatCard
              label="Discounts"
              value={formatCurrency(data.totals.total_discount, currencySymbol)}
              icon={ArrowDown}
              color="bg-amber-100 text-amber-600"
            />
          </div>

          {/* Staff Table */}
          {data.staff.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-muted-foreground">
              <Users className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">No staff activity for this date</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-bold uppercase text-muted-foreground">
                      <th className="p-4">Staff</th>
                      <th className="p-4 text-right">Orders</th>
                      <th className="p-4 text-right">Items</th>
                      <th className="p-4 text-right">Revenue</th>
                      <th className="hidden p-4 text-right sm:table-cell">Cash</th>
                      <th className="hidden p-4 text-right sm:table-cell">Card</th>
                      <th className="hidden p-4 text-right sm:table-cell">Credit</th>
                      <th className="hidden p-4 text-right sm:table-cell">Discount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staff.map((s, i) => {
                      const avgOrder =
                        s.order_count > 0
                          ? Number(s.total_revenue) / s.order_count
                          : 0;
                      const revPct =
                        Number(data.totals.total_revenue) > 0
                          ? (Number(s.total_revenue) /
                              Number(data.totals.total_revenue)) *
                            100
                          : 0;
                      return (
                        <tr
                          key={s.worker_id}
                          className="border-b border-border/50 last:border-0"
                        >
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="grid h-9 w-9 place-items-center rounded-full bg-ink text-xs font-bold text-white">
                                {s.worker_name?.charAt(0) || "?"}
                              </div>
                              <div>
                                <p className="font-medium text-foreground">
                                  {s.worker_name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {s.payment_count} payment{s.payment_count !== 1 ? "s" : ""} ·{" "}
                                  {revPct.toFixed(1)}% of revenue
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right font-medium">
                            {s.order_count}
                          </td>
                          <td className="p-4 text-right font-medium">
                            {s.items_sold}
                          </td>
                          <td className="p-4 text-right font-bold text-foreground">
                            {formatCurrency(s.total_revenue, currencySymbol)}
                          </td>
                          <td className="hidden p-4 text-right text-green-600 sm:table-cell">
                            {formatCurrency(s.cash_amount, currencySymbol)}
                          </td>
                          <td className="hidden p-4 text-right text-blue-600 sm:table-cell">
                            {formatCurrency(s.card_amount, currencySymbol)}
                          </td>
                          <td className="hidden p-4 text-right text-amber-600 sm:table-cell">
                            {formatCurrency(s.credit_amount, currencySymbol)}
                          </td>
                          <td className="hidden p-4 text-right text-muted-foreground sm:table-cell">
                            {formatCurrency(s.total_discount, currencySymbol)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-bold">
                      <td className="p-4 text-foreground">TOTAL</td>
                      <td className="p-4 text-right">{data.totals.total_orders}</td>
                      <td className="p-4 text-right">{data.totals.total_items_sold}</td>
                      <td className="p-4 text-right text-foreground">
                        {formatCurrency(data.totals.total_revenue, currencySymbol)}
                      </td>
                      <td className="hidden p-4 text-right sm:table-cell">
                        {formatCurrency(
                          data.staff.reduce((s, w) => s + Number(w.cash_amount), 0),
                          currencySymbol
                        )}
                      </td>
                      <td className="hidden p-4 text-right sm:table-cell">
                        {formatCurrency(
                          data.staff.reduce((s, w) => s + Number(w.card_amount), 0),
                          currencySymbol
                        )}
                      </td>
                      <td className="hidden p-4 text-right sm:table-cell">
                        {formatCurrency(
                          data.staff.reduce((s, w) => s + Number(w.credit_amount), 0),
                          currencySymbol
                        )}
                      </td>
                      <td className="hidden p-4 text-right sm:table-cell">
                        {formatCurrency(data.totals.total_discount, currencySymbol)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Per-staff detail cards (mobile) */}
          <div className="mt-6 space-y-3 sm:hidden">
            {data.staff.map((s) => (
              <div
                key={s.worker_id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-ink text-sm font-bold text-white">
                    {s.worker_name?.charAt(0) || "?"}
                  </div>
                  <div>
                    <p className="font-bold text-foreground">{s.worker_name}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.order_count} orders · {s.items_sold} items
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-lg font-bold text-foreground">
                      {formatCurrency(s.total_revenue, currencySymbol)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">revenue</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-green-50 p-2 text-center">
                    <p className="font-bold text-green-700">
                      {formatCurrency(s.cash_amount, currencySymbol)}
                    </p>
                    <p className="text-green-600">Cash</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 p-2 text-center">
                    <p className="font-bold text-blue-700">
                      {formatCurrency(s.card_amount, currencySymbol)}
                    </p>
                    <p className="text-blue-600">Card</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-2 text-center">
                    <p className="font-bold text-amber-700">
                      {formatCurrency(s.credit_amount, currencySymbol)}
                    </p>
                    <p className="text-amber-600">Credit</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: any;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className={`mb-2 grid h-8 w-8 place-items-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
