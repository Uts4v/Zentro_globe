import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { posListOrders, PosOrder } from "../api";
import { formatCurrency } from "@/lib/currency";
import {
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-info/10 text-info",
  preparing: "bg-warning/10 text-warning",
  ready: "bg-success/10 text-success",
  served: "bg-success/10 text-success",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function PosOrdersScreen() {
  const activeShift = usePosStore((s) => s.activeShift);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  async function loadOrders() {
    setLoading(true);
    try {
      const data = await posListOrders(activeShift?.id);
      setOrders(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [activeShift?.id]);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(o.id).includes(q) ||
      (o.customer_name ?? "").toLowerCase().includes(q) ||
      (o.table_name_snapshot ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Orders</h1>
          {activeShift && (
            <p className="text-xs text-muted-foreground">
              Shift #{activeShift.id.slice(0, 8)} — {activeShift.total_orders} orders
            </p>
          )}
        </div>
        <button
          onClick={loadOrders}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by order #, customer, table..."
          aria-label="Search orders"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-muted/50 py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
      </div>

      {/* Orders list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <div
              key={order.uuid ?? order.id}
              className="rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">
                      #{order.id}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {order.status.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                      {order.source}
                    </span>
                  </div>

                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {order.customer_name && (
                      <p>Customer: {order.customer_name}</p>
                    )}
                    {order.table_name_snapshot && (
                      <p>Table: {order.table_name_snapshot}</p>
                    )}
                    <p>
                      {order.items.length} item(s) —{" "}
                      <span className="numeric">
                        {formatCurrency(Number(order.total_amount))}
                      </span>
                    </p>
                    <p>
                      Payment:{" "}
                      <span className="font-medium capitalize">
                        {order.payment_status}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Status icon */}
                <div className="shrink-0">
                  {order.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : order.status === "cancelled" ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Clock className="h-5 w-5 text-warning" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
