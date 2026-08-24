// routes/orders.$id.tsx 
import { createFileRoute, Link } from "@tanstack/react-router";
import { type OrderStatus } from "@/lib/store";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { requireAuth } from "@/lib/auth-guard";
import { orderApi, type Order } from "@/lib/api";

export const Route = createFileRoute("/orders/$id")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Tracking order · Zentro" }] }),
  component: OrderPage,
});

const STEPS: { key: OrderStatus; label: string; emoji: string }[] = [
  { key: "pending", label: "Order placed", emoji: "🧾" },
  { key: "confirmed", label: "Accepted", emoji: "✅" },
  { key: "preparing", label: "Brewing", emoji: "☕" },
  { key: "ready", label: "Ready for pickup", emoji: "🔔" },
  { key: "completed", label: "Picked up", emoji: "🎉" },
];

const STATUS_MESSAGE: Record<OrderStatus, string> = {
  pending: "Waiting for the merchant to confirm…",
  confirmed: "Your order has been accepted!",
  preparing: "Your order is being prepared…",
  ready: "Your order is ready — come pick it up! 🔔",
  completed: "Enjoy! Thanks for ordering.",
  cancelled: "This order was cancelled.",
};

function OrderPage() {
  const { id } = Route.useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [justUpdated, setJustUpdated] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await orderApi.get(id);
      setOrder(data);
      setError("");
    } catch (e: any) {
      setError(e.message || "Failed to load order");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 5 seconds for status updates while order is active
  useEffect(() => {
    if (!order) return;
    const terminal = ["completed", "cancelled"];
    if (terminal.includes(order.status)) return; // stop polling once done

    const interval = setInterval(async () => {
      try {
        const updated = await orderApi.get(id);
        setOrder((prev) => {
          if (!prev || prev.status === updated.status) return prev;
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 1500);
          return updated;
        });
      } catch {
        // Silent — next tick will retry
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [id, order?.status]);

  if (loading) {
    return (
      <MobileShell>
        <TopBar
          right={
            <Link to="/" className="glass grid h-9 w-9 place-items-center rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          }
        />
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileShell>
    );
  }

  if (error || !order) {
    return (
      <MobileShell>
        <TopBar
          right={
            <Link to="/" className="glass grid h-9 w-9 place-items-center rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          }
        />
        <div className="px-5">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error || "Order not found"}
            <button onClick={load} className="ml-2 underline">Retry</button>
          </div>
        </div>
      </MobileShell>
    );
  }

  const currentIdx = STEPS.findIndex((s) => s.key === order.status);
  const isCancelled = order.status === "cancelled";
  const isCompleted = order.status === "completed";
  const orderLabel = String(order.id).slice(0, 8);
  const merchantName = order.merchant_profiles?.business_name;

  return (
    <MobileShell>
      <TopBar
        title={`Order #${orderLabel}`}
        right={
          <Link to="/" className="glass grid h-9 w-9 place-items-center rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />

      <div className="px-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Order #{orderLabel}
        </p>
        <h1 className="font-display mt-1 text-4xl text-foreground">
          {isCancelled ? "Order cancelled" : isCompleted ? "Enjoy your order" : "We're on it"}
        </h1>
        {merchantName && (
          <p className="mt-1 text-sm text-muted-foreground">from {merchantName}</p>
        )}

        {/* Live status message */}
        <div className={`mt-4 rounded-2xl px-4 py-3 text-sm transition-all ${justUpdated
            ? "bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200"
            : isCancelled
              ? "bg-rose-50 text-rose-700"
              : isCompleted
                ? "bg-emerald-50 text-emerald-700"
                : "bg-ember-soft text-foreground"
          }`}>
          {justUpdated && <span className="mr-1.5">✨</span>}
          {STATUS_MESSAGE[order.status]}
        </div>
      </div>

      {/* Progress tracker */}
      {!isCancelled && (
        <div className="mt-6 px-5">
          <div className="glass-strong rounded-3xl p-5">
            <ol className="space-y-4">
              {STEPS.map((s, i) => {
                const done = i <= currentIdx;
                const active = i === currentIdx && !isCompleted;
                return (
                  <li key={s.key} className="flex items-center gap-4">
                    <div className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg transition-all duration-500 ${done
                        ? "bg-ink text-primary-foreground"
                        : "bg-mist text-muted-foreground"
                      } ${active ? "ring-4 ring-ember/30 scale-110" : ""}`}>
                      {done && !active ? <Check className="h-4 w-4" /> : s.emoji}
                      {/* Pulse dot for active step */}
                      {active && (
                        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-ember">
                          <span className="absolute inset-0 animate-ping rounded-full bg-ember opacity-75" />
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`text-sm font-medium transition-colors ${done ? "text-foreground" : "text-muted-foreground"
                        }`}>
                        {s.label}
                      </p>
                      {active && (
                        <p className="mt-0.5 text-xs text-ember">In progress…</p>
                      )}
                    </div>
                    {done && !active && (
                      <span className="text-[10px] text-muted-foreground">Done</span>
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[11px] text-muted-foreground">
                Updates every few seconds automatically
              </p>
            </div>
          </div>
        </div>
      )}
      {isCancelled && (
        <div className="mt-6 px-5">
          <div className="glass-strong rounded-3xl p-5 text-center">
            <p className="text-4xl">❌</p>
            <p className="mt-3 font-medium text-foreground">This order was cancelled</p>
            {order.cancellation_reason && (
              <p className="mt-1 text-sm text-muted-foreground">
                Reason: {order.cancellation_reason.replace("_", " ")}
              </p>
            )}
            {order.cancelled_by && (
              <p className="mt-1 text-xs text-muted-foreground capitalize">
                Cancelled by: {order.cancelled_by}
              </p>
            )}
            <Link
              to="/"
              className="mt-4 inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-xs font-medium text-primary-foreground"
            >
              Order again
            </Link>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="mt-6 px-5">
        <h2 className="mb-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">Items</h2>
        <div className="glass space-y-2 rounded-2xl p-4">
          {(order.order_items ?? []).map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                {item.quantity}× {item.name}
              </span>
              <span className="text-sm text-muted-foreground">
                NPR {Number(item.subtotal).toLocaleString()}
              </span>
            </div>
          ))}
          <div className="!mt-3 border-t border-border pt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-display text-xl text-foreground">
              NPR {Number(order.total_amount).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Add More button */}
        {order.can_add_items && (
          <Link
            to="/orders/add-to-order/$id"
            params={{ id: order.id }}
            className="mt-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-ink/30 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            Add more items
          </Link>
        )}
      </div>

      <div className="mt-4 px-5 pb-8">
        <div className="flex items-center justify-between rounded-2xl bg-ember-soft px-4 py-3">
          <span className="text-xs text-foreground">Points earned</span>
          <span className="font-display text-lg text-ember">+{order.points_earned} pts</span>
        </div>
      </div>
    </MobileShell>
  );
}
