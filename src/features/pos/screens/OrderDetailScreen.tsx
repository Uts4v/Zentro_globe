import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import {
  posListOrdersPaged,
  posReceiptData,
  posUpdateOrderStatus,
  posAddItemsToOrder,
  PosOrder,
  PosReceiptData,
} from "../api";
import { menuApi, type MenuItem } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { cartKey, fromPrice, lineSelectionsText } from "@/lib/menu-utils";
import type { MenuSelection } from "@/lib/api/types";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";
import Receipt from "../printing/Receipt";
import { printKOT, kotTicketFromReceipt, kotTicketFromKOT } from "../printing/kot-markup";
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
  Ticket,
  PackageMinus,
  WifiOff,
  Utensils,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import CustomerSearchModal from "./CustomerSearchModal";
import MinusStockModal from "./MinusStockModal";
import { paymentMethodLabel } from "@/lib/payment-methods";
import { toast } from "sonner";
import { offlineOrders, cachedServerOrders, type OfflineOrder } from "../offline/db";
import { enqueueMutation } from "../offline/sync";
import { useOnlineStatus, useSyncRevision } from "../offline/hooks";
import {
  billFromOfflineOrder,
  kotFromOrder,
  offlineOrderPaid,
  orderNumber,
  receiptFromOrder,
} from "../offline/documents";
import { isOnline as serverReachable } from "@/lib/connectivity";
import { hasStaffPermission } from "@/lib/staff-session";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-info/10 text-info",
  preparing: "bg-warning/10 text-warning",
  ready: "bg-success/10 text-success",
  served: "bg-success/10 text-success",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

const NEEDS_CONNECTION = "Needs a connection — not available offline";

const ORDER_PAGE_SIZE = 20;
const ORDER_SEARCH_DEBOUNCE_MS = 350;

/**
 * An order that so far exists only on this device. Once it has synced it comes
 * back from the server with a real id (and still `source: "pos_offline"`), and
 * is then an ordinary server order.
 */
function isLocalOrder(order: PosOrder) {
  return order.source === "pos_offline" && order.id <= 0;
}

function pageList(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: Array<number | "…"> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push("…");
  for (let n = start; n <= end; n++) out.push(n);
  if (end < totalPages - 1) out.push("…");
  return [...out, totalPages];
}

// Payment can still be collected unless the order is already settled or void.
function canCollectPayment(order: PosOrder) {
  return (
    !["paid", "refunded"].includes(order.payment_status) &&
    !["cancelled", "refunded"].includes(order.status)
  );
}

/**
 * Appending to the bill requires both a workable workflow status *and* an
 * uncollected balance. Once a tender is recorded the collected total is fixed,
 * so new lines would under-charge the customer and desync the recorded payment;
 * the server rejects this too, so the button must not offer it. Refunds go
 * through RefundModal instead of reopening a settled order.
 */
function canAddItems(order: PosOrder) {
  return (
    ["pending", "confirmed", "preparing"].includes(order.status) &&
    !["paid", "partially_paid", "refunded"].includes(order.payment_status) &&
    order.status !== "cancelled"
  );
}

function getOrderDetailTableDisplay(order: PosOrder): string | null {
  const name = order.table_name_snapshot?.trim();
  const num = order.table_number_snapshot;
  if (name && num != null) {
    if (name.toLowerCase().includes(String(num))) {
      return name;
    }
    return `${name} (Table ${num})`;
  }
  if (name) return name;
  if (num != null) return `Table ${num}`;
  if (order.table_id != null) return `Table ${order.table_id}`;
  return null;
}

function offlineOrderToPosOrder(off: OfflineOrder): PosOrder {
  return {
    id: off.server_order_id && off.server_order_id > 0 ? off.server_order_id : -1,
    uuid: off.id,
    customer: off.customer_id ?? null,
    customer_name: off.customer_id ? `Customer #${off.customer_id}` : "Walk-in Guest",
    merchant: off.merchant_id,
    merchant_id: off.merchant_id,
    merchant_name: off.kot?.merchantName || "Zentro",
    status: off.order_status || "confirmed",
    order_type: "dine_in",
    source: "pos_offline",
    fulfillment_type: off.fulfillment_type || "takeaway",
    subtotal: off.bill?.subtotal ?? String(off.total),
    discount_type: "none",
    discount_value: "0.00",
    discount_amount: off.bill?.discount_amount ?? "0.00",
    tax_amount: off.bill?.tax_amount ?? "0.00",
    tax_breakdown: off.bill?.tax_breakdown ?? [],
    service_charge: off.bill?.service_charge ?? "0.00",
    total_amount: String(off.total),
    points_earned: 0,
    payment_status: offlineOrderPaid(off) ? "paid" : "unpaid",
    payment_method: off.bill?.payment_method || "cash",
    notes: off.notes || "",
    items: (off.cart_snapshot || []).map((item, idx) => ({
      id: idx + 1,
      menu_item: off.items?.[idx]?.menu_item_id ?? null,
      name: item.name,
      price: String(item.price),
      quantity: item.quantity,
      subtotal: String(item.subtotal),
    })),
    cancellation_reason: "",
    cancelled_by: "",
    kot_number: null,
    table_id: off.table_id ?? null,
    table_name_snapshot: off.kot?.tableName || (off.table_id ? `Table ${off.table_id}` : ""),
    table_number_snapshot: off.kot?.tableNumber ?? null,
    processed_by_worker: off.worker_id,
    worker_name: off.kot?.workerName || "Staff",
    version: 1,
    created_at: off.created_at,
    updated_at: off.created_at,
  };
}

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
  const [serverSearch, setServerSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [showCollectPayment, setShowCollectPayment] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showAddItems, setShowAddItems] = useState(false);
  const [showMinusStock, setShowMinusStock] = useState(false);
  const [selectedMinusItem, setSelectedMinusItem] = useState<{
    name: string;
    menu_item_id?: number | null;
    quantity?: number;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  // Why the server refused an order taken on this device, by its local id.
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const isOffline = !useOnlineStatus();
  const syncRevision = useSyncRevision();
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const merchant = usePosStore((s) => s.merchant);
  const posSettings = usePosStore((s) => s.posSettings);
  const merchantLogoUrl = usePosStore((s) => s.merchant?.logo_url);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const canEditOrders = hasStaffPermission("orders.edit");
  const canCancelOrders = hasStaffPermission("orders.cancel");
  const canTakePayments = hasStaffPermission("payments.take");
  const canRefund = hasStaffPermission("payments.refund");

  // Debounce the type-ahead: search is pushed to the server while online, so
  // the loaded page only changes after a short pause.
  useEffect(() => {
    const t = setTimeout(() => {
      setServerSearch(search.trim());
      setPage(1);
    }, ORDER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Reload when the connection changes, a sync pass finishes, the page changes
  // or the (debounced) search phrase changes.
  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOffline, syncRevision, page, serverSearch]);

  async function loadOrders(): Promise<PosOrder[]> {
    setLoading(true);
    let serverList: PosOrder[] = [];
    const online = serverReachable();

    if (online) {
      try {
        const res = await posListOrdersPaged(page, ORDER_PAGE_SIZE, serverSearch);
        serverList = res.results;
        setTotalPages(Math.max(res.total_pages, 1));
        setTotalCount(res.count);
        // Fold each fetched page into the saved copy so a later offline search
        // still finds everything this till has already browsed.
        const byUuid = new Map<string, PosOrder>();
        for (const o of cachedServerOrders.get()) byUuid.set(o.uuid, o);
        for (const o of serverList) byUuid.set(o.uuid, o);
        const mergedCache = [...byUuid.values()].sort((a, b) =>
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
        );
        cachedServerOrders.save(mergedCache);
      } catch {
        serverList = cachedServerOrders.get();
        setTotalPages(1);
        setTotalCount(serverList.length);
      }
    } else {
      serverList = cachedServerOrders.get();
      setTotalPages(1);
      setTotalCount(serverList.length);
    }

    let merged = serverList;
    try {
      // A synced order is on the server (and in its list) under its own id,
      // so only the ones still waiting are shown from this device.
      const captured = await offlineOrders.getAll();
      const waiting = captured
        .filter((o) => o.status !== "synced")
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const serverUuidOf = new Map(captured.map((o) => [o.id, o.server_order_uuid]));
      setSyncErrors(
        Object.fromEntries(
          waiting.filter((o) => o.status === "failed").map((o) => [o.id, o.sync_error || ""]),
        ),
      );

      merged = [...waiting.map(offlineOrderToPosOrder), ...serverList];
      setOrders(merged);

      setSelectedOrder((prev) => {
        if (prev) {
          // An order open on screen while it syncs carries on as the server's copy.
          return (
            merged.find((o) => o.uuid === prev.uuid) ??
            merged.find((o) => o.uuid === serverUuidOf.get(prev.uuid)) ??
            prev
          );
        }
        return (orderId && merged.find((o) => o.id === orderId)) || null;
      });
    } catch {
      setOrders(serverList);
      if (serverList.length > 0 && !selectedOrder && orderId) {
        setSelectedOrder(serverList.find((o) => o.id === orderId) || null);
      }
    } finally {
      setLoading(false);
    }
    return merged;
  }

  /**
   * The bill and the kitchen ticket normally come from the server. Offline —
   * or for an order that only exists on this device — they are built here from
   * what is saved, so both can always be printed.
   */
  async function handleViewReceipt(order: PosOrder) {
    setLoadingReceipt(true);
    try {
      const local = isLocalOrder(order) ? await offlineOrders.get(order.uuid) : undefined;
      if (local) {
        setReceiptData(billFromOfflineOrder(local, merchant));
        return;
      }
      if (!serverReachable()) {
        setReceiptData(receiptFromOrder(order, merchant));
        return;
      }
      try {
        setReceiptData(await posReceiptData(String(order.uuid)));
      } catch (err: any) {
        if (!serverReachable()) setReceiptData(receiptFromOrder(order, merchant));
        else toast.error(err?.message || "Could not load the receipt.");
      }
    } catch {
      toast.error("Could not open the bill.");
    } finally {
      setLoadingReceipt(false);
    }
  }

  async function handlePrintKOT(order: PosOrder) {
    setLoadingReceipt(true);
    try {
      const local = isLocalOrder(order) ? await offlineOrders.get(order.uuid) : undefined;
      if (local?.kot) {
        printKOT({
          ...local.kot,
          merchantLogoUrl: merchantLogoUrl ?? null,
          kotNumber: local.kot.kotNumber ?? null,
          customerName: local.kot.customerName ?? null,
        });
        return;
      }
      if (local || !serverReachable()) {
        printKOT({
          ...kotFromOrder(order, merchant),
          merchantLogoUrl: merchantLogoUrl ?? null,
        });
        return;
      }
      try {
        const receipt = await posReceiptData(String(order.uuid));
        if (receipt.kots && receipt.kots.length > 0) {
          const latestKot = receipt.kots[receipt.kots.length - 1];
          printKOT(
            kotTicketFromKOT(latestKot, {
              id: order.id,
              merchant_name: receipt.merchant?.name,
              merchant_logo_url: merchantLogoUrl ?? null,
              worker_name: receipt.worker_name ?? undefined,
            }),
          );
        } else {
          const ticket = kotTicketFromReceipt(receipt);
          printKOT({
            ...ticket,
            merchantLogoUrl: merchantLogoUrl ?? null,
          });
        }
      } catch (err: any) {
        if (!serverReachable()) {
          printKOT({
            ...kotFromOrder(order, merchant),
            merchantLogoUrl: merchantLogoUrl ?? null,
          });
        } else toast.error(err?.message || "Could not load the KOT.");
      }
    } catch {
      toast.error("Could not print the KOT.");
    } finally {
      setLoadingReceipt(false);
    }
  }

  async function handleStatusChange(order: PosOrder, newStatus: string) {
    setStatusLoading(true);
    const local = isLocalOrder(order);

    /**
     * Record the change on this device and queue it for the server. An order
     * that has not synced yet is queued under its local id; the sync engine
     * sends it after the order itself and points it at the server's order.
     */
    const saveForLater = async () => {
      if (local) await offlineOrders.updateStatus(order.uuid, newStatus);
      else cachedServerOrders.updateStatus(order.uuid, newStatus);
      await enqueueMutation(
        "order_status",
        "/pos/order/status/",
        "POST",
        {
          order_id: order.uuid,
          status: newStatus,
          worker_id: currentWorker?.id,
          device_id: device?.id,
        },
        `status-${order.uuid}-${Date.now()}`,
      );
      setOrders((prev) =>
        prev.map((o) => (o.uuid === order.uuid ? { ...o, status: newStatus } : o)),
      );
      setSelectedOrder((prev) =>
        prev?.uuid === order.uuid ? { ...prev, status: newStatus } : prev,
      );
      toast.success(`Order marked as ${newStatus} (Saved offline)`);
    };

    try {
      if (local || !serverReachable()) {
        try {
          await saveForLater();
        } catch (err: any) {
          toast.error("Failed to update status offline: " + (err?.message || "Unknown error"));
        }
        return;
      }

      try {
        const updatedOrder = await posUpdateOrderStatus(
          String(order.uuid),
          newStatus,
          currentWorker?.id,
          device?.id,
        );
        setOrders((prev) =>
          prev.map((o) => (o.uuid === order.uuid ? { ...o, ...updatedOrder } : o)),
        );
        setSelectedOrder((prev) =>
          prev?.uuid === order.uuid ? { ...prev, ...updatedOrder } : prev,
        );
        cachedServerOrders.updateStatus(order.uuid, newStatus);
        toast.success(`Order marked as ${newStatus}`);
      } catch (err: any) {
        if (!serverReachable()) {
          try {
            await saveForLater();
          } catch {
            toast.error("Network failed and could not save offline.");
          }
        } else {
          toast.error(err?.message || "Failed to update order status.");
        }
      }
    } finally {
      setStatusLoading(false);
    }
  }

  function getNextActions(status: string): Array<{
    label: string;
    next: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }> {
    switch (status) {
      case "pending":
        return [
          {
            label: "Confirm Order",
            next: "confirmed",
            color: "bg-primary text-primary-foreground hover:bg-primary-hover",
            icon: Check,
          },
        ];
      case "confirmed":
        return [
          {
            label: "Start Preparing",
            next: "preparing",
            color: "bg-warning text-primary-foreground hover:opacity-90",
            icon: Play,
          },
          {
            label: "Ready",
            next: "ready",
            color: "bg-primary text-primary-foreground hover:bg-primary-hover",
            icon: PackageCheck,
          },
        ];
      case "preparing":
        return [
          {
            label: "Mark Ready",
            next: "ready",
            color: "bg-primary text-primary-foreground hover:bg-primary-hover",
            icon: PackageCheck,
          },
        ];
      case "ready":
        return [
          {
            label: "Complete Order",
            next: "completed",
            color: "bg-primary text-primary-foreground hover:bg-primary-hover",
            icon: CheckCircle2,
          },
        ];
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
    const tableDisplay = getOrderDetailTableDisplay(order);
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
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-foreground">Order {orderNumber(order)}</h2>
                {tableDisplay && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    <Utensils className="h-3.5 w-3.5" />
                    {tableDisplay}
                  </span>
                )}
                {isLocalOrder(order) &&
                  (order.uuid in syncErrors ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-bold text-destructive">
                      Sync failed
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                      ⚡ Offline / Pending Sync
                    </span>
                  ))}
                {order.kot_number && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ember-soft px-2.5 py-0.5 text-xs font-extrabold text-ember">
                    <Ticket className="h-3 w-3" />
                    KOT #{String(order.kot_number).padStart(3, "0")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(order.created_at).toLocaleString("en-MY")}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"
              }`}
            >
              {order.status.toUpperCase()}
            </span>
          </div>

          {isLocalOrder(order) && order.uuid in syncErrors && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <p className="font-semibold">The server did not accept this order.</p>
              {syncErrors[order.uuid] && <p className="mt-0.5">{syncErrors[order.uuid]}</p>}
              <p className="mt-0.5">
                It is still saved on this device. Use Retry in the sync bar once the problem is
                fixed, or re-enter the order.
              </p>
            </div>
          )}

          {/* Info grid */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Type</p>
              <p className="font-medium capitalize">{order.fulfillment_type.replace(/_/g, " ")}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Source</p>
              <p className="font-medium capitalize">{order.source}</p>
            </div>
            {order.customer_name && (
              <div className="rounded-xl bg-muted/50 p-3">
                <p className="text-xs uppercase text-muted-foreground">Customer</p>
                <p className="font-medium">{order.customer_name}</p>
              </div>
            )}
            {tableDisplay && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3">
                <p className="text-xs uppercase font-bold text-amber-700 dark:text-amber-400">
                  Table
                </p>
                <p className="font-bold text-foreground">{tableDisplay}</p>
              </div>
            )}
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Payment</p>
              <p className="font-medium capitalize">{order.payment_status}</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <p className="text-xs uppercase text-muted-foreground">Method</p>
              <p className="font-medium">{paymentMethodLabel(order.payment_method)}</p>
            </div>
          </div>

          {/* Items */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Items</h3>
            <div className="divide-y divide-border rounded-xl border border-border">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} x {formatCurrency(Number(item.price), currencySymbol)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-bold text-ink">
                      {formatCurrency(Number(item.subtotal), currencySymbol)}
                    </p>
                    {["dine_in", "dine-in"].includes(order.fulfillment_type?.toLowerCase()) &&
                      order.status !== "cancelled" &&
                      !isLocalOrder(order) && (
                        <button
                          type="button"
                          disabled={isOffline}
                          onClick={() => {
                            setSelectedMinusItem({
                              name: item.name,
                              menu_item_id: (item as any).menu_item_id ?? null,
                              quantity: item.quantity,
                            });
                            setShowMinusStock(true);
                          }}
                          title={isOffline ? NEEDS_CONNECTION : "Minus stock for this item"}
                          className="flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <PackageMinus className="h-3.5 w-3.5" />
                          <span>Minus Stock</span>
                        </button>
                      )}
                  </div>
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
              <div className="flex justify-between text-success">
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
            {/* Add Items button, only while the bill is still open and unpaid.
                The server prices the added lines, so it needs a connection and
                an order the server already has. */}
            {canAddItems(order) && canEditOrders && !isLocalOrder(order) && (
              <button
                onClick={() => setShowAddItems(true)}
                disabled={isOffline}
                title={isOffline ? NEEDS_CONNECTION : undefined}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink/30 py-2.5 text-sm font-bold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
                Add Items to This Order
              </button>
            )}

            {/* Minus Stock button for Dine-In orders */}
            {["dine_in", "dine-in"].includes(order.fulfillment_type?.toLowerCase()) &&
              order.status !== "cancelled" &&
              !isLocalOrder(order) && (
                <button
                  type="button"
                  disabled={isOffline}
                  title={isOffline ? NEEDS_CONNECTION : undefined}
                  onClick={() => {
                    setSelectedMinusItem(null);
                    setShowMinusStock(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 py-3 text-sm font-bold text-destructive transition-colors hover:bg-destructive/20 shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PackageMinus className="h-4 w-4" />
                  Minus Stock
                </button>
              )}

            {/* Status transition buttons */}
            {canEditOrders && getNextActions(order.status).length > 0 && (
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
            {canCollectPayment(order) && canTakePayments && (
              <button
                onClick={() => setShowCollectPayment(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
              >
                <CreditCard className="h-4 w-4" />
                Collect Payment — {formatCurrency(Number(order.total_amount), currencySymbol)}
              </button>
            )}

            <div className="flex gap-3">
              {Boolean(order.kot_number || isLocalOrder(order) || (order as any).kots?.length) && (
                <button
                  onClick={() => handlePrintKOT(order)}
                  disabled={loadingReceipt}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-ink/20 py-2.5 text-sm font-medium text-ink hover:bg-ink/5 disabled:opacity-50"
                >
                  {loadingReceipt ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Ticket className="h-4 w-4" />
                  )}
                  Print KOT
                </button>
              )}
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
                {order.payment_status === "paid" ? "View Receipt" : "View Bill"}
              </button>
              {order.payment_status === "paid" && !isLocalOrder(order) && canRefund && (
                <button
                  onClick={() => setShowRefund(true)}
                  disabled={isOffline}
                  title={isOffline ? NEEDS_CONNECTION : undefined}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-destructive/30 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" />
                  Refund
                </button>
              )}
              {!["cancelled", "completed", "refunded"].includes(order.status) &&
                canCancelOrders && (
                  <button
                    onClick={() => {
                      if (window.confirm("Are you sure you want to cancel this order?")) {
                        handleStatusChange(order, "cancelled");
                      }
                    }}
                    disabled={statusLoading || isOffline}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-destructive/30 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel Order
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
            onRefunded={() => {
              setShowRefund(false);
              loadOrders();
            }}
          />
        )}

        {/* Collect Payment Sheet */}
        {showCollectPayment && (
          <CollectPaymentSheet
            order={order}
            onClose={() => setShowCollectPayment(false)}
            onPaid={(update) => {
              setShowCollectPayment(false);
              // Apply the server-reported payment state right away so the
              // Collect Payment button disappears, then refresh everything.
              if (update) {
                setSelectedOrder((prev) =>
                  prev?.uuid === order.uuid ? { ...prev, ...update } : prev,
                );
                setOrders((prev) =>
                  prev.map((o) => (o.uuid === order.uuid ? { ...o, ...update } : o)),
                );
              }
              loadOrders();
            }}
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

        {/* Add Items Modal. Re-checked here because the order can be settled by
            another till (or this one) while the modal is open. */}
        {showAddItems && selectedOrder && canAddItems(selectedOrder) && (
          <AddItemsModal
            order={selectedOrder}
            onAdded={async () => {
              setShowAddItems(false);
              // Reloads the current page; selectedOrder is re-resolved from the
              // fresh list by loadOrders.
              await loadOrders();
            }}
            onClose={() => setShowAddItems(false)}
          />
        )}

        {/* Minus Stock Modal */}
        {showMinusStock && selectedOrder && (
          <MinusStockModal
            open={showMinusStock}
            onClose={() => {
              setShowMinusStock(false);
              setSelectedMinusItem(null);
            }}
            orderId={selectedOrder.id}
            tableName={selectedOrder.table_name_snapshot}
            initialItem={selectedMinusItem}
            orderItems={selectedOrder.items.map((item) => ({
              name: item.name,
              menu_item_id: (item as any).menu_item_id ?? null,
              quantity: item.quantity,
            }))}
            onStockDeducted={() => {
              loadOrders();
            }}
          />
        )}
      </div>
    );
  }

  // ── Orders list ──
  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">Orders</h1>
          {isOffline && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <WifiOff className="h-3.5 w-3.5" />
              Offline Mode
            </span>
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

      {isOffline && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-500" />
          <span>
            Operating offline. Orders created or updated locally will auto-sync when connection is
            restored.
          </span>
        </div>
      )}

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by order #, customer..."
          aria-label="Search orders"
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
                (o.uuid ?? "").toLowerCase().includes(q) ||
                (o.customer_name ?? "").toLowerCase().includes(q) ||
                (o.table_name_snapshot ?? "").toLowerCase().includes(q) ||
                String(o.table_number_snapshot ?? "").includes(q)
              );
            })
            .map((order) => {
              const isOfflineOrder = isLocalOrder(order);
              const syncFailed = isOfflineOrder && order.uuid in syncErrors;
              const tableDisplay = getOrderDetailTableDisplay(order);
              return (
                <button
                  key={order.uuid || order.id}
                  onClick={() => setSelectedOrder(order)}
                  className="w-full rounded-2xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-foreground">
                          {orderNumber(order)}
                        </span>
                        {tableDisplay && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                            <Utensils className="h-3.5 w-3.5" />
                            {tableDisplay}
                          </span>
                        )}
                        {isOfflineOrder &&
                          (syncFailed ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive">
                              Sync failed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                              ⚡ Pending Sync
                            </span>
                          ))}
                        {order.kot_number && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-ember-soft px-2 py-0.5 text-xs font-bold text-ember">
                            <Ticket className="h-2.5 w-2.5" />
                            KOT {String(order.kot_number).padStart(3, "0")}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            STATUS_COLORS[order.status] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {order.status.toUpperCase()}
                        </span>
                        {canCollectPayment(order) && (
                          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning">
                            {order.payment_status === "partially_paid" ? "PART PAID" : "UNPAID"}
                          </span>
                        )}
                      </div>
                      {tableDisplay && (
                        <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-bold text-foreground">
                          <Utensils className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          <span>{tableDisplay}</span>
                        </div>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {order.customer_name || "Walk-in"} · {order.items.length} item(s) —{" "}
                        {formatCurrency(Number(order.total_amount), currencySymbol)}
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
              );
            })}
        </div>
      )}

      {!isOffline && totalPages > 1 && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            {pageList(page, totalPages).map((n, i) =>
              n === "…" ? (
                <span key={`e${i}`} className="px-1 text-sm text-muted-foreground">
                  {"\u2026"}
                </span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  aria-label={`Go to page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={`h-9 min-w-9 rounded-xl px-3 text-sm font-medium ${
                    n === page
                      ? "bg-ink text-white"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="flex h-9 items-center gap-1 rounded-xl border border-border px-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} &middot; {totalCount}{" "}
            {totalCount === 1 ? "order" : "orders"}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Add Items Modal ─────────────────────────────────────────────────────────
type AddToOrderLine = {
  key: string;
  item: MenuItem;
  qty: number;
  unitPrice: number;
  selections: MenuSelection[];
  special_instructions: string;
};

/**
 * A product needs the detail sheet when it publishes any *active* option group.
 * Sending it straight through means the server rejects the unselected required
 * group ("choose one option for Big cup") and there is no picker to fix it with.
 */
function needsOptions(item: MenuItem): boolean {
  return (item.groups ?? []).some((g) => g.is_active !== false);
}

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
  const [cart, setCart] = useState<AddToOrderLine[]>([]);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
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

  /** Append a configured line, merging only into an identical configuration. */
  function pushLine(line: AddToOrderLine) {
    setCart((prev) => {
      const hit = prev.find((c) => c.key === line.key);
      if (hit) {
        return prev.map((c) => (c.key === line.key ? { ...c, qty: c.qty + line.qty } : c));
      }
      return [...prev, line];
    });
  }
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function addToCart(item: MenuItem) {
    if (needsOptions(item)) {
      setDetailItem(item);
      return;
    }
    pushLine({
      key: cartKey(String(item.id), [], ""),
      item,
      qty: 1,
      unitPrice: fromPrice(item),
      selections: [],
      special_instructions: "",
    });
  }

  function handleSheetAdd(draft: ProductDraft) {
    if (!detailItem) return;
    pushLine({
      key: cartKey(String(detailItem.id), draft.selections, draft.specialInstructions),
      item: detailItem,
      qty: draft.qty,
      unitPrice: draft.unitPrice,
      selections: draft.selections,
      special_instructions: draft.specialInstructions,
    });
    setDetailItem(null);
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev.flatMap((c) => {
        if (c.key !== key) return [c];
        const qty = c.qty + delta;
        return qty <= 0 ? [] : [{ ...c, qty }];
      }),
    );
  }

  const total = cart.reduce((sum, c) => sum + c.unitPrice * c.qty, 0);

  async function handleSubmit() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError("");
    try {
      await posAddItemsToOrder(
        order.id,
        // Selections and instructions must ride along: the server prices from
        // them, so omitting them either 400s or bills the base configuration.
        cart.map((c) => ({
          menu_item_id: Number(c.item.id),
          quantity: c.qty,
          selections: c.selections,
          special_instructions: c.special_instructions,
        })),
      );
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-items-title"
        className="mx-4 flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 id="add-items-title" className="text-sm font-bold text-foreground">
              Add items to #{order.id}
            </h3>
            <p className="numeric text-xs text-muted-foreground">
              Current total: {formatCurrency(Number(order.total_amount), currencySymbol)}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-2.5 text-muted-foreground hover:bg-muted"
          >
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
              aria-label="Search menu"
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
            <p className="py-8 text-center text-xs text-destructive">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">No items found</p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((item) => {
                const inCart = cart.find((c) => c.key === cartKey(String(item.id), [], ""));
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                  >
                    <span className="text-lg">{item.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground truncate">{item.name}</p>
                      <p className="numeric text-[11px] text-muted-foreground">
                        {needsOptions(item) ? "from " : ""}
                        {formatCurrency(fromPrice(item), currencySymbol)}
                      </p>
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => changeQty(inCart.key, -1)}
                          aria-label={`Remove one ${item.name}`}
                          className="grid h-9 w-9 place-items-center rounded-md bg-muted text-foreground"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold">{inCart.qty}</span>
                        <button
                          onClick={() => changeQty(inCart.key, 1)}
                          aria-label={`Add one ${item.name}`}
                          className="grid h-9 w-9 place-items-center rounded-md bg-ink text-white"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addToCart(item)}
                        className="min-h-[40px] rounded-lg bg-ink/10 px-3 text-xs font-bold text-ink hover:bg-ink/20"
                      >
                        {needsOptions(item) ? "Options" : "Add"}
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
                <div key={c.key} className="flex justify-between gap-2">
                  <span className="min-w-0 text-muted-foreground">
                    {c.qty}× {c.item.name}
                    {c.selections.length > 0 && (
                      <span className="block text-[10px] text-muted-foreground/80">
                        {lineSelectionsText(c.item, c.selections)}
                      </span>
                    )}
                    {c.special_instructions && (
                      <span className="block text-[10px] italic text-muted-foreground/80">
                        {c.special_instructions}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium">
                    {formatCurrency(c.unitPrice * c.qty, currencySymbol)}
                  </span>
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
            {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to order ·{" "}
              <span className="numeric">{formatCurrency(total, currencySymbol)}</span>
            </button>
          </div>
        )}
      </div>

      {/* Variant / modifier capture, shared with the main POS grid so both
          order entry points price and record configurations identically. */}
      <ProductDetailSheet
        open={!!detailItem}
        item={detailItem}
        currencySymbol={currencySymbol}
        onClose={() => setDetailItem(null)}
        onAdd={handleSheetAdd}
        submitLabel="Add to order"
      />
    </div>
  );
}
