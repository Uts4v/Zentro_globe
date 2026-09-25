import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  AreaChart,
  Area,
} from "recharts";
import { CustomChartTooltip } from "./ChartTooltip";
import { Coffee, TrendingUp } from "lucide-react";

interface DashboardPoint {
  date: string;
  count: number;
  revenue?: number;
}

interface DashboardOrderChartProps {
  data: DashboardPoint[];
  currencySymbol?: string;
}

export function DashboardOrderChart({ data, currencySymbol = "Rs" }: DashboardOrderChartProps) {
  const [metric, setMetric] = useState<"orders" | "revenue">("orders");

  const totalOrders = data.reduce((acc, d) => acc + (d.count || 0), 0);
  const totalRevenue = data.reduce((acc, d) => acc + (d.revenue || 0), 0);
  const hasData = data.some((d) => (d.count || 0) > 0 || (d.revenue || 0) > 0);

  const formattedData = data.map((d) => {
    let dateLabel = d.date;
    try {
      dateLabel = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
    } catch {
      dateLabel = d.date;
    }
    return {
      ...d,
      displayDate: dateLabel,
      orders: d.count || 0,
      revenue: Number(d.revenue || 0),
    };
  });

  const maxVal = Math.max(
    ...formattedData.map((d) => (metric === "orders" ? d.orders : d.revenue)),
    1
  );

  return (
    <div className="space-y-4">
      {/* Metric toggle & summary */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full bg-mist p-1">
          <button
            onClick={() => setMetric("orders")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              metric === "orders"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <Coffee className="h-3 w-3" />
            Orders ({totalOrders})
          </button>
          <button
            onClick={() => setMetric("revenue")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
              metric === "revenue"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <TrendingUp className="h-3 w-3" />
            Revenue ({currencySymbol} {totalRevenue.toLocaleString()})
          </button>
        </div>

        <span className="text-[11px] text-muted-foreground">
          Showing last {data.length} days
        </span>
      </div>

      {/* Chart Canvas */}
      {!hasData ? (
        <div className="flex h-44 flex-col items-center justify-center rounded-2xl bg-mist/30 text-center text-sm text-muted-foreground">
          <Coffee className="mb-2 h-7 w-7 text-muted-foreground/40" />
          <p className="font-medium text-foreground">No orders in the last 12 days</p>
          <p className="mt-0.5 text-xs text-muted-foreground/70">
            Orders placed in your store or online will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {metric === "orders" ? (
              <BarChart data={formattedData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashboard-bar-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E85D3A" stopOpacity="0.95" />
                    <stop offset="100%" stopColor="#E85D3A" stopOpacity="0.5" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/40" />
                <XAxis
                  dataKey="displayDate"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  className="text-muted-foreground"
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  className="text-muted-foreground"
                />
                <Tooltip
                  cursor={{ fill: "currentColor", className: "text-muted/30", radius: 6 }}
                  content={<CustomChartTooltip currencySymbol={currencySymbol} />}
                />
                <Bar
                  dataKey="orders"
                  name="Orders"
                  fill="url(#dashboard-bar-grad)"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={36}
                >
                  {formattedData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.orders === maxVal && maxVal > 0 ? "#E85D3A" : "url(#dashboard-bar-grad)"}
                      opacity={entry.orders > 0 ? 0.95 : 0.25}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <AreaChart data={formattedData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashboard-rev-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E85D3A" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#E85D3A" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/40" />
                <XAxis
                  dataKey="displayDate"
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
                    val >= 1000 ? `${currencySymbol} ${(val / 1000).toFixed(0)}k` : `${currencySymbol} ${val}`
                  }
                />
                <Tooltip
                  cursor={{ stroke: "#E85D3A", strokeWidth: 1, strokeDasharray: "3 3" }}
                  content={<CustomChartTooltip currencySymbol={currencySymbol} />}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#E85D3A"
                  strokeWidth={2.5}
                  fill="url(#dashboard-rev-grad)"
                  dot={{ r: 3, fill: "#E85D3A", strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: "#E85D3A", stroke: "#FFFFFF", strokeWidth: 2 }}
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
