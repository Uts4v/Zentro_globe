import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posZReport, PosZReportData } from "../api";
import {
  FileText,
  Printer,
  Download,
  RefreshCw,
  Loader2,
  AlertCircle,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  ArrowDown,
  ArrowUp,
  Users,
} from "lucide-react";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_qr: "Bank QR",
  mobile_wallet: "Mobile Wallet",
  credit: "Credit",
  split: "Split",
  other: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export default function ZReportScreen() {
  const merchant = usePosStore((s) => s.merchant);
  const activeShift = usePosStore((s) => s.activeShift);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  const params = new URLSearchParams(window.location.search);
  const shiftIdParam = params.get("shift_id") || undefined;
  const dateParam = params.get("date") || undefined;

  const [data, setData] = useState<PosZReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>(
    dateParam || new Date().toISOString().split("T")[0]
  );

  useEffect(() => {
    loadReport();
  }, [activeShift?.id, shiftIdParam, dateParam]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const query: { shift_id?: string; date?: string } = {};
      if (shiftIdParam) {
        query.shift_id = shiftIdParam;
      } else if (dateParam) {
        query.date = dateParam;
      } else if (dateFilter) {
        query.date = dateFilter;
      }
      const result = await posZReport(query);
      setData(result);
    } catch (err: any) {
      setError(err?.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const el = document.getElementById("z-report-content");
    if (!el) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Z-Report — ${data?.report_label || ""}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 12px; color: #000; padding: 16px; max-width: 80mm; margin: 0 auto; }
          .line { border-top: 1px dashed #999; margin: 8px 0; }
          .bold { font-weight: bold; }
          .center { text-align: center; }
          .right { text-align: right; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; }
          h2 { font-size: 14px; text-align: center; margin: 8px 0 4px; }
          h3 { font-size: 12px; margin: 6px 0 3px; }
          .section { margin: 6px 0; }
          @media print {
            body { padding: 0; max-width: 100%; }
            @page { size: 80mm auto; margin: 4mm; }
          }
        </style>
      </head>
      <body>
        ${el.innerHTML}
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 300);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => loadReport()}
          className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const revenue = Number(data.total_revenue);
  const avgOrder = data.total_orders > 0 ? revenue / data.total_orders : 0;
  const cashDiff = Number(data.cash_summary.total_difference);
  const hasCashDifference = cashDiff !== 0;

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-ink" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Z-Report</h1>
            <p className="text-xs text-muted-foreground">
              {data.report_label} &middot; {data.merchant.name}
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
          <button
            onClick={() => loadReport()}
            className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      {/* Printable content */}
      <div id="z-report-content">
        {/* Merchant header (for print) */}
        <div className="mb-6 text-center" style={{ display: "none" }}>
          <h2 className="text-lg font-bold">{data.merchant.name}</h2>
          <p className="text-xs">{data.merchant.address}</p>
          <p className="text-xs">{data.merchant.phone}</p>
          <div className="my-2 border-t border-dashed border-gray-400" />
        </div>

        {/* Stats grid */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total Orders"
            value={String(data.total_orders)}
            icon={ShoppingCart}
            color="bg-blue-100 text-blue-600"
          />
          <StatCard
            label="Revenue"
            value={formatCurrency(revenue, currencySymbol)}
            icon={DollarSign}
            color="bg-green-100 text-green-600"
          />
          <StatCard
            label="Avg Order"
            value={formatCurrency(avgOrder, currencySymbol)}
            icon={TrendingUp}
            color="bg-purple-100 text-purple-600"
          />
          <StatCard
            label="Discounts"
            value={formatCurrency(data.total_discounts_value, currencySymbol)}
            icon={ArrowDown}
            color="bg-amber-100 text-amber-600"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Cash Summary */}
          <Card title="Cash Summary">
            <Row label="Opening Cash" value={formatCurrency(data.cash_summary.total_cash_in, currencySymbol)} />
            <Row label="Cash Sales" value={formatCurrency(data.shifts.reduce((s, sh) => s + Number(sh.total_cash_sales), 0), currencySymbol)} />
            <Row label="Change Given" value={`- ${formatCurrency(data.cash_summary.total_cash_out_change, currencySymbol)}`} accent />
            <div className="my-2 border-t border-border" />
            <Row label="Expected in Drawer" value={formatCurrency(data.cash_summary.total_expected_cash, currencySymbol)} bold />
            <Row label="Actual Closing" value={formatCurrency(data.cash_summary.total_actual_cash, currencySymbol)} bold />
            {hasCashDifference && (
              <div className={`mt-2 rounded-xl px-3 py-2 text-sm font-bold ${
                cashDiff > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}>
                {cashDiff > 0 ? "+" : ""} {formatCurrency(cashDiff, currencySymbol)} {cashDiff > 0 ? "Over" : "Short"}
              </div>
            )}
          </Card>

          {/* Payment Methods */}
          <Card title="Payment Methods">
            {data.payment_methods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments</p>
            ) : (
              data.payment_methods.map((pm) => {
                const pct = revenue > 0 ? (Number(pm.amount) / revenue) * 100 : 0;
                return (
                  <div key={pm.method} className="mb-3">
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-foreground">{METHOD_LABELS[pm.method] || pm.method}</span>
                      <span className="font-medium">{formatCurrency(pm.amount, currencySymbol)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-ink"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {pm.count} payment{pm.count !== 1 ? "s" : ""} &middot; {pct.toFixed(1)}%
                    </p>
                  </div>
                );
              })
            )}
          </Card>

          {/* Order Status */}
          <Card title="Order Status">
            {data.order_status_breakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders</p>
            ) : (
              <div className="space-y-2">
                {data.order_status_breakdown.map((s) => (
                  <div
                    key={s.status}
                    className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-2.5"
                  >
                    <span className="text-sm capitalize">{STATUS_LABELS[s.status] || s.status}</span>
                    <span className="text-sm font-bold text-ink">{s.count}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Top Selling Items */}
          <Card title="Top Selling Items">
            {data.top_selling_items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items sold</p>
            ) : (
              <div className="space-y-2">
                {data.top_selling_items.slice(0, 8).map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-2">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.quantity_sold} sold
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-bold">{formatCurrency(item.revenue, currencySymbol)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Bottom row */}
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {/* Credit Summary */}
          <Card title="Credit Accounts">
            <Row label="Credit Sales" value={formatCurrency(data.credit_summary.sales, currencySymbol)} />
            <Row label="Repayments" value={formatCurrency(data.credit_summary.repayments, currencySymbol)} accent />
            <div className="my-2 border-t border-border" />
            <Row
              label="Net"
              value={formatCurrency(Number(data.credit_summary.sales) - Number(data.credit_summary.repayments), currencySymbol)}
              bold
            />
          </Card>

          {/* Debit Summary */}
          <Card title="Debit (Wallet) Accounts">
            <Row label="Purchases" value={formatCurrency(data.debit_summary.purchases, currencySymbol)} />
            <Row label="Top-ups" value={formatCurrency(data.debit_summary.topups, currencySymbol)} accent />
            <div className="my-2 border-t border-border" />
            <Row
              label="Net"
              value={formatCurrency(Number(data.debit_summary.purchases) - Number(data.debit_summary.topups), currencySymbol)}
              bold
            />
          </Card>

          {/* Refunds */}
          <Card title="Refunds">
            <Row label="Refund Count" value={String(data.refund_count)} />
            <Row label="Refund Total" value={formatCurrency(data.refund_total, currencySymbol)} bold />
          </Card>
        </div>

        {/* Cash Payouts / Pay-ins */}
        {(Number(data.cash_summary.total_payouts) > 0 || Number(data.cash_summary.total_payins) > 0) && (
          <div className="mt-6">
            <Card title="Cash Movements">
              <Row
                label="Pay-outs (Cash removed)"
                value={`- ${formatCurrency(data.cash_summary.total_payouts, currencySymbol)}`}
                accent
              />
              <Row
                label="Pay-ins (Cash added)"
                value={`+ ${formatCurrency(data.cash_summary.total_payins, currencySymbol)}`}
              />
            </Card>
          </div>
        )}

        {/* Per-Staff Breakdown */}
        {data.staff_breakdown.length > 0 && (
          <div className="mt-6">
            <Card title="Staff Performance">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-bold uppercase text-muted-foreground">
                      <th className="pb-2 pr-4">Staff</th>
                      <th className="pb-2 pr-4 text-right">Orders</th>
                      <th className="pb-2 pr-4 text-right">Revenue</th>
                      <th className="hidden pb-2 pr-4 text-right sm:table-cell">Cash</th>
                      <th className="hidden pb-2 text-right sm:table-cell">Card</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.staff_breakdown.map((staff) => (
                      <tr key={staff.worker_id} className="border-b border-border/50 last:border-0">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <div className="grid h-7 w-7 place-items-center rounded-full bg-ink/10 text-[10px] font-bold text-ink">
                              {staff.worker_name?.charAt(0) || "?"}
                            </div>
                            <span className="font-medium text-foreground">{staff.worker_name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-medium">{staff.order_count}</td>
                        <td className="py-2.5 pr-4 text-right font-bold">{formatCurrency(staff.total_revenue, currencySymbol)}</td>
                        <td className="hidden py-2.5 pr-4 text-right text-muted-foreground sm:table-cell">
                          {formatCurrency(staff.cash_amount, currencySymbol)}
                        </td>
                        <td className="hidden py-2.5 text-right text-muted-foreground sm:table-cell">
                          {formatCurrency(staff.card_amount, currencySymbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* Shift Details */}
        {data.shifts.length > 0 && (
          <div className="mt-6">
            <Card title="Shift Details">
              <div className="space-y-4">
                {data.shifts.map((s) => (
                  <div key={s.id} className="rounded-xl bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground">
                        {s.opened_by} → {s.closed_by || "(open)"}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        s.status === "closed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                      }`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Opened:</span>{" "}
                        {s.opened_at ? new Date(s.opened_at).toLocaleTimeString() : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Closed:</span>{" "}
                        {s.closed_at ? new Date(s.closed_at).toLocaleTimeString() : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Opening:</span>{" "}
                        {formatCurrency(s.opening_cash, currencySymbol)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Closing:</span>{" "}
                        {s.closing_cash !== null ? formatCurrency(s.closing_cash, currencySymbol) : "—"}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cash Sales:</span>{" "}
                        {formatCurrency(s.total_cash_sales, currencySymbol)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Expected:</span>{" "}
                        {formatCurrency(s.expected_cash, currencySymbol)}
                      </div>
                      {s.cash_difference !== null && Number(s.cash_difference) !== 0 && (
                        <div className={`col-span-2 rounded-lg px-2 py-1 text-xs font-bold ${
                          Number(s.cash_difference) > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          Difference: {Number(s.cash_difference) > 0 ? "+" : ""} {formatCurrency(s.cash_difference, currencySymbol)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 text-center text-[10px] text-muted-foreground">
          Generated {new Date(data.generated_at).toLocaleString()} &middot; {data.merchant.name}
        </div>
      </div>
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 text-xs font-bold uppercase text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? "font-bold" : ""}`}>
      <span className={accent ? "text-green-600" : "text-foreground"}>{label}</span>
      <span className={accent ? "font-medium text-green-600" : "text-foreground"}>{value}</span>
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
