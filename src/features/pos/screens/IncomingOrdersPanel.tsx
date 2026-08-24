import { useState, useEffect, useCallback, useRef } from "react";
import { usePosStore } from "../store";
import {
  posListOrders,
  posUpdateOrderStatus,
  posAssignCustomerToOrder,
  posSearchCustomers,
  PosOrder,
  PosCustomer,
} from "../api";
import {
  Bell,
  Check,
  X,
  Clock,
  Loader2,
  ShoppingBag,
  ChevronRight,
  RefreshCw,
  UserPlus,
  Search,
  Utensils,
} from "lucide-react";
import { playOrderChime } from "@/lib/audio";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  confirmed: "bg-blue-100 text-blue-700 border-blue-200",
  preparing: "bg-purple-100 text-purple-700 border-purple-200",
  ready: "bg-green-100 text-green-700 border-green-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const SOURCE_LABELS: Record<string, string> = {
  customer_app: "App Order",
  table_qr: "Table QR",
  pos: "POS",
};

export default function IncomingOrdersPanel() {
  const incomingOrders = usePosStore((s) => s.incomingOrders);
  const setIncomingOrders = usePosStore((s) => s.setIncomingOrders);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const knownOrderIds = useRef<Set<number>>(new Set());

  // Customer linking state
  const [linkingOrderId, setLinkingOrderId] = useState<number | null>(null);
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState<PosCustomer[]>([]);
  const [custSearching, setCustSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await posListOrders();
      const incoming = data.filter(
        (o) =>
          ["customer_app", "table_qr"].includes(o.source) &&
          ["pending", "confirmed"].includes(o.status),
      );

      // Play chime for new incoming orders
      if (knownOrderIds.current.size > 0) {
        const newOrders = incoming.filter((o) => !knownOrderIds.current.has(o.id));
        if (newOrders.length > 0) {
          playOrderChime();
        }
      }

      // Update known IDs
      incoming.forEach((o) => knownOrderIds.current.add(o.id));

      setIncomingOrders(incoming);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [setIncomingOrders]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  async function handleAccept(order: PosOrder) {
    if (!currentWorker) return;
    try {
      await posUpdateOrderStatus(order.uuid, "confirmed", currentWorker.id);
    } catch {
      // handled by toast in api layer
    } finally {
      fetchOrders();
    }
  }

  async function handleReject(order: PosOrder) {
    if (!currentWorker) return;
    try {
      await posUpdateOrderStatus(order.uuid, "cancelled", currentWorker.id);
    } catch {
      // silent
    } finally {
      fetchOrders();
    }
  }

  async function handleMarkReady(order: PosOrder) {
    if (!currentWorker) return;
    try {
      await posUpdateOrderStatus(order.uuid, "ready", currentWorker.id);
    } catch {
      // silent
    } finally {
      fetchOrders();
    }
  }

  async function searchCustomer() {
    if (custSearch.length < 2) return;
    setCustSearching(true);
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    try {
      const results = await posSearchCustomers(custSearch, controller.signal);
      if (!controller.signal.aborted) setCustResults(results);
    } catch {
      if (!controller.signal.aborted) setCustResults([]);
    } finally {
      if (!controller.signal.aborted) setCustSearching(false);
    }
  }

  async function handleLinkCustomer(orderId: string, customerId: string) {
    setLinking(true);
    try {
      await posAssignCustomerToOrder(orderId, customerId);
      setLinkingOrderId(null);
      setCustSearch("");
      setCustResults([]);
      fetchOrders();
    } catch {
      // silent
    } finally {
      setLinking(false);
    }
  }

  if (incomingOrders.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <div className="relative">
            <Bell className="h-5 w-5 text-amber-600" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {incomingOrders.length}
            </span>
          </div>
          <h3 className="text-sm font-bold text-foreground">Incoming Orders</h3>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        </button>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-amber-100"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Order cards */}
      {!collapsed && (
      <div className="space-y-2 max-h-[38vh] overflow-y-auto">
        {incomingOrders.map((order) => {
          const isExpanded = expandedId === order.id;
          const createdAgo = order.created_at ? formatTimeAgo(order.created_at) : "";
          const hasCustomer = !!order.customer;
          const isLinking = linkingOrderId === order.id;

          return (
            <div
              key={order.id}
              className="rounded-xl border border-amber-200 bg-white p-3 shadow-sm"
            >
              {/* Order summary row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">#{order.id}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}
                    >
                      {order.status}
                    </span>
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-bold text-ink">
                      {SOURCE_LABELS[order.source] || order.source}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {createdAgo}
                    </span>
                    <span className="flex items-center gap-1 capitalize">
                      <Utensils className="h-3 w-3" />
                      {order.fulfillment_type}
                    </span>
                    {order.table_name_snapshot && (
                      <span className="flex items-center gap-1">
                        <ShoppingBag className="h-3 w-3" />
                        {order.table_name_snapshot}
                      </span>
                    )}
                    {hasCustomer ? (
                      <span className="text-ink font-medium">
                        {order.customer_name || "Customer linked"}
                        {order.points_earned > 0 && (
                          <span className="ml-1 text-green-600">({order.points_earned} pts)</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">No customer</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-bold text-foreground whitespace-nowrap">
                  Rs {Number(order.total_amount).toFixed(2)}
                </span>
              </div>

              {/* Items preview */}
              <div className="mt-2 text-xs text-muted-foreground">
                {order.items.length} item{order.items.length !== 1 ? "s" : ""}
                {" · "}
                {order.items
                  .slice(0, 3)
                  .map((item) => item.name)
                  .join(", ")}
                {order.items.length > 3 && ` +${order.items.length - 3} more`}
              </div>

              {/* Expand/collapse */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
                className="mt-2 flex items-center gap-1 text-[11px] font-medium text-ink hover:underline"
              >
                {isExpanded ? "Less" : "Details"}
                <ChevronRight
                  className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              </button>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-2 space-y-1 border-t border-border pt-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {item.quantity}× {item.name}
                      </span>
                      <span className="font-medium">Rs {Number(item.subtotal).toFixed(2)}</span>
                    </div>
                  ))}
                  {order.notes && (
                    <p className="mt-1 rounded-lg bg-muted px-2 py-1 text-[11px] italic text-muted-foreground">
                      "{order.notes}"
                    </p>
                  )}
                </div>
              )}

              {/* Customer linking inline */}
              {!hasCustomer && isLinking && (
                <div className="mt-3 rounded-lg border border-border bg-muted/50 p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                      <input
                        autoFocus
                        value={custSearch}
                        onChange={(e) => setCustSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && searchCustomer()}
                        placeholder="Search name, phone, or membership..."
                        className="w-full rounded-lg border border-border bg-background pl-7 pr-2 py-1.5 text-xs"
                      />
                    </div>
                    <button
                      onClick={searchCustomer}
                      disabled={custSearching || custSearch.length < 2}
                      className="rounded-lg bg-ink px-2 py-1.5 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      {custSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : "Search"}
                    </button>
                  </div>
                  {custResults.length > 0 && (
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {custResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => handleLinkCustomer(order.uuid, c.id.toString())}
                          disabled={linking}
                          className="flex w-full items-center justify-between rounded-lg bg-white px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                        >
                          <span className="font-medium text-foreground">
                            {c.full_name || c.phone || `#${c.id}`}
                          </span>
                          {c.membership_number && (
                            <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                              {c.membership_number}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {custSearch.length >= 2 && custResults.length === 0 && !custSearching && (
                    <p className="text-[10px] text-muted-foreground text-center">
                      No customers found
                    </p>
                  )}
                  <button
                    onClick={() => {
                      setLinkingOrderId(null);
                      setCustSearch("");
                      setCustResults([]);
                    }}
                    className="w-full text-[10px] text-muted-foreground hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Action buttons */}
              {order.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  {!hasCustomer && !isLinking && (
                    <button
                      onClick={() => setLinkingOrderId(order.id)}
                      className="flex items-center justify-center gap-1 rounded-lg border border-ink/30 bg-ink/5 px-3 py-2 text-xs font-bold text-ink hover:bg-ink/10"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Link Customer
                    </button>
                  )}
                  <button
                    onClick={() => handleReject(order)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => handleAccept(order)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-green-600 py-2 text-xs font-bold text-white hover:bg-green-700"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Accept
                  </button>
                </div>
              )}

              {order.status === "confirmed" && (
                <div className="mt-3 flex gap-2">
                  {!hasCustomer && !isLinking && (
                    <button
                      onClick={() => setLinkingOrderId(order.id)}
                      className="flex items-center justify-center gap-1 rounded-lg border border-ink/30 bg-ink/5 px-3 py-2 text-xs font-bold text-ink hover:bg-ink/10"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Link Customer
                    </button>
                  )}
                  <button
                    onClick={() => handleMarkReady(order)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-ink py-2 text-xs font-bold text-white hover:opacity-90"
                  >
                    Mark Ready
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
