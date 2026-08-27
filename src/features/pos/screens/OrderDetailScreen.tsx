import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { posListOrders, posReceiptData, posUpdateOrderStatus, posAddItemsToOrder, PosOrder, PosReceiptData } from "../api";
import { menuApi, type MenuItem } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import Receipt from "../printing/Receipt";
import RefundModal from "./RefundModal";
import CollectPaymentSheet from "./CollectPaymentSheet";
import {
  ArrowLeft,
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Printer,
  Receipt as ReceiptIcon,
  Loader2,
  RotateCcw,
  UserPlus,
  Check,
  Play,
  PackageCheck,
  CreditCard,
  Plus,
  Minus,
  X,
} from "lucide-react";
import CustomerSearchModal from "./CustomerSearchModal";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  confirmed: "bg-blue-100 text-blue-700",
  preparing: "bg-orange-100 text-orange-700",
  ready: "bg-green-100 text-green-700",
  served: "bg-green-100 text-green-700",
  completed: "bg-gray-100 text-gray-600",
  cancelled: "bg-red-100 text-red-600",
};

export default function OrderDetailScreen({
  orderId,
  onBack,
}: {
  orderId: number;
  onBack: () => void;
}) {
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<PosOrder | null>(null);
  const [search, setSearch] = useState("");
  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [showCollectPayment, setShowCollectPayment] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showAddItems, setShowAddItems] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    setLoading(true);
    try {
      const data = await posListOrders();
      setOrders(data);
      // If a specific orderId was requested, select it
      if (orderId) {
        const found = data.find((o) => o.id === orderId);
        if (found) setSelectedOrder(found);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleViewReceipt(order: PosOrder) {
    setLoadingReceipt(true);
    try {
      const data = await posReceiptData(String(order.uuid));
      setReceiptData(data);
    } catch {
      // ignore
    } finally {
      setLoadingReceipt(false);
    }
  }

  async function handleStatusChange(order: PosOrder, newStatus: string) {
    setStatusLoading(true);
    try {
      const updatedOrder = await posUpdateOrderStatus(
        String(order.uuid),
        newStatus,
        currentWorker?.id,
        device?.id
      );
      setOrders((prev) => prev.map((o) => o.uuid === order.uuid ? { ...o, ...updatedOrder } : o));
      setSelectedOrder((prev) => prev?.uuid === order.uuid ? { ...prev, ...updatedOrder } : prev);
    } catch (err: any) {
      // Backend saves status before audit log, so a 500 from audit
      // means the status WAS updated. Always refresh to get truth.
      const updated = await posListOrders();
      setOrders(updated);
      if (orderId || selectedOrder) {
        const refreshed = updated.find((o) => o.id === (selectedOrder?.id ?? orderId));
        setSelectedOrder(refreshed ?? null);
      }
    } finally {
      setStatusLoading(false);
    }
  }

  function getNextActions(status: string): Array<{ label: string; next: string; color: string; icon: React.ComponentType<{ className?: string }> }> {
    switch (status) {
      case "pending":
        return [{ label: "Confirm Order", next: "confirmed", color: "bg-blue-600 text-white hover:bg-blue-700", icon: Check }];
      case "confirmed":
        return [
          { label: "Start Preparing", next: "preparing", color: "bg-orange-500 text-white hover:bg-orange-600", icon: Play },
          { label: "Ready", next: "ready", color: "bg-green-600 text-white hover:bg-green-700", icon: PackageCheck },
        ];
      case "preparing":
        return [{ label: "Mark Ready", next: "ready", color: "bg-green-600 text-white hover:bg-green-700", icon: PackageCheck }];
      case "ready":
        return [{ label: "Complete Order", next: "completed", color: "bg-green-700 text-white hover:bg-green-800", icon: CheckCircle2 }];
      default:
        return [];
    }
  }

  // ── Receipt view ──
  if (receiptData) {
    return (
      <div className="mx-auto max-w-2xl p-4 lg:p-6">
        <button
          onClick={() => setReceiptData(null)}
          className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to orders
        </button>
        <div className="flex justify-center">
          <Receipt data={receiptData} showPrintButton={true} currencySymbol={currencySymbol} />
        </div>
      </div>
    );
  }

  // ── Single order detail view ──
  if (selectedOrder) {
    const order = selectedOrder;
    return (
      <div className="mx-auto max-w-2xl p-4 lg:p-6">
        <button
          onClick={() => setSelectedOrder(null)}
          className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to orders
        </button>

        <div className="rounded-2xl border border-border bg-card p-6">
          {/* Header */}
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-foreground">
                Order #{order.id}
              </h2>
              <p className="text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleString("en-MY")}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"
              }`}
            >
              {order.status.toUpperCase()}
            </span>
          </div>

          {/* Info grid */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Type</p>
              <p className="font-medium capitalize">{order.fulfillment_type}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Source</p>
              <p className="font-medium capitalize">{order.source}</p>
            </div>
            {order.customer_name && (
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Customer</p>
                <p className="font-medium">{order.customer_name}</p>
              </div>
            )}
            {order.table_name_snapshot && (
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Table</p>
                <p className="font-medium">{order.table_name_snapshot}</p>
              </div>
            )}
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Payment</p>
              <p className="font-medium capitalize">{order.payment_status}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Method</p>
              <p className="font-medium capitalize">
                {order.payment_method || "-"}
              </p>
            </div>
          </div>

          {/* Items */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">
              Items
            </h3>
            <div className="divide-y divide-border rounded-xl border border-border">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} x {formatCurrency(Number(item.price), currencySymbol)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-ink">
                    {formatCurrency(Number(item.subtotal), currencySymbol)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1.5 border-t border-border pt-4 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatCurrency(Number(order.subtotal), currencySymbol)}</span>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Discount</span>
                <span>-{formatCurrency(Number(order.discount_amount), currencySymbol)}</span>
              </div>
            )}
            {Number(order.tax_amount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>VAT</span>
                <span>{formatCurrency(Number(order.tax_amount), currencySymbol)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 font-bold text-foreground">
              <span>Total</span>
              <span>{formatCurrency(Number(order.total_amount), currencySymbol)}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 space-y-3">
            {/* Add Items button for active orders */}
            {["pending", "confirmed", "preparing"].includes(order.status) && (
              <button
                onClick={() => setShowAddItems(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink/30 py-2.5 text-sm font-bold text-ink hover:bg-ink/5"
              >
                <Plus className="h-4 w-4" />
                Add Items to This Order
              </button>
            )}

            {/* Status transition buttons */}
            {getNextActions(order.status).length > 0 && (
              <div className="flex gap-2">
                {getNextActions(order.status).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.next}
                      onClick={() => handleStatusChange(order, action.next)}
                      disabled={statusLoading}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-colors ${action.color}`}
                    >
                      {statusLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Pay button for unpaid orders */}
            {order.payment_status !== "paid" && order.status !== "cancelled" && (
              <button
                onClick={() => setShowCollectPayment(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700"
              >
                <CreditCard className="h-4 w-4" />
                Collect Payment — {formatCurrency(Number(order.total_amount), currencySymbol)}
              </button>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => handleViewReceipt(order)}
                disabled={loadingReceipt}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                {loadingReceipt ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ReceiptIcon className="h-4 w-4" />
                )}
                View Receipt
              </button>
              {order.payment_status === "paid" && (
                <button
                  onClick={() => setShowRefund(true)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Refund
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Refund Modal */}
        {showRefund && (
          <RefundModal
            order={order}
            onClose={() => setShowRefund(false)}
            onRefunded={() => { setShowRefund(false); loadOrders(); }}
          />
        )}

        {/* Collect Payment Sheet */}
        {showCollectPayment && (
          <CollectPaymentSheet
            order={order}
            onClose={() => setShowCollectPayment(false)}
            onPaid={() => { setShowCollectPayment(false); loadOrders(); }}
          />
        )}

        {/* Customer Search Modal */}
        {showCustomerSearch && (
          <CustomerSearchModal
            onSelect={(customer) => {
              setShowCustomerSearch(false);
            }}
            onClose={() => setShowCustomerSearch(false)}
          />
        )}

        {/* Add Items Modal */}
        {showAddItems && selectedOrder && (
          <AddItemsModal
            order={selectedOrder}
            onAdded={async () => {
              setShowAddItems(false);
              setLoading(true);
              try {
                const fresh = await posListOrders();
                setOrders(fresh);
                const updated = fresh.find((o) => o.id === selectedOrder.id);
                if (updated) setSelectedOrder(updated);
              } catch { /* ignore */ } finally {
                setLoading(false);
              }
            }}
            onClose={() => setShowAddItems(false)}
          />
        )}
      </div>
    );
  }

  // ── Orders list ──
  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Orders</h1>
        <button
          onClick={loadOrders}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by order #, customer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-muted/50 py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders
            .filter((o) => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                String(o.id).includes(q) ||
                (o.customer_name ?? "").toLowerCase().includes(q)
              );
            })
            .map((order) => (
              <button
                key={order.id}
                onClick={() => setSelectedOrder(order)}
                className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">
                        #{order.id}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {order.status.toUpperCase()}
                      </span>
                      {order.payment_status !== "paid" && order.status !== "cancelled" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          {order.payment_status === "partially_paid" ? "PART PAID" : "UNPAID"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order.customer_name || "Walk-in"} · {order.items.length} item(s) — {formatCurrency(Number(order.total_amount), currencySymbol)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(order.created_at).toLocaleTimeString("en-MY", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Add Items Modal ─────────────────────────────────────────────────────────
function AddItemsModal({
  order,
  onAdded,
  onClose,
}: {
  order: PosOrder;
  onAdded: () => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<{ item: MenuItem; qty: number }[]>([]);
  const [search, setSearch] = useState("");
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  useEffect(() => {
    async function load() {
      try {
        const items = await menuApi.forMerchant(String(order.merchant));
        setMenu(items.filter((i) => i.is_available));
      } catch {
        setError("Failed to load menu");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [order.merchant]);

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) return prev.map((c) => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { item, qty: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === itemId);
      if (!existing) return prev;
      if (existing.qty === 1) return prev.filter((c) => c.item.id !== itemId);
      return prev.map((c) => c.item.id === itemId ? { ...c, qty: c.qty - 1 } : c);
    });
  }

  const total = cart.reduce((sum, c) => sum + Number(c.item.price) * c.qty, 0);

  async function handleSubmit() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      await posAddItemsToOrder(order.id, cart.map((c) => ({
        menu_item_id: Number(c.item.id),
        quantity: c.qty,
      })));
      onAdded();
    } catch (e: any) {
      setError(e.message || "Failed to add items");
      setSubmitting(false);
    }
  }

  const filtered = search
    ? menu.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : menu;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-bold text-foreground">Add items to #{order.id}</h3>
            <p className="text-[11px] text-muted-foreground">Current total: {formatCurrency(Number(order.total_amount), currencySymbol)}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search menu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-ink focus:outline-none"
            />
          </div>
        </div>

        {/* Menu items */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error && menu.length === 0 ? (
            <p className="py-8 text-center text-xs text-red-500">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No items found</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((item) => {
                const inCart = cart.find((c) => c.item.id === item.id);
                return (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                    <span className="text-lg">{item.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{formatCurrency(Number(item.price), currencySymbol)}</p>
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => removeFromCart(item.id)} className="grid h-6 w-6 place-items-center rounded-md bg-muted text-foreground">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center text-xs font-bold">{inCart.qty}</span>
                        <button onClick={() => addToCart(item)} className="grid h-6 w-6 place-items-center rounded-md bg-ink text-white">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(item)} className="rounded-lg bg-ink/10 px-3 py-1 text-[10px] font-bold text-ink hover:bg-ink/20">
                        Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart summary + submit */}
        {cart.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <div className="mb-2 space-y-1 text-xs">
              {cart.map((c) => (
                <div key={c.item.id} className="flex justify-between">
                  <span className="text-muted-foreground">{c.qty}× {c.item.name}</span>
                  <span className="font-medium">{formatCurrency(Number(c.item.price) * c.qty, currencySymbol)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-1 font-bold text-foreground">
                <span>New items</span>
                <span>{formatCurrency(total, currencySymbol)}</span>
              </div>
              <div className="flex justify-between font-bold text-foreground">
                <span>New total</span>
                <span>{formatCurrency(Number(order.total_amount) + total, currencySymbol)}</span>
              </div>
            </div>
            {error && (
              <p className="mb-2 text-xs text-red-500">{error}</p>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 py-2.5 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to order · {formatCurrency(total, currencySymbol)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
