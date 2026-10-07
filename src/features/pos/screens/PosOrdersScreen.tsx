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
  Printer,
  Ticket,
  WifiOff,
  X,
  Utensils,
} from "lucide-react";
import { usePendingOfflineOrders, useOnlineStatus } from "../offline/hooks";
import { printKOT, type KOTTicketData } from "../printing/kot-markup";
import { tableLabel } from "../printing/table-label";
import { OfflineKOT, OfflineOrder } from "../offline/db";
import { offlineOrderPaid } from "../offline/documents";
import Receipt from "../printing/Receipt";

function getPosOrderTableDisplay(order: PosOrder): string | null {
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

/**
 * The stored offline ticket has no KOT number — the server assigns that on
 * sync — so `printKOT` simply omits the badge. It stores no logo either, so
 * the one from the live merchant is passed in.
 */
function toTicketData(kot: OfflineKOT, merchantLogoUrl?: string | null): KOTTicketData {
  return {
    merchantName: kot.merchantName,
    merchantLogoUrl: merchantLogoUrl ?? null,
    kotNumber: null,
    orderNumber: kot.orderNumber,
    createdAt: kot.createdAt,
    fulfillmentType: kot.fulfillmentType,
    tableName: kot.tableName ?? null,
    tableNumber: kot.tableNumber ?? null,
    customerName: null,
    workerName: kot.workerName ?? null,
    notes: kot.notes ?? "",
    items: kot.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      special_instructions: item.special_instructions ?? "",
      options: item.options ?? [],
    })),
  };
}

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
  const currencySymbol = usePosStore((s) => s.posSettings?.currency_symbol) || "Rs";
  const merchantLogoUrl = usePosStore((s) => s.merchant?.logo_url);
  const isOnline = useOnlineStatus();
  const { orders: offlineOnly, reload: reloadOffline } = usePendingOfflineOrders();
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [billOrder, setBillOrder] = useState<OfflineOrder | null>(null);

  async function loadOrders() {
    // Offline the server list is unreachable. The offline orders below carry
    // the screen, so this is an expected state rather than an error.
    if (!isOnline) {
      setOrders([]);
      setLoading(false);
      return;
    }
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
  }, [activeShift?.id, isOnline]);

  const filtered = orders.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      String(o.id).includes(q) ||
      (o.customer_name ?? "").toLowerCase().includes(q) ||
      (o.table_name_snapshot ?? "").toLowerCase().includes(q)
    );
  });

  // Offline orders are matched on their local reference, the item names, and
  // the table, since there is no order number to search yet.
  const filteredOffline = offlineOnly.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.kot?.orderNumber.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      (o.kot?.tableName ?? "").toLowerCase().includes(q) ||
      o.cart_snapshot.some((item) => item.name.toLowerCase().includes(q))
    );
  });

  const showOffline = filteredOffline.length > 0;
  const isEmpty = filtered.length === 0 && filteredOffline.length === 0;

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
          onClick={() => {
            reloadOffline();
            loadOrders();
          }}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Offline notice */}
      {!isOnline && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="text-xs text-warning">
            <p className="font-semibold">Offline — showing orders from this device</p>
            <p className="mt-0.5 text-warning/80">
              Server orders and the kitchen display are unavailable. Orders you take now are saved
              on this device and sync automatically once the connection is back. Print a bill below
              to hand the customer their copy.
            </p>
          </div>
        </div>
      )}

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

      {isEmpty ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Clock className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Offline orders ── */}
          {showOffline && (
            <>
              <h2 className="flex items-center gap-2 pt-1 text-xs font-bold uppercase tracking-wide text-warning">
                <WifiOff className="h-3.5 w-3.5" />
                On this device — awaiting sync ({filteredOffline.length})
              </h2>

              {filteredOffline.map((order) => (
                <OfflineOrderCard
                  key={order.id}
                  order={order}
                  currencySymbol={currencySymbol}
                  merchantLogoUrl={merchantLogoUrl}
                  onShowBill={() => setBillOrder(order)}
                />
              ))}
            </>
          )}

          {/* ── Server orders ── */}
          {filtered.length > 0 && (
            <>
              {showOffline && (
                <h2 className="flex items-center gap-2 pt-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Synced orders ({filtered.length})
                </h2>
              )}
              {filtered.map((order) => {
                const tableDisplay = getPosOrderTableDisplay(order);
                return (
                <div
                  key={order.uuid ?? order.id}
                  className="rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-foreground">#{order.id}</span>
                        {tableDisplay && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                            <Utensils className="h-3.5 w-3.5" />
                            {tableDisplay}
                          </span>
                        )}
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

                      {tableDisplay && (
                        <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-foreground">
                          <Utensils className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          <span>{tableDisplay}</span>
                        </div>
                      )}

                      <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                        {order.customer_name && <p>Customer: {order.customer_name}</p>}
                        <p>
                          {order.items.length} item(s) —{" "}
                          <span className="numeric">
                            {formatCurrency(Number(order.total_amount), currencySymbol)}
                          </span>
                        </p>
                        <p>
                          Payment:{" "}
                          <span className="font-medium capitalize">{order.payment_status}</span>
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
              );
            })}
            </>
          )}
        </div>
      )}

      {/* Paper bill for an offline order */}
      {billOrder?.bill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <div className="mt-8 w-full max-w-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Bill — {billOrder.kot?.orderNumber ?? "offline order"}
              </span>
              <button
                onClick={() => setBillOrder(null)}
                className="grid h-7 w-7 place-items-center rounded-lg bg-white/15 text-white hover:bg-white/25"
                aria-label="Close bill"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-2xl bg-white p-4">
              <Receipt
                data={billOrder.bill}
                showPrintButton={true}
                currencySymbol={currencySymbol}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Offline order card ───────────────────────────────────────────────────────
function OfflineOrderCard({
  order,
  currencySymbol,
  merchantLogoUrl,
  onShowBill,
}: {
  order: OfflineOrder;
  currencySymbol: string;
  merchantLogoUrl?: string | null;
  onShowBill: () => void;
}) {
  const reference = order.kot?.orderNumber ?? order.id.slice(0, 8).toUpperCase();
  const table = tableLabel(order.kot?.tableName, order.kot?.tableNumber);
  const time = order.kot?.createdAt ?? order.created_at;
  const paid = order.status === "synced" || offlineOrderPaid(order);
  const failed = order.status === "failed";

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-foreground">{reference}</span>
            {table && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                <Utensils className="h-3.5 w-3.5" />
                {table}
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                failed ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning"
              }`}
            >
              {failed ? "SYNC FAILED" : "AWAITING SYNC"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
              offline
            </span>
          </div>

          {table && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-foreground">
              <Utensils className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <span>{table}</span>
            </div>
          )}

          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {order.notes && <p>Notes: {order.notes}</p>}
            <p>
              {time
                ? new Date(time).toLocaleString("en-GB", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })
                : "—"}
            </p>
          </div>

          {/* Line items, so the order is readable on paper without the POS */}
          <ul className="mt-3 space-y-1 border-t border-warning/20 pt-2">
            {order.cart_snapshot.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1 text-foreground">
                  <span className="numeric font-semibold">{item.quantity}×</span> {item.name}
                </span>
                <span className="numeric shrink-0 text-muted-foreground">
                  {formatCurrency(item.subtotal, currencySymbol)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-2 flex items-center justify-between border-t border-warning/20 pt-2 text-xs">
            <span className="font-semibold text-foreground">Total</span>
            <span className="numeric font-bold text-foreground">
              {formatCurrency(order.total, currencySymbol)}
            </span>
          </div>

          <div className="mt-2 text-xs text-muted-foreground">
            Payment:{" "}
            <span className="font-medium capitalize">
              {paid ? (order.bill?.payment_status ?? "paid") : "unpaid — awaiting payment"}
            </span>
          </div>
        </div>

        <Clock className="h-5 w-5 shrink-0 text-warning" />
      </div>

      {/* Print actions */}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-warning/20 pt-3">
        {order.bill && (
          <button
            onClick={onShowBill}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            <Printer className="h-3.5 w-3.5" />
            Bill
          </button>
        )}
        {order.kot && (
          <button
            onClick={() => printKOT(toTicketData(order.kot as OfflineKOT, merchantLogoUrl))}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Ticket className="h-3.5 w-3.5" />
            KOT
          </button>
        )}
      </div>
    </div>
  );
}
