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
import { TrendingUp, Receipt, Layers, Calendar } from "lucide-react";

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
}

interface AnalyticsTrendChartProps {
  points: DailyPoint[];
  currencySymbol?: string;
  isLoading?: boolean;
}

export function AnalyticsTrendChart({
  points,
  currencySymbol = "Rs",
  isLoading = false,
}: AnalyticsTrendChartProps) {
  const [viewMode, setViewMode] = useState<"both" | "revenue" | "orders">("both");

  const totalRev = points.reduce((s, p) => s + Number(p.revenue || 0), 0);
  const totalOrders = points.reduce((s, p) => s + Number(p.orders || 0), 0);
  const hasData = points.some((p) => Number(p.revenue || 0) > 0 || Number(p.orders || 0) > 0);

  // Format data for chart
  const formattedData = points.map((p) => {
    let displayDate = p.date;
    try {
      displayDate = new Date(`${p.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      displayDate = p.date;
    }
    return {
      date: p.date,
      displayDate,
      revenue: Number(p.revenue || 0),
      orders: Number(p.orders || 0),
    };
  });

  // Calculate reasonable tick interval for XAxis based on data length
  const n = formattedData.length;
  let tickInterval = 0;
  if (n > 60) tickInterval = 9;
  else if (n > 30) tickInterval = 4;
  else if (n > 14) tickInterval = 2;
  else if (n > 7) tickInterval = 1;
  else tickInterval = 0;

  return (
    <div className="space-y-4">
      {/* Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-1 rounded-full bg-mist p-1 text-xs">
          <button
            onClick={() => setViewMode("both")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
              viewMode === "both"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <Layers className="h-3 w-3" />
            Combined
          </button>
          <button
            onClick={() => setViewMode("revenue")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
              viewMode === "revenue"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <TrendingUp className="h-3 w-3 text-ember" />
            Revenue ({currencySymbol} {totalRev.toLocaleString()})
          </button>
          <button
            onClick={() => setViewMode("orders")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-all ${
              viewMode === "orders"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <Receipt className="h-3 w-3 text-sky-600" />
            Orders ({totalOrders})
          </button>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-ember" />
            Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-500/70" />
            Orders
          </span>
        </div>
      </div>

      {/* Chart Body */}
      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink border-t-transparent" />
        </div>
      ) : !hasData ? (
        <div className="flex h-56 flex-col items-center justify-center rounded-2xl bg-mist/30 px-4 text-center">
          <Calendar className="mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="font-display text-base text-foreground">No orders or revenue in this period</p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Try choosing a broader date range such as This Month or This Year from the date selector above.
          </p>
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={formattedData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="analytics-rev-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E85D3A" stopOpacity="0.45" />
                  <stop offset="95%" stopColor="#E85D3A" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="currentColor"
                className="text-border/40"
              />

              <XAxis
                dataKey="displayDate"
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
                tick={{ fontSize: 10, fill: "currentColor" }}
                className="text-muted-foreground"
              />

              {/* Y-Axis Left (Revenue) */}
              {(viewMode === "both" || viewMode === "revenue") && (
                <YAxis
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  className="text-muted-foreground"
                  tickFormatter={(val) =>
                    val >= 1000
                      ? `${currencySymbol} ${(val / 1000).toFixed(0)}k`
                      : `${currencySymbol} ${val}`
                  }
                />
              )}

              {/* Y-Axis Right (Orders) */}
              {(viewMode === "both" || viewMode === "orders") && (
                <YAxis
                  yAxisId="right"
                  orientation={viewMode === "both" ? "right" : "left"}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  className="text-muted-foreground"
                />
              )}

              <Tooltip
                cursor={{ stroke: "#E85D3A", strokeWidth: 1, strokeDasharray: "3 3" }}
                content={<CustomChartTooltip currencySymbol={currencySymbol} />}
              />

              {/* Orders Bars */}
              {(viewMode === "both" || viewMode === "orders") && (
                <Bar
                  yAxisId="right"
                  dataKey="orders"
                  name="Orders"
                  fill="#0284C7"
                  radius={[4, 4, 0, 0]}
                  opacity={0.75}
                  maxBarSize={formattedData.length === 1 ? 50 : 28}
                />
              )}

              {/* Revenue Area & Line */}
              {(viewMode === "both" || viewMode === "revenue") && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#E85D3A"
                  strokeWidth={2.5}
                  fill="url(#analytics-rev-gradient)"
                  dot={formattedData.length <= 15 ? { r: 3, fill: "#E85D3A", strokeWidth: 0 } : false}
                  activeDot={{ r: 6, fill: "#E85D3A", stroke: "#FFFFFF", strokeWidth: 2 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
