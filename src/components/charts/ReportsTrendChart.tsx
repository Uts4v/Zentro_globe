import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { CustomChartTooltip } from "./ChartTooltip";
import { TrendingUp, Receipt, Percent } from "lucide-react";

export interface ReportTrendPoint {
  date: string;
  revenue: number;
  orders?: number;
  tax?: number;
  discount?: number;
  subtotal?: number;
}

interface ReportsTrendChartProps {
  data: ReportTrendPoint[];
  currencySymbol?: string;
  color?: string;
  title?: string;
}

export function ReportsTrendChart({
  data,
  currencySymbol = "Rs",
  color = "#E85D3A",
  title = "Sales Trend",
}: ReportsTrendChartProps) {
  const [viewMetric, setViewMetric] = useState<"sales" | "orders" | "tax">("sales");

  const hasTaxOrDiscount = data.some(
    (d) => (d.tax ?? 0) > 0 || (d.discount ?? 0) > 0
  );
  const totalSales = data.reduce((acc, d) => acc + (d.revenue || 0), 0);
  const totalOrders = data.reduce((acc, d) => acc + (d.orders || 0), 0);
  const hasData = data.some((d) => (d.revenue || 0) > 0 || (d.orders || 0) > 0);

  const formattedData = data.map((d) => {
    let displayDate = d.date;
    try {
      displayDate = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      displayDate = d.date;
    }
    return {
      ...d,
      displayDate,
      revenue: Number(d.revenue || 0),
      orders: Number(d.orders || 0),
      tax: Number(d.tax || 0),
      discount: Number(d.discount || 0),
    };
  });

  const n = formattedData.length;
  let tickInterval = 0;
  if (n > 60) tickInterval = 9;
  else if (n > 30) tickInterval = 4;
  else if (n > 14) tickInterval = 2;
  else if (n > 7) tickInterval = 1;
  else tickInterval = 0;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-1 rounded-full bg-mist p-1 text-xs">
          <button
            onClick={() => setViewMetric("sales")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
              viewMetric === "sales"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <TrendingUp className="h-3 w-3 text-ember" />
            Revenue ({currencySymbol} {totalSales.toLocaleString()})
          </button>
          <button
            onClick={() => setViewMetric("orders")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
              viewMetric === "orders"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <Receipt className="h-3 w-3 text-sky-600" />
            Orders ({totalOrders})
          </button>
          {hasTaxOrDiscount && (
            <button
              onClick={() => setViewMetric("tax")}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
                viewMetric === "tax"
                  ? "bg-card text-ink shadow-sm"
                  : "text-muted-foreground hover:text-ink"
              }`}
            >
              <Percent className="h-3 w-3 text-emerald-600" />
              Tax & Discounts
            </button>
          )}
        </div>

        <span className="text-[11px] text-muted-foreground">
          {n} {n === 1 ? "day" : "days"} period
        </span>
      </div>

      {/* Chart Canvas */}
      {!hasData ? (
        <div className="flex h-52 flex-col items-center justify-center rounded-2xl bg-mist/30 text-center text-sm text-muted-foreground">
          <TrendingUp className="mb-2 h-7 w-7 text-muted-foreground/40" />
          <p className="font-medium text-foreground">No transaction data in this period</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Sales and tax metrics will plot here once customer orders or POS receipts are generated.
          </p>
        </div>
      ) : (
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={formattedData}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <defs>
                <linearGradient id="reports-rev-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.45" />
                  <stop offset="95%" stopColor={color} stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="reports-tax-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10B981" stopOpacity="0.4" />
                  <stop offset="95%" stopColor="#10B981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                className="text-border/30"
              />

              <XAxis
                dataKey="displayDate"
                interval={tickInterval}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted-foreground"
              />

              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted-foreground"
                tickFormatter={(val) =>
                  viewMetric === "orders"
                    ? `${val}`
                    : val >= 1000
                    ? `${currencySymbol} ${(val / 1000).toFixed(0)}k`
                    : `${currencySymbol} ${val}`
                }
              />

              <Tooltip content={<CustomChartTooltip currencySymbol={currencySymbol} />} />

              {viewMetric === "sales" && (
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Sales Revenue"
                  stroke={color}
                  strokeWidth={2.5}
                  fill="url(#reports-rev-grad)"
                  dot={formattedData.length <= 15 ? { r: 3, fill: color, strokeWidth: 0 } : false}
                  activeDot={{ r: 6, fill: color, stroke: "#FFFFFF", strokeWidth: 2 }}
                />
              )}

              {viewMetric === "orders" && (
                <Bar
                  dataKey="orders"
                  name="Orders"
                  fill="#0284C7"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={formattedData.length === 1 ? 50 : 32}
                />
              )}

              {viewMetric === "tax" && (
                <>
                  <Bar
                    dataKey="tax"
                    name="Tax Collected"
                    fill="#10B981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="discount"
                    name="Discounts"
                    fill="#F59E0B"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
