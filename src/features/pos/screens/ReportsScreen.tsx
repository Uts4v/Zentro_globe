import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore } from "../store";
import { posListOrders, posListDebitAccounts, PosOrder, DebitAccount } from "../api";
import { formatCurrency } from "@/lib/currency";
import {
  BarChart3,
  TrendingUp,
  ShoppingBag,
  DollarSign,
  Wallet,
  CreditCard,
  RefreshCw,
  Loader2,
  FileText,
  Users,
} from "lucide-react";

export default function ReportsScreen() {
  const activeShift = usePosStore((s) => s.activeShift);
  const merchant = usePosStore((s) => s.merchant);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [debitAccounts, setDebitAccounts] = useState<DebitAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [ordersData, accountsData] = await Promise.all([
        posListOrders(),
        posListDebitAccounts().catch(() => []),
      ]);
      setOrders(ordersData);
      setDebitAccounts(accountsData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Compute stats
  const today = new Date().toISOString().split("T")[0];
  const todayOrders = orders.filter((o) => o.created_at.startsWith(today));
  const completedOrders = todayOrders.filter((o) => o.status === "completed");
  const totalRevenue = completedOrders.reduce(
    (sum, o) => sum + Number(o.total_amount),
    0
  );
  const avgOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;
  const totalDebitBalance = debitAccounts.reduce(
    (sum, a) => sum + Number(a.balance),
    0
  );

  const stats = [
    {
      label: "Today's Orders",
      value: todayOrders.length,
      icon: ShoppingBag,
      color: "bg-blue-100 text-blue-600",
    },
    {
      label: "Revenue",
      value: formatCurrency(totalRevenue, currencySymbol),
      icon: DollarSign,
      color: "bg-green-100 text-green-600",
    },
    {
      label: "Avg Order",
      value: formatCurrency(avgOrderValue, currencySymbol),
      icon: TrendingUp,
      color: "bg-purple-100 text-purple-600",
    },
    {
      label: "Debit Balances",
      value: formatCurrency(totalDebitBalance, currencySymbol),
      icon: Wallet,
      color: "bg-amber-100 text-amber-600",
    },
  ];

  // Payment method breakdown
  const paymentBreakdown: Record<string, number> = {};
  completedOrders.forEach((o) => {
    const method = o.payment_method || "unknown";
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) + Number(o.total_amount);
  });

  // Status breakdown
  const statusBreakdown: Record<string, number> = {};
  todayOrders.forEach((o) => {
    statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
  });

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-ink" />
          <h1 className="text-xl font-bold text-foreground">Reports</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/pos/reports/z-report"
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <FileText className="h-4 w-4" />
            Z-Report
          </Link>
          <Link
            to="/pos/staff-report"
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Users className="h-4 w-4" />
            Staff Report
          </Link>
          <button
            onClick={loadData}
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Shift info */}
      {activeShift && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-bold uppercase text-muted-foreground">
            Current Shift
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[10px] text-muted-foreground">Opening</p>
              <p className="text-sm font-bold">
                {formatCurrency(Number(activeShift.opening_cash), currencySymbol)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Cash Sales</p>
              <p className="text-sm font-bold text-green-600">
                {formatCurrency(Number(activeShift.total_cash_sales), currencySymbol)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Card Sales</p>
              <p className="text-sm font-bold text-blue-600">
                {formatCurrency(Number(activeShift.total_card_sales), currencySymbol)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Orders</p>
              <p className="text-sm font-bold">{activeShift.total_orders}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl border border-border bg-card p-4">
              <div className={`mb-2 grid h-8 w-8 place-items-center rounded-lg ${stat.color}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-lg font-bold text-foreground">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Payment breakdown */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">
            Payment Methods
          </h2>
          {Object.keys(paymentBreakdown).length === 0 ? (
            <p className="text-sm text-muted-foreground">No data</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(paymentBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([method, amount]) => {
                  const pct = totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0;
                  return (
                    <div key={method}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize text-foreground">
                          {method.replace("_", " ")}
                        </span>
                        <span className="font-medium">{formatCurrency(amount, currencySymbol)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-ink"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Status breakdown */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">
            Order Status
          </h2>
          {Object.keys(statusBreakdown).length === 0 ? (
            <p className="text-sm text-muted-foreground">No data</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(statusBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div
                    key={status}
                    className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-2.5"
                  >
                    <span className="text-sm capitalize text-foreground">
                      {status}
                    </span>
                    <span className="text-sm font-bold text-ink">{count}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
