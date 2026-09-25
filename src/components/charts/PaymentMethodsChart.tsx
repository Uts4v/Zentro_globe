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

interface PaymentMethodItem {
  method: string;
  count: number;
  amount: number;
  percentage: number;
}

interface PaymentMethodsChartProps {
  methods: PaymentMethodItem[];
  currencySymbol?: string;
  totalSales?: number;
}

const METHOD_COLORS: Record<string, string> = {
  cash: "#10B981",
  card: "#3B82F6",
  bank_qr: "#8B5CF6",
  mobile_wallet: "#F59E0B",
  credit: "#6366F1",
  debit: "#EC4899",
  other: "#64748B",
};

export function PaymentMethodsChart({
  methods,
  currencySymbol = "Rs",
  totalSales = 0,
}: PaymentMethodsChartProps) {
  if (methods.length === 0) return null;

  const data = methods.map((m) => ({
    name: m.method.replace(/_/g, " "),
    methodKey: m.method,
    amount: Number(m.amount || 0),
    count: m.count || 0,
    percentage: m.percentage || 0,
    color: METHOD_COLORS[m.method] || "#E85D3A",
  }));

  function CustomTooltip({ active, payload }: any) {
    if (!active || !payload || payload.length === 0) return null;
    const item = payload[0].payload;
    return (
      <div className="z-50 min-w-[150px] rounded-2xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-md">
        <p className="border-b border-border/60 pb-1 text-xs font-semibold capitalize text-foreground">
          {item.name}
        </p>
        <div className="mt-1.5 space-y-1 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Collected:</span>
            <span className="font-semibold text-foreground">
              {currencySymbol} {item.amount.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Transactions:</span>
            <span className="font-semibold text-foreground">{item.count}</span>
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
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-border/30" />
          <XAxis
            type="number"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: "currentColor" }}
            className="text-muted-foreground"
            tickFormatter={(v) =>
              v >= 1000
                ? `${currencySymbol} ${(v / 1000).toFixed(0)}k`
                : `${currencySymbol} ${v}`
            }
          />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "currentColor" }}
            className="text-foreground capitalize font-medium"
            width={75}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="amount" radius={[0, 6, 6, 0]} maxBarSize={18}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
