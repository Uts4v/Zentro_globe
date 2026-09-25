import React from "react";

export interface TooltipItem {
  name: string;
  value: number | string;
  color?: string;
  formatter?: (val: any) => string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: any;
    color?: string;
    payload?: any;
    dataKey?: string;
  }>;
  label?: string;
  currencySymbol?: string;
  title?: string;
}

export function CustomChartTooltip({
  active,
  payload,
  label,
  currencySymbol = "Rs",
  title,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const rawData = payload[0]?.payload || {};
  const dateStr = label || rawData.date || rawData.label;

  let formattedDate = dateStr;
  if (dateStr && typeof dateStr === "string" && dateStr.includes("-")) {
    try {
      formattedDate = new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      formattedDate = dateStr;
    }
  }

  return (
    <div className="z-50 min-w-[160px] rounded-2xl border border-border/80 bg-card/95 p-3.5 shadow-xl backdrop-blur-md transition-all">
      <p className="border-b border-border/60 pb-1.5 text-xs font-semibold text-foreground">
        {title || formattedDate}
      </p>
      <div className="mt-2 space-y-1.5 text-xs">
        {payload.map((item, idx) => {
          const isRevenue =
            item.dataKey === "revenue" ||
            item.name?.toLowerCase().includes("revenue") ||
            item.name?.toLowerCase().includes("sales");
          const isOrders =
            item.dataKey === "orders" ||
            item.dataKey === "count" ||
            item.name?.toLowerCase().includes("order");

          let displayVal = String(item.value ?? 0);
          if (isRevenue) {
            displayVal = `${currencySymbol} ${Number(item.value ?? 0).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}`;
          } else if (isOrders) {
            displayVal = `${Number(item.value ?? 0).toLocaleString()} ${
              Number(item.value) === 1 ? "order" : "orders"
            }`;
          }

          return (
            <div key={idx} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color || "#E85D3A" }}
                />
                <span className="capitalize">{item.name}</span>
              </span>
              <span className="font-semibold text-foreground">{displayVal}</span>
            </div>
          );
        })}

        {/* If available, show Average Order Value */}
        {rawData.revenue > 0 && rawData.orders > 0 && payload.length > 1 && (
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-border/40 pt-1 text-[11px] text-muted-foreground">
            <span>Avg / Order</span>
            <span className="font-medium text-foreground">
              {currencySymbol}{" "}
              {(Number(rawData.revenue) / Number(rawData.orders)).toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
