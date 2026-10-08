import { useState, useEffect, useMemo } from "react";
import { safeUuid } from "@/lib/utils";
import { usePosStore, cartToOrderItems, cartHasFreeItems } from "../store";
import PaymentQrBlock from "./PaymentQrBlock";
import { isOnline as serverReachable } from "@/lib/connectivity";
import {
  posApplyDiscount,
  posCreateOrder,
  posCreatePayment,
  posReceiptData,
  PosReceiptData,
  posListDebitAccounts,
  DebitAccount,
} from "../api";
import { formatCurrency, roundMoney } from "@/lib/currency";
import { usePosCartPricing, type PosCartPricing } from "../pricing";
import { offlineOrderNumber, receiptPayment } from "../offline/documents";
import { isOfflineCapableMethod } from "../offline/tenders";
import { posOffersApi } from "@/lib/api/offers";
import Receipt from "../printing/Receipt";
import { PAYMENT_METHOD_LABELS } from "@/lib/payment-methods";
import KOTTicket from "../printing/KOTTicket";
import { kotTicketFromReceipt, printKOT, type KOTTicketData } from "../printing/kot-markup";
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

/** How an offline sale was paid; absent for an order placed without payment. */
type OfflineTender = {
  method: string;
  cashAmount: number;
  change: number;
  reference: string;
  shiftId: string;
};

/**
 * The bill for an order captured offline, priced by the client-side preview.
 *
 * The tax lines and charges are carried over from the preview so the printed
 * bill adds up to its total; the server prices the order again when it syncs.
 */
function makeOfflineReceiptData(input: {
  orderId: string;
  merchant: { id: number; business_name: string; logo_url: string };
  worker: TicketWorker;
  cart: Array<TicketLine & { price: number; subtotal: number }>;
  pricing: PosCartPricing;
  fulfillmentType: string;
  groupsByItemId: Map<number, MenuOptionGroup[]>;
  cartNotes?: string;
  table: { name: string; table_number: number } | null;
  tender: OfflineTender | null;
}): PosReceiptData {
  const { orderId, merchant, worker, cart, pricing, table, tender } = input;
  const total = pricing.totalValue;
  const change = String(roundMoney(tender?.change ?? 0));
  return {
    // A bill, not a receipt: this is the paper copy handed to the customer
    // while the order has no server record to reprint from.
    type: "bill",
    order_id: 0,
    order_uuid: orderId,
    order_number: offlineOrderNumber(orderId),
    kot_number: null,
    status: "confirmed",
    source: "pos_offline",
    created_at: new Date().toISOString(),
    client_created_at: new Date().toISOString(),
    merchant: {
      id: merchant.id,
      name: merchant.business_name,
      address: "",
      phone: "",
      logo_url: merchant.logo_url || "",
    },
    table: table ? { name: table.name, number: table.table_number } : null,
    fulfillment_type: input.fulfillmentType,
    customer_name: null,
    worker_name: worker?.display_name || worker?.name || "Staff",
    items: cart.map((item) => ({
      name: item.name,
      price: String(item.price),
      quantity: item.quantity,
      subtotal: String(item.subtotal),
      special_instructions: item.special_instructions || "",
      options: resolveOptionLabels(input.groupsByItemId.get(item.menu_item_id), item.selections),
    })),
    subtotal: pricing.subtotal,
    notes: input.cartNotes,
    discounts: [],
    discount_amount: pricing.discountTotal,
    taxable_amount: pricing.taxableTotal,
    tax_amount: pricing.taxTotal,
    tax_breakdown: pricing.taxes,
    prices_include_tax: pricing.pricesIncludeTax,
    service_charge: pricing.chargeTotal,
    charges: pricing.charges.map((charge) => ({
      kind: charge.kind,
      label: charge.label,
      amount: charge.amount,
      taxable: charge.taxable,
      tax_amount: charge.tax,
    })),
    total_amount: pricing.grandTotal,
    payments: tender
      ? [receiptPayment(tender.method, pricing.grandTotal, change, tender.reference)]
      : [],
    total_paid: tender
      ? String(roundMoney(tender.method === "cash" ? tender.cashAmount : total))
      : "0.00",
    change,
    payment_status: tender ? "paid" : "unpaid",
    payment_method: tender?.method ?? "",
    is_offline_receipt: true,
    sync_status: "pending",
  };
}

const METHOD_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = Object.fromEntries(PAYMENT_METHODS.map((pm) => [pm.key, pm.icon]));

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
  const pendingDiscount = usePosStore((s) => s.pendingDiscount);
  const pendingOffer = usePosStore((s) => s.pendingOffer);
  const setPendingOffer = usePosStore((s) => s.setPendingOffer);
  const setPendingDiscount = usePosStore((s) => s.setPendingDiscount);
  // Preview for display and cash validation; the charge uses the server total.
  const cartPricing = usePosCartPricing();

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
  const [discountAppliedTo, setDiscountAppliedTo] = useState<string | null>(null);
  const [orderMutationId, setOrderMutationId] = useState<string>(() => safeUuid());
  const [paymentMutationId, setPaymentMutationId] = useState<string>(() => safeUuid());
  // The order was saved on this device, so the kitchen has not seen it.
  const [placedOffline, setPlacedOffline] = useState(false);
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
    if (availableMethods.length > 0 && !availableMethods.some((m) => m.key === method)) {
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
      setDiscountAppliedTo(null);
      setOrderMutationId(safeUuid());
      setPaymentMutationId(safeUuid());
      setError(null);
      setOrderPlaced(false);
      setReceiptData(null);
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const total = cartPricing.totalValue;

  /**
   * Create the order on the server (once), apply the cart's discount there,
   * and return the server's authoritative total — the amount actually charged.
   */
  async function ensureServerOrder(): Promise<{ uuid: string; total: number }> {
    if (!merchant || !currentWorker || !device) throw new Error("POS is not ready.");
    let uuid = createdOrderId;
    let serverTotal: number | null = null;
    if (!uuid) {
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
        free_item_pin: cartHasFreeItems(cart)
          ? (usePosStore.getState().freeItemPin ?? undefined)
          : undefined,
      });
      uuid = String(orderRes.uuid);
      setCreatedOrderId(uuid);
      serverTotal = Number(orderRes.total_amount);
    }
    if (pendingDiscount && discountAppliedTo !== uuid) {
      try {
        await posApplyDiscount({
          order_id: uuid,
          worker_id: currentWorker.id,
          discount_type: pendingDiscount.type,
          discount_value: pendingDiscount.value,
          reason: pendingDiscount.reason,
          authorized_by_worker_id: pendingDiscount.authorizedByWorkerId,
          source: "pos",
        });
        setDiscountAppliedTo(uuid);
        serverTotal = null;
      } catch (err: unknown) {
        setPendingDiscount(null);
        throw new Error(
          `The order was saved, but the discount could not be applied: ${(err as Error)?.message || "unknown error"}. Check the total and try again.`,
        );
      }
    }
    if (pendingOffer && discountAppliedTo !== uuid) {
      try {
        await posOffersApi.apply({
          order_id: uuid,
          code: pendingOffer.code,
          worker_id: currentWorker.id,
        });
        setDiscountAppliedTo(uuid);
        serverTotal = null;
      } catch (err: unknown) {
        setPendingOffer(null);
        throw new Error(
          `The order was saved, but the offer could not be applied: ${(err as Error)?.message || "unknown error"}. Check the total and try again.`,
        );
      }
    }
    if (serverTotal === null || !Number.isFinite(serverTotal)) {
      serverTotal = Number((await posReceiptData(uuid)).total_amount);
    }
    return { uuid, total: serverTotal };
  }
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

  /** Why this cart cannot be saved offline, or null when it can. */
  function offlineBlocker(): string | null {
    if (pendingOffer) {
      return "Offers need an internet connection to be checked. Remove the offer to continue offline.";
    }
    if (pendingDiscount) {
      return "Discounts need an internet connection. Remove the discount to continue offline.";
    }
    if (cartHasFreeItems(cart)) {
      return "Free items need an internet connection. Charge for them or wait for the connection.";
    }
    return null;
  }

  /**
   * Save the order on this device and queue it for the server. With a tender
   * the sale is recorded as paid; without one the bill stays open (dine-in).
   *
   * The queued order carries the same `client_mutation_id` the online attempt
   * uses, so if that attempt did reach the server before the connection
   * dropped, sending it again returns the same order instead of a duplicate.
   */
  async function captureOffline(tender: OfflineTender | null) {
    if (!merchant || !currentWorker || !device) throw new Error("POS is not ready.");
    const offlineOrderId = orderMutationId;
    const table = tables.find((t) => t.id === selectedTableId) ?? null;
    const createdAt = new Date().toISOString();
    const kot = makeOfflineKOT(
      offlineOrderNumber(offlineOrderId),
      merchant,
      currentWorker,
      cart,
      fulfillmentType,
      table,
      groupsByItemId,
      cartNotes,
    );
    const bill = makeOfflineReceiptData({
      orderId: offlineOrderId,
      merchant,
      worker: currentWorker,
      cart,
      pricing: cartPricing,
      fulfillmentType,
      groupsByItemId,
      cartNotes,
      table,
      tender,
    });

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
      bill,
      created_at: createdAt,
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
        client_timestamp: createdAt,
      },
      offlineOrderId,
    );

    if (tender) {
      await offlinePayments.save({
        id: paymentMutationId,
        order_id: offlineOrderId,
        payment_method: tender.method,
        amount: roundMoney(total),
        change_amount: roundMoney(tender.change),
        external_reference: tender.reference || undefined,
        shift_id: tender.shiftId,
        worker_id: currentWorker.id,
        device_id: device.id,
        status: "pending_sync",
        created_at: createdAt,
      });

      await enqueueMutation(
        "payment",
        "/pos/payment/create/",
        "POST",
        {
          order_id: offlineOrderId,
          shift_id: tender.shiftId,
          worker_id: currentWorker.id,
          device_id: device.id,
          payment_method: tender.method,
          amount: roundMoney(total),
          change_amount: roundMoney(tender.change),
          external_reference: tender.reference || undefined,
          client_mutation_id: paymentMutationId,
          client_created_at: createdAt,
        },
        paymentMutationId,
      );
    }

    return { kot, bill };
  }

  async function handlePlaceOrder() {
    if (!merchant || !currentWorker || !device || cart.length === 0) return;

    setSubmitting(true);
    setError(null);

    const placeOffline = async () => {
      const blocker = offlineBlocker();
      if (blocker) {
        setError(blocker);
        return;
      }
      try {
        const { kot } = await captureOffline(null);
        clearCart();
        setPlacedKot(kot);
        setPlacedOffline(true);
        setOrderPlaced(true);
      } catch (err: any) {
        setError(err?.message || "Failed to store offline order.");
      }
    };

    try {
      if (!serverReachable()) {
        await placeOffline();
        return;
      }

      try {
        const { uuid: placedUuid } = await ensureServerOrder();

        clearCart();
        setCreatedOrderId(null);
        setDiscountAppliedTo(null);
        setPlacedOffline(false);
        setOrderPlaced(true);
        try {
          const r = await posReceiptData(placedUuid);
          setPlacedKot(kotTicketFromReceipt(r));
        } catch {
          // KOT not critical on this path
        }
      } catch (err: any) {
        // The server never answered: keep the order here rather than lose it.
        if (!serverReachable() && !offlineBlocker()) await placeOffline();
        else setError(err?.message || "Failed to place order. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit || !merchant || !currentWorker || !device) return;

    setSubmitting(true);
    setError(null);

    const payOffline = async () => {
      const blocker = offlineBlocker();
      if (blocker) {
        setError(blocker);
        return;
      }
      if (!isOfflineCapableMethod(method)) {
        setError(
          `${PAYMENT_METHOD_LABELS[method] || method} cannot be recorded without a connection. Please use Cash, bank QR or mobile wallet.`,
        );
        return;
      }
      // shift_id is a required UUID on CreatePaymentSerializer, so queueing
      // with an empty one would only surface as a 400 at sync time.
      const offlineShiftId = activeShift?.id;
      if (!offlineShiftId) {
        setError("Open a shift before taking payment.");
        return;
      }
      try {
        const { kot, bill } = await captureOffline({
          method,
          cashAmount,
          change: method === "cash" ? change : 0,
          reference: reference.trim(),
          shiftId: offlineShiftId,
        });
        setReceiptData(bill);
        setPlacedKot(kot);
        clearCart();
      } catch (err: any) {
        setError(err?.message || "Failed to process offline checkout.");
      }
    };

    try {
      if (!serverReachable()) {
        await payOffline();
        return;
      }

      try {
        const { uuid: targetOrderUuid, total: serverTotal } = await ensureServerOrder();
        if (method === "cash" && cashAmount < serverTotal) {
          throw new Error(
            `The order total is ${formatCurrency(serverTotal, currencySymbol)}; cash received is not enough.`,
          );
        }

        await posCreatePayment({
          order_id: targetOrderUuid,
          shift_id: activeShift?.id ?? "",
          worker_id: currentWorker.id,
          device_id: device.id,
          payment_method: method,
          amount: roundMoney(serverTotal),
          change_amount: method === "cash" ? roundMoney(Math.max(0, cashAmount - serverTotal)) : 0,
          debit_account_id: method === "debit" ? selectedDebitAccount : undefined,
          // Optional by design: Zentro records the payment, it does not
          // process it, so there is nothing to look up against a provider.
          external_reference: reference.trim() || undefined,
          // One id per sale, shared with the offline path, so a payment that
          // reached the server just before the connection dropped is not
          // recorded a second time when it is queued and sent again.
          client_mutation_id: paymentMutationId,
        });

        clearCart();
        setCreatedOrderId(null);
        setDiscountAppliedTo(null);
        setOrderMutationId(safeUuid());
        setPaymentMutationId(safeUuid());
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
        // The server never answered: keep the sale here rather than lose it.
        if (!serverReachable() && !offlineBlocker()) await payOffline();
        else setError(err?.message || "Payment failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ── Order placed, nothing left to collect in this sheet ──
  //
  // An offline order has no receipt to collect against and no server to send
  // the ticket to, so this sheet becomes the cashier's only chance to print it.
  // Gating on `isDineIn` alone left a takeaway order — the common case, and the
  // one most likely to be taken with the connection down — falling through to
  // the payment form with the cart already cleared: no Print KOT, no "saved on
  // this device" notice. Online takeaway is deliberately excluded, because that
  // order still has to be paid for in this sheet.
  if (orderPlaced && (isDineIn || placedOffline)) {
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
              <p className="text-sm font-bold text-green-800">
                {placedOffline ? "Order saved on this device" : "Order sent to kitchen"}
              </p>
              <p className="text-xs text-green-600">
                {placedOffline
                  ? "No connection — print the KOT so the kitchen gets it"
                  : "Payment will be collected after the meal"}
              </p>
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
              {placedOffline
                ? "The order is in the orders panel and is sent to the server when the connection is back. You can still move it through prepare → ready → complete and collect payment from there."
                : "The order will appear in the orders panel. Process it through confirm → prepare → ready → complete, then collect payment when the customer is ready to pay."}
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
              {/* From the receipt: the cart is already cleared here, so a
                  change figure worked out from it would be the whole tender. */}
              {Number(receiptData?.change) > 0 && (
                <p className="text-xs text-green-600">
                  Change to give: {formatCurrency(Number(receiptData?.change), currencySymbol)}
                </p>
              )}
              {receiptData?.is_offline_receipt && receiptData.sync_status !== "synced" && (
                <p className="text-xs text-green-600">
                  Saved on this device — it is sent when the connection is back
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
                          : // A ticket placed offline stores no logo, so it borrows the live one.
                            {
                              ...(placedKot as KOTTicketData),
                              merchantLogoUrl: merchant?.logo_url ?? null,
                            },
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

        <div className="relative max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
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

      <div className="relative max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
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
          <PaymentQrBlock
            qr={qr}
            amount={total}
            currencySymbol={currencySymbol}
            confirmed={qrConfirmed}
            onConfirmedChange={setQrConfirmed}
          />
        )}

        {activeMethod?.isQr && !qr && (
          <div className="mx-6 mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
            This merchant has no payment QR uploaded yet. Add one in settings before taking QR
            payments.
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
