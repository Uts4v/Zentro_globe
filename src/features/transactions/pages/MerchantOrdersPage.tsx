// transactions/pages/merchant.orders.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Check,
  RefreshCw,
  Loader2,
  Clock,
  Bell,
  X,
  Utensils,
  ShoppingBag,
  Truck,
  Filter,
} from "lucide-react";
import { orderApi, type Order, type OrderStatus, type FulfillmentType } from "@/lib/api";
import { toast } from "sonner";
import { playOrderChime } from "@/lib/audio";

const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "completed",
  completed: null,
  cancelled: null,
};

const ADVANCE_LABEL: Record<OrderStatus, string> = {
  pending: "Confirm order",
  confirmed: "Start preparing",
  preparing: "Mark ready",
  ready: "Mark picked up",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-sky-100 text-sky-700",
  preparing: "bg-violet-100 text-violet-700",
  ready: "bg-emerald-100 text-emerald-700",
  completed: "bg-mist text-muted-foreground",
  cancelled: "bg-rose-100 text-rose-500",
};

function isToday(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function MerchantOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const knownOrderIds = useRef<Set<string>>(new Set());

  const [cancelModal, setCancelModal] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentType | "all">("all");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const data = await orderApi.storeOrders();
      setOrders(data);
      if (knownOrderIds.current.size === 0) {
        data.forEach((o) => knownOrderIds.current.add(o.id));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setConnected(true);
    const interval = setInterval(async () => {
      try {
        const fresh = await orderApi.storeOrders();

        setOrders((prev) => {
          const newOnes = fresh.filter((o) => !knownOrderIds.current.has(o.id));
          if (newOnes.length > 0) {
            newOnes.forEach((o) => {
              knownOrderIds.current.add(o.id);
              setNewOrderIds((s) => new Set([...s, o.id]));
              playOrderChime();
              setTimeout(() => {
                setNewOrderIds((s) => {
                  const n = new Set(s);
                  n.delete(o.id);
                  return n;
                });
              }, 5000);
            });
          }
          return fresh;
        });
      } catch {
        // Silent poll failure
      }
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  async function advance(order: Order) {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setAdvancing(order.id);
    try {
      const updated = await orderApi.updateStatus(order.id, next);
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdvancing(null);
    }
  }

  async function cancelOrder(order: Order, reason: string) {
    setCancelling(order.id);
    try {
      const updated = await orderApi.cancelByMerchant(order.id, reason);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      setCancelModal(null);
      toast.success("Order cancelled.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCancelling(null);
    }
  }

  const todayOrders = orders.filter((o) => isToday(o.created_at));

  const filteredOrders =
    fulfillmentFilter === "all"
      ? todayOrders
      : todayOrders.filter((o) => o.fulfillment_type === fulfillmentFilter);

  const grouped = {
    incoming: filteredOrders.filter((o) => o.status === "pending"),
    active: filteredOrders.filter((o) => ["confirmed", "preparing", "ready"].includes(o.status)),
    done: filteredOrders.filter((o) => ["completed", "cancelled"].includes(o.status)),
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Live queue</p>
          <h1 className="font-display mt-1 text-5xl text-foreground">Today's Orders</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-mist px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Auto-refresh</span>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-mist px-4 text-xs font-medium text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Fulfillment type filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {(
          [
            { key: "all", label: "All", icon: null },
            { key: "dine_in", label: "Dine-in", icon: Utensils },
            { key: "pickup", label: "Pickup", icon: ShoppingBag },
            { key: "delivery", label: "Delivery", icon: Truck },
          ] as const
        ).map((f) => (
          <button
            key={f.key}
            onClick={() => setFulfillmentFilter(f.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              fulfillmentFilter === f.key
                ? "bg-foreground text-background"
                : "bg-mist text-muted-foreground hover:bg-mist/80"
            }`}
          >
            {f.icon && <f.icon className="h-3 w-3" />}
            {f.label}
          </button>
        ))}
      </div>

      <Column title="Incoming" count={grouped.incoming.length} accent>
        {grouped.incoming.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            onAdvance={() => advance(o)}
            onCancel={() => setCancelModal(o)}
            advancing={advancing === o.id}
            cancelling={cancelling === o.id}
            isNew={newOrderIds.has(o.id)}
          />
        ))}
        {grouped.incoming.length === 0 && <Empty text="No new orders" />}
      </Column>

      <Column title="In progress" count={grouped.active.length}>
        {grouped.active.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            onAdvance={() => advance(o)}
            onCancel={o.status === "confirmed" ? () => setCancelModal(o) : undefined}
            advancing={advancing === o.id}
            cancelling={cancelling === o.id}
            isNew={false}
          />
        ))}
        {grouped.active.length === 0 && <Empty text="Nothing brewing" />}
      </Column>

      <Column title="Completed today" count={grouped.done.length}>
        {grouped.done.map((o) => (
          <OrderCard key={o.id} order={o} advancing={false} cancelling={false} isNew={false} />
        ))}
        {grouped.done.length === 0 && <Empty text="Day's just starting" />}
      </Column>

      {cancelModal && (
        <CancelOrderModal
          order={cancelModal}
          onConfirm={(reason) => cancelOrder(cancelModal, reason)}
          onClose={() => setCancelModal(null)}
          loading={cancelling === cancelModal.id}
        />
      )}
    </div>
  );
}

function Column({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-display text-2xl text-foreground">{title}</h2>
        <span
          className={`grid h-6 min-w-6 place-items-center rounded-full px-2 text-[11px] font-medium ${
            accent ? "gradient-ember text-white" : "bg-mist text-foreground"
          }`}
        >
          {count}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="glass col-span-full rounded-2xl py-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function CancelOrderModal({
  order,
  onConfirm,
  onClose,
  loading,
}: {
  order: Order;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("customer_request");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-xl text-foreground">
          Cancel order #{String(order.id).slice(0, 8)}?
        </h3>
        <p className="text-sm text-muted-foreground">Customer will be notified immediately.</p>

        <div>
          <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Reason
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-2xl bg-mist px-4 text-sm text-foreground outline-none"
          >
            <option value="customer_request">Customer Request</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="store_closing">Store Closing</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl border border-border text-sm text-muted-foreground"
          >
            Keep order
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading}
            className="h-11 flex-1 rounded-2xl bg-rose-500 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Cancelling…" : "Cancel order"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onAdvance,
  onCancel,
  advancing,
  cancelling,
  isNew,
}: {
  order: Order;
  onAdvance?: () => void;
  onCancel?: () => void;
  advancing: boolean;
  cancelling: boolean;
  isNew: boolean;
}) {
  const next = NEXT_STATUS[order.status];
  const mins = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60_000);
  const isGuest =
    !!(order as any).guest_session_id ||
    !(order as any).customer_id ||
    (order as any).customer_id === "";
  const customerName = isGuest
    ? (order as any).guest_name_snapshot || "Guest"
    : (order.profiles?.full_name ?? "Customer");
  const isPunchCard = (order as any).order_type === "punch_card_redemption";
  const isReward = (order as any).order_type === "reward_redemption";
  const isDineIn = order.fulfillment_type === "dine_in";
  const isPickup = order.fulfillment_type === "pickup";
  const isDelivery = order.fulfillment_type === "delivery";
  const tableNum = order.table_number_snapshot;
  const tableName = order.table_name_snapshot;

  const fulfillmentBadge = isDineIn
    ? { label: "Dine-in", icon: "🍽️", color: "bg-blue-100 text-blue-700" }
    : isDelivery
      ? { label: "Delivery", icon: "🚗", color: "bg-orange-100 text-orange-700" }
      : { label: "Pickup", icon: "🛍️", color: "bg-green-100 text-green-700" };

  return (
    <article
      className={`glass-strong cv-auto rounded-3xl p-5 transition-all ${
        isNew ? "ring-2 ring-ember shadow-ember animate-pulse" : ""
      } ${isPunchCard ? "ring-2 ring-violet-300" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div>
          {isNew && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-ember-soft px-2 py-0.5 text-[10px] font-medium text-ember">
              <Bell className="h-2.5 w-2.5" /> New order!
            </div>
          )}
          {isPunchCard && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700">
              🎟️ Punch Card Reward
            </div>
          )}
          {isReward && (
            <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              🎁 Reward Redemption
            </div>
          )}

          {/* Table number - prominently displayed for dine-in */}
          {isDineIn && tableName && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-1.5">
              <Utensils className="h-4 w-4 text-blue-600" />
              <span className="font-display text-sm font-bold text-blue-800">{tableName}</span>
              {tableNum && <span className="text-xs text-blue-500">#{tableNum}</span>}
            </div>
          )}

          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              #{String(order.id).slice(0, 8)}
            </p>
            {(order as any).kot_number && (
              <span className="inline-flex items-center rounded-full bg-ember-soft px-2 py-0.5 text-[10px] font-bold text-ember">
                KOT #{String((order as any).kot_number).padStart(3, "0")}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fulfillmentBadge.color}`}
            >
              {fulfillmentBadge.icon} {fulfillmentBadge.label}
            </span>
          </div>
          <h3 className="font-display mt-1 text-xl text-foreground">{customerName}</h3>
          {isGuest && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              👤 Guest Order
            </div>
          )}
          {!isGuest && (order as any).customer_id && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              ⭐ Member
            </div>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-widest font-medium ${STATUS_COLOR[order.status]}`}
        >
          {order.status}
        </span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {(order.order_items ?? []).map((item) => (
          <li key={item.id} className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              {item.quantity}× {item.name}
            </span>
            <span className="text-muted-foreground">
              {Number(item.subtotal) > 0 ? `NPR ${Number(item.subtotal).toLocaleString()}` : "FREE"}
            </span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 border border-amber-100">
          📝 {order.notes}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {mins < 1 ? "Just now" : `${mins}m ago`}
        </span>
        <span className="font-display text-lg text-foreground">
          {Number(order.total_amount) > 0
            ? `NPR ${Number(order.total_amount).toLocaleString()}`
            : "FREE"}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        {next && onAdvance && (
          <button
            onClick={onAdvance}
            disabled={advancing}
            className="inline-flex flex-1 h-11 items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {advancing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {ADVANCE_LABEL[order.status]}
          </button>
        )}
        {["pending", "confirmed"].includes(order.status) && onCancel && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium text-rose-600 hover:bg-rose-100 disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          </button>
        )}
      </div>
    </article>
  );
}
