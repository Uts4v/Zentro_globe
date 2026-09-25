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
} from "recharts";
import { Layers } from "lucide-react";

interface CategoryData {
  name: string;
  quantity_sold: number;
  revenue: number;
}

interface CategoryBreakdownChartProps {
  categories: CategoryData[];
  currencySymbol?: string;
}

const CATEGORY_COLORS = [
  "#E85D3A",
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#F59E0B",
  "#EC4899",
  "#14B8A6",
  "#6366F1",
];

export function CategoryBreakdownChart({
  categories,
  currencySymbol = "Rs",
}: CategoryBreakdownChartProps) {
  const [metric, setMetric] = useState<"revenue" | "quantity">("revenue");

  if (categories.length === 0) return null;

  const totalRev = categories.reduce((sum, c) => sum + (c.revenue || 0), 0);
  const totalQty = categories.reduce((sum, c) => sum + (c.quantity_sold || 0), 0);

  const data = categories.slice(0, 8).map((cat, i) => {
    const val = metric === "revenue" ? cat.revenue : cat.quantity_sold;
    const total = metric === "revenue" ? totalRev : totalQty;
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0";
    return {
      name: cat.name,
      value: val,
      percentage: pct,
      revenue: cat.revenue,
      quantity_sold: cat.quantity_sold,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    };
  });

  function CustomTooltip({ active, payload }: any) {
    if (!active || !payload || payload.length === 0) return null;
    const item = payload[0].payload;
    return (
      <div className="z-50 min-w-[150px] rounded-2xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-md">
        <p className="border-b border-border/60 pb-1 text-xs font-semibold text-foreground">
          {item.name}
        </p>
        <div className="mt-1.5 space-y-1 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Revenue:</span>
            <span className="font-semibold text-foreground">
              {currencySymbol} {item.revenue.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Quantity:</span>
            <span className="font-semibold text-foreground">{item.quantity_sold} sold</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>Share:</span>
            <span>{item.percentage}%</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full bg-mist p-1 text-xs">
          <button
            onClick={() => setMetric("revenue")}
            className={`rounded-full px-3 py-1 font-medium transition-all ${
              metric === "revenue"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            By Revenue
          </button>
          <button
            onClick={() => setMetric("quantity")}
            className={`rounded-full px-3 py-1 font-medium transition-all ${
              metric === "quantity"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            By Quantity
          </button>
        </div>
        <span className="text-[11px] text-muted-foreground">Top {data.length} categories</span>
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 40, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-border/30" />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: "currentColor" }}
              className="text-muted-foreground"
              tickFormatter={(v) =>
                metric === "revenue"
                  ? v >= 1000
                    ? `${currencySymbol} ${(v / 1000).toFixed(0)}k`
                    : `${currencySymbol} ${v}`
                  : `${v}`
              }
            />
            <YAxis
              type="category"
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "currentColor" }}
              className="text-foreground font-medium"
              width={80}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={20}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
