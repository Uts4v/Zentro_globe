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
import { Clock } from "lucide-react";

export interface HourPoint {
  hour: number;
  count: number;
}

interface BusiestHoursChartProps {
  hours: HourPoint[];
}

export function BusiestHoursChart({ hours }: BusiestHoursChartProps) {
  const totalCount = hours.reduce((sum, h) => sum + (h.count || 0), 0);
  const maxCount = Math.max(...hours.map((h) => h.count || 0), 0);

  const formattedHours = hours.map((h) => {
    const hourNum = h.hour;
    const period = hourNum >= 12 ? "PM" : "AM";
    const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;
    const label = `${hour12} ${period}`;
    const pct = totalCount > 0 ? ((h.count / totalCount) * 100).toFixed(1) : "0";
    return {
      hour: hourNum,
      label,
      orders: h.count || 0,
      pct,
      isPeak: maxCount > 0 && h.count === maxCount,
    };
  });

  const peakHour = formattedHours.find((h) => h.isPeak);

  function CustomHourTooltip({ active, payload }: any) {
    if (!active || !payload || payload.length === 0) return null;
    const data = payload[0].payload;
    const nextHour = (data.hour + 1) % 24;
    return (
      <div className="z-50 min-w-[140px] rounded-2xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-md">
        <p className="border-b border-border/60 pb-1 text-xs font-semibold text-foreground">
          {data.hour}:00 – {nextHour}:00 ({data.label})
        </p>
        <div className="mt-1.5 space-y-1 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Orders:</span>
            <span className="font-semibold text-foreground">{data.orders}</span>
          </div>
          {totalCount > 0 && (
            <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
              <span>Volume:</span>
              <span>{data.pct}% of period</span>
            </div>
          )}
          {data.isPeak && (
            <span className="mt-1 inline-block rounded-full bg-ember/15 px-2 py-0.5 text-[10px] font-semibold text-ember">
              🔥 Peak Hour
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {peakHour && totalCount > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-ember" />
            Peak: <strong className="text-foreground">{peakHour.label}</strong> ({peakHour.orders} orders)
          </span>
          <span>{totalCount} total orders</span>
        </div>
      )}

      {totalCount === 0 ? (
        <div className="flex h-36 flex-col items-center justify-center rounded-2xl bg-mist/30 text-center text-xs text-muted-foreground">
          <Clock className="mb-1.5 h-6 w-6 text-muted-foreground/40" />
          <p className="font-medium text-foreground">No order times recorded</p>
          <p className="text-[11px]">Busiest hours will appear once orders are placed.</p>
        </div>
      ) : (
        <div className="h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={formattedHours} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border/30" />
              <XAxis
                dataKey="label"
                interval={2}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 9, fill: "currentColor" }}
                className="text-muted-foreground"
              />
              <Tooltip content={<CustomHourTooltip />} />
              <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
                {formattedHours.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isPeak ? "#E85D3A" : "#3B82F6"}
                    opacity={entry.orders > 0 ? (entry.isPeak ? 1 : 0.75) : 0.15}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
