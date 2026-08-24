import { useState, useEffect } from "react";
import { safeUuid } from "@/lib/utils";
import { usePosStore } from "../store";
import { posCreateOrder, posCreatePayment, posReceiptData, PosReceiptData, posListDebitAccounts, DebitAccount, getTaxRate } from "../api";
import Receipt from "../printing/Receipt";
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
} from "lucide-react";

interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}

type PaymentMethod = "cash" | "card" | "bank_qr" | "mobile_wallet" | "debit";

const PAYMENT_METHODS: Array<{
  key: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "cash", label: "Cash", icon: Banknote },
  { key: "card", label: "Card", icon: CreditCard },
  { key: "bank_qr", label: "Bank QR", icon: QrCode },
  { key: "mobile_wallet", label: "E-Wallet", icon: Smartphone },
  { key: "debit", label: "Debit", icon: Wallet },
];

export default function PaymentSheet({
  open,
  onClose,
  onPaid,
}: PaymentSheetProps) {
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

  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const posSettings = usePosStore((s) => s.posSettings);

  useEffect(() => {
    if (method === "debit" && debitAccounts.length === 0) {
      posListDebitAccounts().then(setDebitAccounts).catch(() => {});
    }
  }, [method]);

  if (!open) return null;

  const subtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const taxRate = getTaxRate(posSettings);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  const cashAmount = parseFloat(cashReceived) || 0;
  const change = method === "cash" ? Math.max(0, cashAmount - total) : 0;
  const isDineIn = fulfillmentType === "dine-in";

  const isCashValid = isDineIn || (method === "cash" ? cashAmount >= total : true);
  const isDebitValid = method !== "debit" || (selectedDebitAccount && debitAccounts.find((a) => a.id === selectedDebitAccount && Number(a.balance) >= total));
  const canSubmit = !submitting && cart.length > 0 && isCashValid && isDebitValid;

  async function handlePlaceOrder() {
    if (!merchant || !currentWorker || !device || cart.length === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      await posCreateOrder({
        merchant_id: merchant.id,
        items: cart.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
        })),
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
        items: cart.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
        })),
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
        amount: total,
        change_amount: method === "cash" ? change : 0,
        debit_account_id: method === "debit" ? selectedDebitAccount : undefined,
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 flex w-full max-w-md flex-col rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-ink" />
              <h3 className="text-base font-bold text-foreground">Order Placed</h3>
            </div>
            <button
              onClick={() => { setOrderPlaced(false); onClose(); onPaid(); }}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
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

          <div className="px-6 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              The order will appear in the orders panel. Process it through confirm → prepare → ready → complete, then collect payment when the customer is ready to pay.
            </p>
          </div>

          <div className="border-t border-border px-6 py-4">
            <button
              onClick={() => { setOrderPlaced(false); onClose(); onPaid(); }}
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <ReceiptIcon className="h-5 w-5 text-ink" />
              <h3 className="text-base font-bold text-foreground">Payment Complete</h3>
            </div>
            <button
              onClick={() => { setReceiptData(null); onClose(); onPaid(); }}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
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
                <p className="text-xs text-green-600">Change to give: Rs {change.toFixed(2)}</p>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loadingReceipt ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading receipt...</span>
              </div>
            ) : receiptData ? (
              <div className="flex justify-center">
                <Receipt data={receiptData} showPrintButton={true} />
              </div>
            ) : null}
          </div>

          <div className="flex gap-3 border-t border-border px-6 py-4">
            <button
              onClick={() => { setReceiptData(null); onClose(); onPaid(); }}
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
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        <div className="relative w-full max-w-lg rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-base font-bold text-foreground">Confirm Dine-In Order</h3>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-border px-6 py-4 text-center">
            <p className="text-xs text-muted-foreground">Order total</p>
            <p className="mt-1 text-3xl font-bold text-ink">Rs {total.toFixed(2)}</p>
            {selectedTableId && (
              <p className="mt-1 text-xs text-muted-foreground">
                Table will be assigned on order
              </p>
            )}
          </div>

          <div className="px-6 py-4">
            <p className="text-sm text-muted-foreground text-center">
              No payment now — payment will be collected after the meal.
            </p>
          </div>

          {error && (
            <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">
              {error}
            </div>
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
                  Place Order — Rs {total.toFixed(2)}
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-base font-bold text-foreground">Payment</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">Amount to pay</p>
          <p className="mt-1 text-3xl font-bold text-ink">
            Rs {total.toFixed(2)}
          </p>
        </div>

        <div className="grid grid-cols-5 gap-2 px-6 py-4">
          {PAYMENT_METHODS.map((pm) => {
            const Icon = pm.icon;
            const active = method === pm.key;
            return (
              <button
                key={pm.key}
                onClick={() => setMethod(pm.key)}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{pm.label}</span>
              </button>
            );
          })}
        </div>

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
              {[total, Math.ceil(total), 10, 20, 50, 100].map((amt) => (
                <button
                  key={amt}
                  onClick={() => setCashReceived(amt.toFixed(2))}
                  className="flex-1 rounded-lg bg-muted py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
                >
                  {amt === total ? "Exact" : `Rs ${amt}`}
                </button>
              ))}
            </div>
            {cashAmount > 0 && cashAmount < total && (
              <p className="mt-2 text-xs text-destructive">
                Insufficient — need Rs {(total - cashAmount).toFixed(2)} more
              </p>
            )}
            {change > 0 && (
              <p className="mt-2 rounded-xl bg-green-50 p-2 text-center text-sm font-bold text-green-700">
                Change: Rs {change.toFixed(2)}
              </p>
            )}
          </div>
        )}

        {method !== "cash" && method !== "debit" && (
          <div className="px-6 pb-4">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Reference / Transaction ID (optional)
            </label>
            <input
              type="text"
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
                      <span className={sufficient ? "font-bold text-ink" : "text-red-500 font-bold"}>
                        Rs {balance.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedDebitAccount && (
              <p className="mt-2 text-xs text-muted-foreground">
                Total: Rs {total.toFixed(2)}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">
            {error}
          </div>
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
                Confirm Payment — Rs {total.toFixed(2)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
