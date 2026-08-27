import { useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posCreditSale, CreditAccount } from "../api";
import { Loader2, X, CheckCircle, ArrowUpRight } from "lucide-react";

interface Props {
  open: boolean;
  account: CreditAccount;
  orderId: string;
  onDone: (newBalance?: string) => void;
  onClose: () => void;
}

export default function CreditSaleModal({
  open,
  account,
  orderId,
  onDone,
  onClose,
}: Props) {
  const worker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [newBalance, setNewBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const avail = Number(account.available_credit);

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (amt > avail) {
      setError(`Insufficient credit. Available: ${formatCurrency(avail, currencySymbol)}`);
      return;
    }
    if (!worker) {
      setError("No worker logged in");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await posCreditSale({
        account_id: account.id,
        order_id: orderId,
        worker_id: worker.id,
        amount: amt,
        note: note || undefined,
      });
      setNewBalance(result.balance_after);
      setSuccess(true);
      setTimeout(() => onDone(result.balance_after), 1500);
    } catch (err: any) {
      setError(err?.message || "Failed to record credit sale");
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
            <p className="text-lg font-bold text-foreground">Sale Recorded</p>
            <p className="text-sm text-muted-foreground">
              New balance: {formatCurrency(newBalance || 0, currencySymbol)}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-amber-500" />
                <h2 className="text-lg font-bold text-foreground">Credit Sale</h2>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-xl bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground">Account</p>
              <p className="text-sm font-bold text-foreground">{account.contact_name}</p>
              <p className="text-xs text-muted-foreground">
                Available credit: {formatCurrency(avail, currencySymbol)}
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
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Lunch order"
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
              className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-white hover:bg-ink/90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                "Confirm Credit Sale"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
