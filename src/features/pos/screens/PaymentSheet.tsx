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
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  useEffect(() => {
    if (method === "debit" && debitAccounts.length === 0) {
      posListDebitAccounts()
        .then(setDebitAccounts)
        .catch(() => {});
    }
  }, [method]);

  // Only offer tenders this merchant accepts, and never offer a QR tender
  // without an actual QR image to show the customer.
  const availableMethods = useMemo(() => {
    const configured = posSettings?.payment_methods;
    if (configured && configured.length > 0) {
      return configured.map((option) => ({
        key: option.key,
        label: option.label,
        requiresReference: option.requires_reference,
        isQr: option.is_qr,
        icon: METHOD_ICONS[option.key] ?? Banknote,
      }));
    }
    return PAYMENT_METHODS.map((pm) => ({
      key: pm.key,
      label: pm.label,
      requiresReference: pm.key !== "cash" && pm.key !== "debit",
      isQr: pm.key === "bank_qr",
      icon: pm.icon,
    }));
  }, [posSettings?.payment_methods]);

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
    if (!open) return;
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
        client_mutation_id: safeUuid(),
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
        client_mutation_id: safeUuid(),
      });

      await posCreatePayment({
        order_id: String(orderRes.uuid),
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
      setLoadingReceipt(true);
      try {
        const receipt = await posReceiptData(String(orderRes.uuid));
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
                {receiptData.kot_number && (
                  <button
                    onClick={() => printKOT(kotTicketFromReceipt(receiptData))}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-6 py-2.5 text-sm font-bold text-white hover:opacity-90"
                  >
                    <Ticket className="h-4 w-4" />
                    Print KOT ({String(receiptData.kot_number).padStart(3, "0")})
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

