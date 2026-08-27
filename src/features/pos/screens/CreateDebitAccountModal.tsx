import { useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posCreateDebitAccount } from "../api";
import { X, UserPlus, Loader2, Check } from "lucide-react";

interface CreateDebitAccountModalProps {
  open: boolean;
  onDone: () => void;
  onClose: () => void;
}

const QUICK_BALANCES = [10, 20, 50, 100, 200];

export default function CreateDebitAccountModal({
  open,
  onDone,
  onClose,
}: CreateDebitAccountModalProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [balance, setBalance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  if (!open) return null;

  const numBalance = parseFloat(balance) || 0;
  const canSubmit = name.trim().length > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    try {
      await posCreateDebitAccount({
        contact_name: name.trim(),
        contact_phone: phone.trim(),
        initial_balance: numBalance,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onDone();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err?.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-green-100">
            <Check className="h-8 w-8 text-green-600" />
          </div>
          <h3 className="text-lg font-bold text-foreground">Account Created</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Debit wallet created for {name}
          </p>
          {numBalance > 0 && (
            <p className="mt-3 text-2xl font-bold text-ink">
              {formatCurrency(numBalance, currencySymbol)} loaded
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">
              New Debit Account
            </h3>
            <p className="text-xs text-muted-foreground">
              Create a prepaid wallet for a customer
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Contact Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
            autoFocus
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Phone Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Initial Balance ({currencySymbol})
          </label>
          <input
            type="number"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.10"
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-center text-2xl font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        <div className="mb-4 flex gap-2">
          {QUICK_BALANCES.map((amt) => (
            <button
              key={amt}
              onClick={() => setBalance(String(amt))}
              className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
                numBalance === amt
                  ? "bg-ink text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {formatCurrency(amt, currencySymbol)}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-xs text-red-600">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" />
              Create Account
            </>
          )}
        </button>
      </div>
    </div>
  );
}
