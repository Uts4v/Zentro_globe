import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, ChevronDown, ChevronUp, X, Plus, ArrowLeft, AlertTriangle } from "lucide-react";
import { orderApi, type Order, type OrderStatus } from "@/lib/api";

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-sky-100 text-sky-700",
  preparing: "bg-violet-100 text-violet-700",
  ready: "bg-emerald-100 text-emerald-700",
  completed: "bg-mist text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-500",
};

const STATUS_STEP: Record<OrderStatus, number> = {
  pending: 0,
  confirmed: 1,
  preparing: 2,
  ready: 3,
  completed: 4,
  cancelled: -1,
};

export function CustomerOrdersPage() {
  if (typeof window === "undefined") return null;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await orderApi.myOrders();
      setOrders(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id: string) {
    setCancelling(id);
    setConfirmCancelId(null);
    try {
      const updated = await orderApi.cancel(id as any);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCancelling(null);
    }
  }

  const active = orders.filter((o) => !["completed", "cancelled"].includes(o.status));
  const past = orders.filter((o) => ["completed", "cancelled"].includes(o.status));

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 pb-24 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition-colors hover:bg-mist hover:text-foreground"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">History</p>
          <h1 className="font-display text-3xl sm:text-4xl text-foreground">My Orders</h1>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="glass rounded-3xl py-20 text-center">
          <p className="text-4xl">🛍️</p>
          <p className="mt-3 text-sm text-muted-foreground">No orders yet — place your first one!</p>
        </div>
      ) : (
        <>
          {/* Active orders */}
          {active.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl text-foreground">Active</h2>
              {active.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  expanded={expanded === order.id}
                  onToggle={() => setExpanded((p) => (p === order.id ? null : order.id))}
                  onCancel={() => setConfirmCancelId(order.id)}
                  cancelling={cancelling === order.id}
                />
              ))}
            </section>
          )}

          {/* Past orders */}
          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-2xl text-foreground">Past</h2>
              {past.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  expanded={expanded === order.id}
                  onToggle={() => setExpanded((p) => (p === order.id ? null : order.id))}
                  cancelling={false}
                />
              ))}
            </section>
          )}
        </>
      )}

      {/* Cancel Confirmation Modal */}
      {confirmCancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-3xl border border-border bg-background p-6 shadow-xl space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">Cancel Order</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Are you sure you want to cancel this order? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setConfirmCancelId(null)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-mist transition-colors"
              >
                Keep Order
              </button>
              <button
                onClick={() => handleCancel(confirmCancelId)}
                className="flex-1 rounded-xl bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground hover:opacity-90 transition-opacity"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Order row with progress tracker ──────────────────────────────────────────
const STEPS = ["Placed", "Confirmed", "Preparing", "Ready"] as const;

function OrderRow({
  order,
  expanded,
  onToggle,
  onCancel,
  cancelling,
}: {
  order: Order;
  expanded: boolean;
  onToggle: () => void;
  onCancel?: () => void;
  cancelling: boolean;
}) {
  const step = STATUS_STEP[order.status];
  const isActive = !["completed", "cancelled"].includes(order.status);
  const date = new Date(order.created_at).toLocaleDateString("en-NP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article className="glass-strong cv-auto overflow-hidden rounded-3xl">
      {/* Summary row */}
      <button onClick={onToggle} className="flex w-full items-center gap-4 p-5 text-left">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">#{order.id}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_COLOR[order.status]}`}>
              {order.status}
            </span>
            {order.points_earned > 0 && order.status === "completed" && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-700">
                +{order.points_earned} pts
              </span>
            )}
          </div>
          <p className="font-display mt-1 text-lg text-foreground">{order.merchant_name}</p>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl text-foreground">NPR {Number(order.total_amount).toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">{(order.items ?? []).length} item{(order.items ?? []).length !== 1 ? "s" : ""}</p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
          {/* Progress tracker (active orders only) */}
          {isActive && (
            <div className="flex items-center gap-0">
              {STEPS.map((label, i) => (
                <div key={label} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-6 w-6 rounded-full text-[10px] font-bold grid place-items-center transition-colors ${i <= step
                          ? "bg-ink text-primary-foreground"
                          : "bg-mist text-muted-foreground"
                        }`}
                    >
                      {i < step ? "✓" : i + 1}
                    </div>
                    <span className="mt-1 text-[9px] text-muted-foreground">{label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-1 rounded transition-colors ${i < step ? "bg-ink" : "bg-mist"}`} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Items */}
          <ul className="space-y-1.5">
            {(order.items ?? []).map((item) => (
              <li key={item.id} className="flex justify-between text-sm">
                <span className="text-foreground">{item.quantity}× {item.name}</span>
                <span className="text-muted-foreground">NPR {Number(item.subtotal).toLocaleString()}</span>
              </li>
            ))}
          </ul>

          {/* Add More button */}
          {order.can_add_items && (
            <Link
              to="/orders/add-to-order/$id"
              params={{ id: order.id }}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ink/30 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add more items
            </Link>
          )}

          {order.notes && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 border border-amber-100">
              📝 {order.notes}
            </p>
          )}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="font-medium text-sm text-foreground">
              Total: NPR {Number(order.total_amount).toLocaleString()}
            </span>
            {order.status === "pending" && onCancel && (
              <button
                onClick={onCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
                Cancel order
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
