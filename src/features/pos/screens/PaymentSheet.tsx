import { useState, useEffect, useMemo } from "react";
import { safeUuid } from "@/lib/utils";
import { usePosStore, cartToOrderItems } from "../store";
import {
  posCreateOrder,
  posCreatePayment,
  posReceiptData,
  PosReceiptData,
  posListDebitAccounts,
  DebitAccount,
} from "../api";
import { formatCurrency, calculateTax, roundMoney } from "@/lib/currency";
import Receipt from "../printing/Receipt";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-methods";
import KOTTicket, { kotTicketFromReceipt, printKOT, KOTTicketData } from "../printing/KOTTicket";
import { enqueueMutation } from "../offline/sync";
import { useOnlineStatus } from "../offline/hooks";
import { offlineOrders, offlinePayments } from "../offline/db";
import type { MenuOptionGroup, MenuSelection } from "@/lib/api/types";
import {
  X,
  Banknote,
  CreditCard,
  Smartphone,
  QrCode,
  Wallet,
  Check,
  Loader2,
  Receipt as ReceiptIcon,
  ShoppingBag,
  Ticket,
} from "lucide-react";

interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}

type PaymentMethod = "cash" | "card" | "bank_qr" | "mobile_wallet" | "debit";

/**
 * Fallback list for merchants who have never configured payment methods.
 * The backend decides the real list - see `PosSettings.payment_methods`.
 */
const PAYMENT_METHODS: Array<{
  key: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "cash", label: PAYMENT_METHOD_LABELS.cash, icon: Banknote },
  { key: "card", label: PAYMENT_METHOD_LABELS.card, icon: CreditCard },
  { key: "bank_qr", label: PAYMENT_METHOD_LABELS.bank_qr, icon: QrCode },
  { key: "mobile_wallet", label: PAYMENT_METHOD_LABELS.mobile_wallet, icon: Smartphone },
  { key: "debit", label: PAYMENT_METHOD_LABELS.debit, icon: Wallet },
];

/**
 * Tenders that can be recorded without a server round-trip.
 *
 * Card is excluded because it needs a real terminal/authorisation. Debit is
 * excluded because a prepaid balance cannot be validated offline, so allowing
 * it risks overdrawing the wallet. QR and mobile wallet are excluded from
 * neither: the backend treats them as *recording* methods (no terminal, no
 * provider callback — see backend/pos/views.py create_payment), so staff
 * confirming the customer scanned is sufficient evidence.
 */
const OFFLINE_CAPABLE_METHODS: PaymentMethod[] = ["cash", "bank_qr", "mobile_wallet"];

function isOfflineCapableMethod(key: string): boolean {
  return (OFFLINE_CAPABLE_METHODS as string[]).includes(key);
}

/**
 * Resolve a cart line's `selections` (ids only) into printable modifier names
 * using the offline menu snapshot, so an offline KOT still tells the kitchen
 * which size/toppings were chosen.
 */
function resolveOptionLabels(
  groups: MenuOptionGroup[] | undefined,
  selections: MenuSelection[] | undefined,
): Array<{ group_name: string; option_name: string; kind: string }> {
  if (!groups?.length || !selections?.length) return [];
  const out: Array<{ group_name: string; option_name: string; kind: string }> = [];
  for (const selection of selections) {
    const group = groups.find((g) => String(g.id) === String(selection.group_id));
    const option = group?.options.find((o) => String(o.id) === String(selection.option_id));
    if (group && option) {
      out.push({ group_name: group.name, option_name: option.name, kind: group.kind });
    }
  }
  return out;
}

/** Minimal shapes needed to print a ticket, so this file needs no `any`. */
type TicketMerchant = { business_name?: string; name?: string } | null;
type TicketWorker = { display_name?: string; name?: string } | null;
type TicketLine = {
  name: string;
  quantity: number;
  menu_item_id: number;
  special_instructions?: string;
  selections?: MenuSelection[];
};

/**
 * Build a printable KOT on the client for an order captured offline.
 *
 * The kitchen display is server-driven and therefore empty while offline, so
 * the printed ticket is the only route to the kitchen. `kotNumber` stays null
 * because the server assigns the real KOT number at sync time — the local
 * `OFF-XXXXXX` order reference is the same value as the order's
 * `client_mutation_id`, so the two reconcile once the order syncs.
 */
function makeOfflineKOT(
  orderRef: string,
  merchant: TicketMerchant,
  worker: TicketWorker,
  cart: TicketLine[],
  fulfillmentType: string,
  table: { name: string; table_number: number } | null,
  groupsByItemId: Map<number, MenuOptionGroup[]>,
  cartNotes?: string,
): KOTTicketData {
  return {
    merchantName: merchant?.business_name || merchant?.name || "ZENTRO",
    kotNumber: null,
    orderNumber: orderRef,
    createdAt: new Date().toISOString(),
    fulfillmentType,
    tableName: table?.name ?? null,
    tableNumber: table?.table_number ?? null,
    customerName: null,
    workerName: worker?.display_name || worker?.name || "Staff",
    notes: cartNotes || "",
    items: cart.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      special_instructions: item.special_instructions || "",
      options: resolveOptionLabels(groupsByItemId.get(item.menu_item_id), item.selections),
    })),
  };
}

function makeOfflineReceiptData(
  orderId: string,
  merchant: any,
  worker: any,
  cart: any[],
  subtotal: number,
  tax: number,
  total: number,
  method: string,
  cashAmount: number,
  change: number,
  fulfillmentType: string,
  groupsByItemId: Map<number, MenuOptionGroup[]>,
  externalReference: string,
  cartNotes?: string,
  table?: { name: string; table_number: number } | null,
): PosReceiptData {
  return {
    // A bill, not a receipt: this is the paper copy handed to the customer
    // while the order has no server record to reprint from.
    type: "bill",
    order_id: 0,
    order_uuid: orderId,
    order_number: `OFF-${orderId.slice(0, 6).toUpperCase()}`,
    kot_number: null,
    status: "confirmed",
    source: "pos_offline",
    created_at: new Date().toISOString(),
    client_created_at: new Date().toISOString(),
    merchant: {
      id: Number(merchant?.id) || 0,
      name: merchant?.business_name || merchant?.name || "",
      address: merchant?.address || "",
      phone: merchant?.phone || "",
      logo_url: merchant?.logo_url || "",
    },
    table: table ? { name: table.name, number: table.table_number } : null,
    fulfillment_type: fulfillmentType,
    customer_name: null,
    worker_name: worker?.display_name || worker?.name || "Staff",
    items: cart.map((item) => ({
      name: item.name,
      price: String(item.price),
      quantity: item.quantity,
      subtotal: String(item.subtotal),
      special_instructions: item.special_instructions || "",
      options: resolveOptionLabels(groupsByItemId.get(item.menu_item_id), item.selections),
    })),
    subtotal: String(roundMoney(subtotal)),
    notes: cartNotes,
    discounts: [],
    discount_amount: "0.00",
    tax_amount: String(roundMoney(tax)),
    tax_breakdown: [],
    service_charge: "0.00",
    total_amount: String(roundMoney(total)),
    payments: [
      {
        method,
        amount: String(roundMoney(total)),
        status: "completed",
        external_reference: externalReference,
        change_amount: String(roundMoney(change)),
        created_at: new Date().toISOString(),
      },
    ],
    total_paid: String(roundMoney(method === "cash" ? cashAmount : total)),
    change: String(roundMoney(change)),
    payment_status: "paid",
    payment_method: method,
    is_offline_receipt: true,
    sync_status: "pending",
  };
}

const METHOD_ICONS: Record<string, React.ComponentType<{ className?: string }>> =
  Object.fromEntries(PAYMENT_METHODS.map((pm) => [pm.key, pm.icon]));

export default function PaymentSheet({ open, onClose, onPaid }: PaymentSheetProps) {
  const cart = usePosStore((s) => s.cart);
  const cartNotes = usePosStore((s) => s.cartNotes);
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const merchant = usePosStore((s) => s.merchant);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const activeShift = usePosStore((s) => s.activeShift);
  const selectedCustomerId = usePosStore((s) => s.selectedCustomerId);
  const selectedTableId = usePosStore((s) => s.selectedTableId);
  const tables = usePosStore((s) => s.tables);
  const clearCart = usePosStore((s) => s.clearCart);

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debitAccounts, setDebitAccounts] = useState<DebitAccount[]>([]);
  const [selectedDebitAccount, setSelectedDebitAccount] = useState<string>("");
  const [reference, setReference] = useState("");
  const [qrConfirmed, setQrConfirmed] = useState(false);

  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [placedKot, setPlacedKot] = useState<KOTTicketData | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [orderMutationId, setOrderMutationId] = useState<string>(() => safeUuid());
  const posSettings = usePosStore((s) => s.posSettings);
  const menu = usePosStore((s) => s.menu);
  const isOnline = useOnlineStatus();
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  /** menu_item_id → option groups, for printing modifiers on offline KOTs. */
  const groupsByItemId = useMemo(() => {
    const map = new Map<number, MenuOptionGroup[]>();
    for (const items of Object.values(menu?.categories ?? {})) {
      for (const item of items ?? []) {
        if (item.groups?.length) map.set(item.id, item.groups);
      }
    }
    return map;
  }, [menu]);

  useEffect(() => {
    if (method === "debit" && isOnline && debitAccounts.length === 0) {
      posListDebitAccounts()
        .then(setDebitAccounts)
        .catch(() => {});
    }
  }, [method, isOnline, debitAccounts.length]);

  // Only offer tenders this merchant accepts, and never offer a QR tender
  // without an actual QR image to show the customer. Offline, the list is
  // narrowed to tenders that can be recorded without the server so the
  // auto-selection below can never land on one that will be rejected.
  const availableMethods = useMemo(() => {
    const configured = posSettings?.payment_methods;
    const base =
      configured && configured.length > 0
        ? configured.map((option) => ({
            key: option.key,
            label: option.label,
            requiresReference: option.requires_reference,
            isQr: option.is_qr,
            icon: METHOD_ICONS[option.key] ?? Banknote,
          }))
        : PAYMENT_METHODS.map((pm) => ({
            key: pm.key,
            label: pm.label,
            requiresReference: pm.key !== "cash" && pm.key !== "debit",
            isQr: pm.key === "bank_qr",
            icon: pm.icon,
          }));
    return isOnline ? base : base.filter((m) => isOfflineCapableMethod(m.key));
  }, [posSettings?.payment_methods, isOnline]);

  const qr = posSettings?.payment_qr ?? null;
  const activeMethod = availableMethods.find((m) => m.key === method);

  // Keep the selected tender valid when the merchant's list differs.
  useEffect(() => {
    if (
      availableMethods.length > 0 &&
      !availableMethods.some((m) => m.key === method)
    ) {
      setMethod(availableMethods[0].key as PaymentMethod);
    }
  }, [availableMethods, method]);

  // A QR handover has to be acknowledged before the sale is recorded, otherwise
  // there is no evidence the customer ever saw the code.
  useEffect(() => {
    setQrConfirmed(false);
    setReference("");
  }, [method]);
  useEffect(() => {
    if (!open) {
      setCreatedOrderId(null);
      setOrderMutationId(safeUuid());
      setError(null);
      setOrderPlaced(false);
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const { total: tax } = calculateTax(subtotal, posSettings?.tax_components || []);
  const total = subtotal + tax;
  const cashAmount = parseFloat(cashReceived) || 0;
  const change = method === "cash" ? Math.max(0, cashAmount - total) : 0;
  const isDineIn = fulfillmentType === "dine-in";

  const isCashValid = isDineIn || (method === "cash" ? cashAmount >= total : true);
  const isDebitValid =
    method !== "debit" ||
    (selectedDebitAccount &&
      debitAccounts.find((a) => a.id === selectedDebitAccount && Number(a.balance) >= total));
  const isQrValid = !(activeMethod?.isQr && qr) || qrConfirmed;
  const canSubmit =
    !submitting &&
    cart.length > 0 &&
    availableMethods.length > 0 &&
    isCashValid &&
    isDebitValid &&
    isQrValid;

  async function handlePlaceOrder() {
    if (!merchant || !currentWorker || !device || cart.length === 0) return;

    setSubmitting(true);
    setError(null);

    const isOffline = !navigator.onLine;
    const merchantProfile = merchant as any;
    const hasDiscounts = cart.some((c) => (c as any).discount_amount > 0 || (c as any).discount_type);
    if (isOffline && hasDiscounts && merchantProfile?.offline_discounts_allowed === false) {
      setError("Discounts are not permitted while offline.");
      setSubmitting(false);
      return;
    }

    if (isOffline) {
      try {
        const offlineId = orderMutationId;
        const kot = makeOfflineKOT(
          `OFF-${offlineId.slice(0, 6).toUpperCase()}`,
          merchant,
          currentWorker,
          cart,
          fulfillmentType,
          tables.find((t) => t.id === selectedTableId) ?? null,
          groupsByItemId,
          cartNotes,
        );

        await offlineOrders.save({
          id: offlineId,
          merchant_id: merchant.id,
          items: cart.map((item) => ({
            menu_item_id: item.menu_item_id,
            quantity: item.quantity,
          })),
          notes: cartNotes,
          fulfillment_type: fulfillmentType,
          table_id: selectedTableId ?? null,
          customer_id: selectedCustomerId ?? null,
          shift_id: activeShift?.id ?? undefined,
          worker_id: currentWorker.id,
          device_id: device.id,
          cart_snapshot: cart.map((item) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            subtotal: item.subtotal,
          })),
          total: roundMoney(total),
          status: "pending_sync",
          kot,
          created_at: new Date().toISOString(),
        });

        await enqueueMutation(
          "order",
          "/pos/order/create/",
          "POST",
          {
            merchant_id: merchant.id,
            items: cartToOrderItems(cart),
            notes: cartNotes,
            fulfillment_type: fulfillmentType,
            customer_id: selectedCustomerId ?? undefined,
            table_id: selectedTableId ?? undefined,
            shift_id: activeShift?.id ?? undefined,
            worker_id: currentWorker.id,
            device_id: device.id,
            client_mutation_id: offlineId,
            source: "pos_offline",
            client_timestamp: new Date().toISOString(),
          },
          offlineId,
        );

        clearCart();
        setPlacedKot(kot);
        setOrderPlaced(true);
      } catch (err: any) {
        setError(err?.message || "Failed to store offline order.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const orderRes = await posCreateOrder({
        merchant_id: merchant.id,
        items: cartToOrderItems(cart),
        notes: cartNotes,
        fulfillment_type: fulfillmentType,
        customer_id: selectedCustomerId ?? undefined,
        table_id: selectedTableId ?? undefined,
        shift_id: activeShift?.id ?? undefined,
        worker_id: currentWorker.id,
        device_id: device.id,
        client_mutation_id: orderMutationId,
      });

      clearCart();
      setOrderPlaced(true);
      try {
        const r = await posReceiptData(String(orderRes.uuid));
        setPlacedKot(kotTicketFromReceipt(r));
      } catch {
        // KOT not critical on this path
      }
    } catch (err: any) {
      setError(err?.message || "Failed to place order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit || !merchant || !currentWorker || !device) return;

    setSubmitting(true);
    setError(null);

    const isOffline = !navigator.onLine;
    const merchantProfile = merchant as any;
    const hasDiscounts = cart.some((c) => (c as any).discount_amount > 0 || (c as any).discount_type);
    if (isOffline && hasDiscounts && merchantProfile?.offline_discounts_allowed === false) {
      setError("Discounts are not permitted while offline.");
      setSubmitting(false);
      return;
    }
    if (isOffline && method === "debit" && merchantProfile?.offline_credit_allowed === false) {
      setError("Debit/credit sales are not permitted while offline.");
      setSubmitting(false);
      return;
    }

    if (isOffline && !isOfflineCapableMethod(method)) {
      setError(
        `${PAYMENT_METHOD_LABELS[method] || method} cannot be recorded without a connection. Please use Cash, bank QR or mobile wallet.`,
      );
      setSubmitting(false);
      return;
    }

    if (isOffline) {
      // shift_id is a required UUID on CreatePaymentSerializer, so queueing
      // with an empty one would only surface as a 400 at sync time.
      const offlineShiftId = activeShift?.id;
      if (!offlineShiftId) {
        setError("Open a shift before taking payment.");
        setSubmitting(false);
        return;
      }

      try {
        const offlineOrderId = orderMutationId;
        const offlinePaymentId = safeUuid();
        const offlineTable = tables.find((t) => t.id === selectedTableId) ?? null;
        const kot = makeOfflineKOT(
          `OFF-${offlineOrderId.slice(0, 6).toUpperCase()}`,
          merchant,
          currentWorker,
          cart,
          fulfillmentType,
          offlineTable,
          groupsByItemId,
          cartNotes,
        );
        const offlineReceipt = makeOfflineReceiptData(
          offlineOrderId,
          merchant,
          currentWorker,
          cart,
          subtotal,
          tax,
          total,
          method,
          cashAmount,
          change,
          fulfillmentType,
          groupsByItemId,
          reference.trim(),
          cartNotes,
          offlineTable,
        );

        await offlineOrders.save({
          id: offlineOrderId,
          merchant_id: merchant.id,
          items: cart.map((item) => ({
            menu_item_id: item.menu_item_id,
            quantity: item.quantity,
          })),
          notes: cartNotes,
          fulfillment_type: fulfillmentType,
          table_id: selectedTableId ?? null,
          customer_id: selectedCustomerId ?? null,
          shift_id: activeShift?.id ?? undefined,
          worker_id: currentWorker.id,
          device_id: device.id,
          cart_snapshot: cart.map((item) => ({
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            subtotal: item.subtotal,
          })),
          total: roundMoney(total),
          status: "pending_sync",
          kot,
          bill: offlineReceipt,
          created_at: new Date().toISOString(),
        });

        await enqueueMutation(
          "order",
          "/pos/order/create/",
          "POST",
          {
            merchant_id: merchant.id,
            items: cartToOrderItems(cart),
            notes: cartNotes,
            fulfillment_type: fulfillmentType,
            customer_id: selectedCustomerId ?? undefined,
            table_id: selectedTableId ?? undefined,
            shift_id: activeShift?.id ?? undefined,
            worker_id: currentWorker.id,
            device_id: device.id,
            client_mutation_id: offlineOrderId,
            source: "pos_offline",
            client_timestamp: new Date().toISOString(),
          },
          offlineOrderId,
        );

        await offlinePayments.save({
          id: offlinePaymentId,
          order_id: offlineOrderId,
          payment_method: method,
          amount: roundMoney(total),
          change_amount: method === "cash" ? roundMoney(change) : 0,
          shift_id: offlineShiftId,
          worker_id: currentWorker.id,
          device_id: device.id,
          status: "pending_sync",
          created_at: new Date().toISOString(),
        });

        await enqueueMutation(
          "payment",
          "/pos/payment/create/",
          "POST",
          {
            order_id: offlineOrderId,
            shift_id: offlineShiftId,
            worker_id: currentWorker.id,
            device_id: device.id,
            payment_method: method,
            amount: roundMoney(total),
            change_amount: method === "cash" ? roundMoney(change) : 0,
            debit_account_id: method === "debit" ? selectedDebitAccount : undefined,
            external_reference: reference.trim() || undefined,
            client_mutation_id: offlinePaymentId,
            client_created_at: new Date().toISOString(),
          },
          offlinePaymentId,
        );

        setReceiptData(offlineReceipt);
        setPlacedKot(kot);
        clearCart();
      } catch (err: any) {
        setError(err?.message || "Failed to process offline checkout.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      let targetOrderUuid = createdOrderId;

      if (!targetOrderUuid) {
        const orderRes = await posCreateOrder({
          merchant_id: merchant.id,
          items: cartToOrderItems(cart),
          notes: cartNotes,
          fulfillment_type: fulfillmentType,
          customer_id: selectedCustomerId ?? undefined,
          table_id: selectedTableId ?? undefined,
          shift_id: activeShift?.id ?? undefined,
          worker_id: currentWorker.id,
          device_id: device.id,
          client_mutation_id: orderMutationId,
        });
        targetOrderUuid = String(orderRes.uuid);
        setCreatedOrderId(targetOrderUuid);
      }

      await posCreatePayment({
        order_id: targetOrderUuid,
        shift_id: activeShift?.id ?? "",
        worker_id: currentWorker.id,
        device_id: device.id,
        payment_method: method,
        amount: roundMoney(total),
        change_amount: method === "cash" ? roundMoney(change) : 0,
        debit_account_id: method === "debit" ? selectedDebitAccount : undefined,
        // Optional by design: Zentro records the payment, it does not
        // process it, so there is nothing to look up against a provider.
        external_reference: reference.trim() || undefined,
        client_mutation_id: safeUuid(),
      });

      clearCart();
      setCreatedOrderId(null);
      setOrderMutationId(safeUuid());
      setLoadingReceipt(true);
      try {
        const receipt = await posReceiptData(targetOrderUuid);
        setReceiptData(receipt);
      } catch {
        onPaid();
      } finally {
        setLoadingReceipt(false);
      }
    } catch (err: any) {
      setError(err?.message || "Payment failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Dine-in order placed success ──
  if (isDineIn && orderPlaced) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-placed-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      >
        <div className="mx-4 flex w-full max-w-md flex-col rounded-3xl bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-ink" />
              <h3 id="payment-sheet-placed-title" className="text-base font-bold text-foreground">
                Order Placed
              </h3>
            </div>
            <button
              aria-label="Close"
              onClick={() => {
                setOrderPlaced(false);
                onClose();
                onPaid();
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 bg-green-50 px-6 py-3">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-green-100">
              <Check className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-green-800">Order sent to kitchen</p>
              <p className="text-xs text-green-600">Payment will be collected after the meal</p>
            </div>
          </div>

          {placedKot && placedKot.kotNumber && (
            <div className="flex items-center justify-center gap-2 border-b border-border px-6 py-3">
              <Ticket className="h-4 w-4 text-ink" />
              <span className="text-sm font-extrabold text-ink">
                KOT #{String(placedKot.kotNumber).padStart(3, "0")}
              </span>
            </div>
          )}

          {placedKot && (
            <div className="border-b border-border px-6 py-4 text-center">
              <button
                onClick={() => printKOT(placedKot)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-2.5 text-sm font-bold text-white hover:opacity-90"
              >
                <Ticket className="h-4 w-4" />
                Print KOT
              </button>
            </div>
          )}

          <div className="px-6 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              The order will appear in the orders panel. Process it through confirm → prepare →
              ready → complete, then collect payment when the customer is ready to pay.
            </p>
          </div>

          <div className="border-t border-border px-6 py-4">
            <button
              onClick={() => {
                setOrderPlaced(false);
                onClose();
                onPaid();
              }}
              className="flex w-full items-center justify-center rounded-xl bg-ember py-3 text-sm font-bold text-white shadow-[var(--shadow-ember)] hover:brightness-105"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Receipt view after payment ──
  if (receiptData || loadingReceipt) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-receipt-title"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      >
        <div className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <ReceiptIcon className="h-5 w-5 text-ink" />
              <h3 id="payment-sheet-receipt-title" className="text-base font-bold text-foreground">
                Payment Complete
              </h3>
            </div>
            <button
              aria-label="Close"
              onClick={() => {
                setReceiptData(null);
                onClose();
                onPaid();
              }}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 bg-green-50 px-6 py-3">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-green-100">
              <Check className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-green-800">Payment successful</p>
              {method === "cash" && change > 0 && (
                <p className="text-xs text-green-600">
                  Change to give: {formatCurrency(change, currencySymbol)}
                </p>
              )}
            </div>
            {receiptData?.kot_number && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-extrabold text-white">
                <Ticket className="h-3.5 w-3.5" />
                KOT #{String(receiptData.kot_number).padStart(3, "0")}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loadingReceipt ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading receipt...</span>
              </div>
            ) : receiptData ? (
              <div className="flex flex-col items-center gap-4">
                {(receiptData.kot_number || placedKot) && (
                  <button
                    onClick={() =>
                      printKOT(
                        receiptData.kot_number
                          ? kotTicketFromReceipt(receiptData)
                          : (placedKot as KOTTicketData),
                      )
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    <Ticket className="h-4 w-4" />
                    {receiptData.kot_number
                      ? `Print KOT (${String(receiptData.kot_number).padStart(3, "0")})`
                      : "Print KOT"}
                  </button>
                )}
                <div className="flex justify-center">
                  <Receipt
                    data={receiptData}
                    showPrintButton={true}
                    currencySymbol={currencySymbol}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex gap-3 border-t border-border px-6 py-4">
            <button
              onClick={() => {
                setReceiptData(null);
                onClose();
                onPaid();
              }}
              className="flex-1 rounded-xl bg-ember py-3 text-sm font-bold text-white shadow-[var(--shadow-ember)] hover:brightness-105"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Dine-in: order confirmation (no payment) ──
  if (isDineIn) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-sheet-dinein-title"
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        <div className="relative w-full max-w-lg rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 id="payment-sheet-dinein-title" className="text-base font-bold text-foreground">
              Confirm Dine-In Order
            </h3>
            <button
              aria-label="Close"
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-border px-6 py-4 text-center">
            <p className="text-xs text-muted-foreground">Order total</p>
            <p className="numeric mt-1 text-3xl font-bold text-ink">
              {formatCurrency(total, currencySymbol)}
            </p>
            {selectedTableId && (
              <p className="mt-1 text-xs text-muted-foreground">Table will be assigned on order</p>
            )}
          </div>

          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground text-center">
              No payment now — payment will be collected after the meal.
            </p>
          </div>

          {error && (
            <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">{error}</div>
          )}

          <div className="px-6 pb-6">
            <button
              onClick={handlePlaceOrder}
              disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-ember py-3.5 text-sm font-bold text-white shadow-[var(--shadow-ember)] transition-all hover:brightness-105 disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Placing order...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Place Order — {formatCurrency(total, currencySymbol)}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Takeaway / Delivery: payment form ──
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-sheet-title"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 id="payment-sheet-title" className="text-base font-bold text-foreground">
            Payment
          </h3>
          <button
            aria-label="Close"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">Amount to pay</p>
          <p className="numeric mt-1 text-3xl font-bold text-ink">
            {formatCurrency(total, currencySymbol)}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 px-6 py-4 sm:grid-cols-5">
          {availableMethods.map((pm) => {
            const Icon = pm.icon;
            const active = method === pm.key;
            return (
              <button
                key={pm.key}
                onClick={() => setMethod(pm.key as PaymentMethod)}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-medium transition-colors ${
                  active ? "bg-ink text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate">{pm.label}</span>
              </button>
            );
          })}
        </div>

        {activeMethod?.isQr && qr && (
          <div className="mx-6 mb-4 rounded-2xl border border-border bg-muted/40 p-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <img
                src={qr.url}
                alt={`${qr.name} payment QR`}
                className="h-32 w-32 shrink-0 rounded-xl bg-white object-contain p-1"
              />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-sm font-semibold text-foreground">{qr.name}</p>
                {qr.account_name && (
                  <p className="text-xs text-muted-foreground">
                    {qr.account_name}
                  </p>
                )}
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  {qr.instructions}
                </p>
                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] text-foreground">
                  <input
                    type="checkbox"
                    checked={qrConfirmed}
                    onChange={(e) => setQrConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border accent-ink"
                  />
                  <span>Customer has scanned and shown me their payment confirmation</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeMethod?.isQr && !qr && (
          <div className="mx-6 mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
            This merchant has no payment QR uploaded yet. Add one in settings
            before taking QR payments.
          </div>
        )}

        {method === "cash" && (
          <div className="px-6 pb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Cash received
            </label>
            <input
              type="number"
              value={cashReceived}
              onChange={(e) => setCashReceived(e.target.value)}
              placeholder="0.00"
              min={0}
              step="0.10"
              className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
            <div className="mt-2 flex gap-2">
              {Array.from(new Set([total, Math.ceil(total), 10, 20, 50, 100])).map((amt, i) => (
                <button
                  key={`${amt}-${i}`}
                  onClick={() => setCashReceived(amt.toFixed(2))}
                  className="min-h-[44px] flex-1 rounded-lg bg-muted px-1 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  {amt === total ? "Exact" : formatCurrency(amt, currencySymbol)}
                </button>
              ))}
            </div>
            {cashAmount > 0 && cashAmount < total && (
              <p className="mt-2 text-xs text-destructive">
                Insufficient — need {formatCurrency(total - cashAmount, currencySymbol)} more
              </p>
            )}
            {change > 0 && (
              <p className="mt-2 rounded-xl bg-green-50 p-2 text-center text-sm font-bold text-green-700">
                Change: {formatCurrency(change, currencySymbol)}
              </p>
            )}
          </div>
        )}

        {method !== "cash" && method !== "debit" && !activeMethod?.isQr && (
          <div className="px-6 pb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Reference / Transaction ID (optional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TXN-123456"
              className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
        )}

        {activeMethod?.isQr && qr && (
          <div className="px-6 pb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Reference / Transaction ID (optional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TXN-123456"
              className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
        )}

        {method === "debit" && (
          <div className="px-6 pb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Select debit account
            </label>
            {debitAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No debit accounts found</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {debitAccounts.map((account) => {
                  const balance = Number(account.balance);
                  const sufficient = balance >= total;
                  return (
                    <button
                      key={account.id}
                      onClick={() => setSelectedDebitAccount(account.id)}
                      disabled={!sufficient}
                      className={`flex w-full items-center justify-between rounded-xl border p-3 text-left text-sm transition-colors ${
                        selectedDebitAccount === account.id
                          ? "border-ink bg-ink/5"
                          : sufficient
                            ? "border-border hover:border-ink/50"
                            : "border-border opacity-40"
                      }`}
                    >
                      <div>
                        <p className="font-medium">{account.contact_name || "Walk-in"}</p>
                        {account.contact_phone && (
                          <p className="text-xs text-muted-foreground">{account.contact_phone}</p>
                        )}
                      </div>
                      <span
                        className={sufficient ? "font-bold text-ink" : "text-red-500 font-bold"}
                      >
                        {formatCurrency(balance, currencySymbol)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedDebitAccount && (
              <p className="mt-2 text-xs text-muted-foreground">
                Total: {formatCurrency(total, currencySymbol)}
              </p>
            )}
          </div>
        )}

        {(method === "card" || method === "mobile_wallet") && (
          <p className="px-6 pb-4 text-center text-xs text-muted-foreground">
            Confirm once the customer has paid. It's recorded as {PAYMENT_METHOD_LABELS[method]}.
          </p>
        )}

        {error && (
          <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">{error}</div>
        )}

        <div className="px-6 pb-6">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ember py-3.5 text-sm font-bold text-white shadow-[var(--shadow-ember)] transition-all hover:brightness-105 disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Confirm Payment — {formatCurrency(total, currencySymbol)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

