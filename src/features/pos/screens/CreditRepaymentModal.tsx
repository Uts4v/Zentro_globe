import { useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posCreditRepayment, CreditAccount } from "../api";
import { Loader2, X, CheckCircle, Minus } from "lucide-react";

interface Props {
  open: boolean;
  account: CreditAccount;
  onDone: (newBalance?: string) => void;
  onClose: () => void;
}

export default function CreditRepaymentModal({
  open,
  account,
  onDone,
  onClose,
}: Props) {
  const worker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [newBalance, setNewBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const owed = Number(account.current_balance);

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (amt > owed) {
      setError(`Amount exceeds owed balance of ${formatCurrency(owed, currencySymbol)}`);
      return;
    }
    if (!worker) {
      setError("No worker logged in");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await posCreditRepayment({
        account_id: account.id,
        worker_id: worker.id,
        amount: amt,
        payment_method: paymentMethod,
        note: note || undefined,
      });
      setNewBalance(result.balance_after);
      setSuccess(true);
      setTimeout(() => onDone(result.balance_after), 1500);
    } catch (err: any) {
      setError(err?.message || "Failed to record repayment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        {success ? (
          <div className="flex flex-col items-center py-4">
            <CheckCircle className="mb-3 h-12 w-12 text-green-500" />
            <p className="text-lg font-bold text-foreground">Payment Recorded</p>
            <p className="text-sm text-muted-foreground">
              Remaining balance: {formatCurrency(newBalance || 0, currencySymbol)}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Minus className="h-5 w-5 text-green-500" />
                <h2 className="text-lg font-bold text-foreground">Record Payment</h2>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Account</p>
              <p className="text-sm font-bold text-foreground">{account.contact_name}</p>
              <p className="text-xs text-red-600">
                Amount owed: {formatCurrency(owed, currencySymbol)}
              </p>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-foreground">
                Amount ({currencySymbol})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-foreground">
                Payment Method
              </label>
              <div className="flex gap-2">
                {["cash", "card", "bank_qr", "mobile_wallet"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      paymentMethod === m
                        ? "bg-ink text-white"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {m.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-foreground">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Cash payment"
                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading || !amount}
              className="w-full rounded-xl bg-green-600 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                "Record Payment"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
