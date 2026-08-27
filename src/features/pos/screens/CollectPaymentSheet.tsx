import { useState, useEffect } from "react";
import { safeUuid } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { usePosStore } from "../store";
import {
  posCreatePayment,
  posReceiptData,
  PosOrder,
  PosReceiptData,
  posListDebitAccounts,
  DebitAccount,
} from "../api";
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
} from "lucide-react";

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

interface CollectPaymentSheetProps {
  order: PosOrder;
  onClose: () => void;
  onPaid: () => void;
}

export default function CollectPaymentSheet({ order, onClose, onPaid }: CollectPaymentSheetProps) {
  const merchant = usePosStore((s) => s.merchant);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const activeShift = usePosStore((s) => s.activeShift);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debitAccounts, setDebitAccounts] = useState<DebitAccount[]>([]);
  const [selectedDebitAccount, setSelectedDebitAccount] = useState<string>("");

  useEffect(() => {
    if (method === "debit" && debitAccounts.length === 0) {
      posListDebitAccounts()
        .then(setDebitAccounts)
        .catch(() => {});
    }
  }, [method]);

  const [receiptData, setReceiptData] = useState<PosReceiptData | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  const total = Number(order.total_amount);
  const cashAmount = parseFloat(cashReceived) || 0;
  const change = method === "cash" ? Math.max(0, cashAmount - total) : 0;
  const isCashValid = method === "cash" ? cashAmount >= total : true;
  const isDebitValid =
    method !== "debit" ||
    (selectedDebitAccount &&
      debitAccounts.find((a) => a.id === selectedDebitAccount && Number(a.balance) >= total));
  const canSubmit = !submitting && isCashValid && isDebitValid;

  async function handleSubmit() {
    if (!canSubmit || !merchant || !currentWorker || !device || !activeShift) return;

    setSubmitting(true);
    setError(null);

    try {
      await posCreatePayment({
        order_id: String(order.uuid),
        shift_id: activeShift.id,
        worker_id: currentWorker.id,
        device_id: device.id,
        payment_method: method,
        amount: total,
        change_amount: method === "cash" ? change : 0,
        debit_account_id: method === "debit" ? selectedDebitAccount : undefined,
        client_mutation_id: safeUuid(),
      });

      setLoadingReceipt(true);
      try {
        const receipt = await posReceiptData(String(order.uuid));
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

  // Receipt view after payment
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
              onClick={() => {
                setReceiptData(null);
                onClose();
                onPaid();
              }}
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
                <p className="text-xs text-green-600">Change to give: {formatCurrency(change, currencySymbol)}</p>
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
                <Receipt data={receiptData} showPrintButton={true} currencySymbol={currencySymbol} />
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
              className="flex-1 rounded-xl bg-ink py-3 text-sm font-bold text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Payment form
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-base font-bold text-foreground">
            Collect Payment — Order #{order.id}
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-6 py-4 text-center">
          <p className="text-xs text-muted-foreground">Amount to pay</p>
          <p className="numeric mt-1 text-3xl font-bold tracking-tight text-ink">
            {formatCurrency(total, currencySymbol)}
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
                  active ? "bg-ink text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
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
          </div>
        )}

        {error && (
          <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">{error}</div>
        )}

        <div className="px-6 pb-6">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3.5 text-sm font-bold text-white transition-colors hover:opacity-90 disabled:opacity-40"
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
