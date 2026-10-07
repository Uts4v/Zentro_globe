import { useState, useEffect, useCallback, useRef } from "react";
import { usePosStore, isConnectionError } from "../store";
import { enqueueMutation } from "../offline/sync";
import { cachedServerOrders } from "../offline/db";
import { useOnlineStatus } from "../offline/hooks";
import { isOnline as serverReachable } from "@/lib/connectivity";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
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
  const device = usePosStore((s) => s.device);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  // Accepting and rejecting are queued offline; finding a customer is not possible.
  const offline = !useOnlineStatus();
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
      // Keep the saved copy current, so the Orders screen has today's orders
      // to show if the connection drops before anyone opens it.
      cachedServerOrders.save(data);
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

  /**
   * Change an incoming order's status. With no connection the change is saved
   * on this device and sent when the connection is back (same as the order
   * detail screen). Returns the order as it now stands, or null if it failed.
   */
  async function changeStatus(
    order: PosOrder,
    status: string,
    done: string,
  ): Promise<Partial<PosOrder> | null> {
    if (!currentWorker) {
      toast.error("Enter your PIN first.");
      return null;
    }
    const saveForLater = async () => {
      cachedServerOrders.updateStatus(order.uuid, status);
      await enqueueMutation(
        "order_status",
        "/pos/order/status/",
        "POST",
        {
          order_id: order.uuid,
          status,
          worker_id: currentWorker.id,
          device_id: device?.id,
        },
        `status-${order.uuid}-${Date.now()}`,
      );
      toast.success(`${done} — saved here, will be sent when the connection is back.`);
      return { status };
    };
    try {
      if (!serverReachable()) return await saveForLater();
      const updated = await posUpdateOrderStatus(order.uuid, status, currentWorker.id, device?.id);
      toast.success(done);
      return updated;
    } catch (err: unknown) {
      if (isConnectionError(err)) {
        try {
          return await saveForLater();
        } catch {
          toast.error("No connection, and the change could not be saved. Try again.");
          return null;
        }
      }
      toast.error(
        err instanceof Error && err.message ? err.message : "Could not update the order.",
      );
      fetchOrders();
      return null;
    }
  }

  async function handleAccept(order: PosOrder) {
    if (await changeStatus(order, "confirmed", `Order #${order.id} accepted`)) {
      setIncomingOrders(incomingOrders.filter((o) => o.uuid !== order.uuid));
    }
  }

  async function handleReject(order: PosOrder) {
    if (await changeStatus(order, "cancelled", `Order #${order.id} rejected`)) {
      setIncomingOrders(incomingOrders.filter((o) => o.uuid !== order.uuid));
    }
  }

  async function handleMarkReady(order: PosOrder) {
    const updated = await changeStatus(order, "ready", `Order #${order.id} marked ready`);
    if (updated) {
      setIncomingOrders(
        incomingOrders.map((o) => (o.uuid === order.uuid ? { ...o, ...updated } : o)),
      );
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
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-bold text-destructive-foreground">
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
          aria-label="Refresh incoming orders"
          className="grid h-10 w-10 place-items-center rounded-lg text-muted-foreground hover:bg-amber-100"
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
            const tableName = order.table_name_snapshot?.trim();
            const tableNum = order.table_number_snapshot;
            const tableDisplay = tableName && tableNum != null
              ? tableName.toLowerCase().includes(String(tableNum)) ? tableName : `${tableName} (Table ${tableNum})`
              : tableName
                ? tableName
                : tableNum != null
                  ? `Table ${tableNum}`
                  : order.table_id != null
                    ? `Table ${order.table_id}`
                    : null;

            return (
              <div
                key={order.id}
                className="rounded-xl border border-amber-200 bg-card p-3 shadow-sm"
              >
                {/* Order summary row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-foreground">#{order.id}</span>
                      {tableDisplay && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                          <Utensils className="h-3 w-3" />
                          {tableDisplay}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[order.status] || "bg-muted text-muted-foreground"}`}
                      >
                        {order.status}
                      </span>
                      <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-bold text-ink">
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
                        {tableDisplay ? "Dine-in" : order.fulfillment_type}
                      </span>
                      {tableDisplay && (
                        <span className="flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                          <Utensils className="h-3 w-3" />
                          {tableDisplay}
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
                  <span className="numeric text-sm font-bold text-foreground whitespace-nowrap">
                    {formatCurrency(Number(order.total_amount), currencySymbol)}
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
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-ink hover:underline"
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
                        <span className="font-medium">
                          {formatCurrency(Number(item.subtotal), currencySymbol)}
                        </span>
                      </div>
                    ))}
                    {order.notes && (
                      <p className="mt-1 rounded-lg bg-muted px-2 py-1 text-xs italic text-muted-foreground">
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
                        className="rounded-lg bg-ink px-2 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
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
                            className="flex w-full items-center justify-between rounded-lg bg-card px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-foreground">
                                {c.full_name || c.phone || `#${c.id}`}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                {c.loyalty_points} pts · {c.total_orders}{" "}
                                {c.total_orders === 1 ? "previous order" : "previous orders"}
                              </span>
                            </span>
                            {c.membership_number && (
                              <span className="rounded bg-ink/10 px-1.5 py-0.5 text-xs font-bold text-ink">
                                {c.membership_number}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {custSearch.length >= 2 && custResults.length === 0 && !custSearching && (
                      <p className="text-center text-xs text-muted-foreground">
                        No customers found
                      </p>
                    )}
                    <button
                      onClick={() => {
                        setLinkingOrderId(null);
                        setCustSearch("");
                        setCustResults([]);
                      }}
                      className="w-full text-xs text-muted-foreground hover:underline"
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
                        disabled={offline}
                        title={offline ? "Needs a connection — not available offline" : undefined}
                        className="flex items-center justify-center gap-1 rounded-lg border border-ink/30 bg-ink/5 px-3 py-2 text-xs font-bold text-ink hover:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/90"
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
                        disabled={offline}
                        title={offline ? "Needs a connection — not available offline" : undefined}
                        className="flex items-center justify-center gap-1 rounded-lg border border-ink/30 bg-ink/5 px-3 py-2 text-xs font-bold text-ink hover:bg-ink/10 disabled:cursor-not-allowed disabled:opacity-40"
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
