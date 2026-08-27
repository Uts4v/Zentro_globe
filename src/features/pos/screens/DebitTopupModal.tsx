import { useState } from "react";
import { safeUuid } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { usePosStore } from "../store";
import { posDebitTopup, DebitAccount } from "../api";
import { X, Plus, Loader2, Check } from "lucide-react";

interface DebitTopupModalProps {
  open: boolean;
  account: DebitAccount;
  onDone: () => void;
  onClose: () => void;
}

const QUICK_AMOUNTS = [10, 20, 50, 100, 200];

export default function DebitTopupModal({
  open,
  account,
  onDone,
  onClose,
}: DebitTopupModalProps) {
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!open) return null;

  const numAmount = parseFloat(amount) || 0;
  const canSubmit = numAmount > 0 && !loading && currentWorker && device;

  async function handleSubmit() {
    if (!canSubmit || !currentWorker || !device) return;
    setLoading(true);
    setError(null);

    try {
      await posDebitTopup({
        account_id: account.id,
        worker_id: currentWorker.id,
        device_id: device.id,
        amount: numAmount,
        client_mutation_id: safeUuid(),
        note,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onDone();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err?.message || "Top-up failed");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    const newBalance = Number(account.balance) + numAmount;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Top-up Complete</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatCurrency(numAmount, currencySymbol)} added to {account.contact_name || "account"}
          </p>
          <p className="mt-3 text-2xl font-bold text-ink">
            New Balance: {formatCurrency(newBalance, currencySymbol)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">
              Top-up Wallet
            </h3>
            <p className="text-xs text-muted-foreground">
              {account.contact_name || "Walk-in"} — Balance: {formatCurrency(account.balance, currencySymbol)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Amount input */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Amount ({currencySymbol})
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.10"
            autoFocus
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-center text-2xl font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Quick amounts */}
        <div className="mb-4 flex gap-2">
          {QUICK_AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(String(amt))}
              className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
                numAmount === amt
                  ? "bg-ink text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {formatCurrency(amt, currencySymbol)}
            </button>
          ))}
        </div>

        {/* Note */}
        <div className="mb-4">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Top Up {formatCurrency(numAmount || 0, currencySymbol)}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
