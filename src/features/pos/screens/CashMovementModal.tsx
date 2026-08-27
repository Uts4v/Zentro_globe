import { useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posCreateCashMovement } from "../api";
import { X, ArrowDownToLine, ArrowUpFromLine, Landmark, Loader2 } from "lucide-react";

interface CashMovementModalProps {
  open: boolean;
  onClose: () => void;
  onRecorded: () => void;
}

type MovementType = "payout" | "payin" | "cashdrop";

const MOVEMENT_TYPES: Array<{
  key: MovementType;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}> = [
  { key: "payin", label: "Pay-in", description: "Cash added to drawer", icon: ArrowDownToLine, color: "bg-green-100 text-green-700" },
  { key: "payout", label: "Pay-out", description: "Cash removed from drawer", icon: ArrowUpFromLine, color: "bg-red-100 text-red-700" },
  { key: "cashdrop", label: "Cash Drop", description: "Bank deposit from drawer", icon: Landmark, color: "bg-blue-100 text-blue-700" },
];

export default function CashMovementModal({ open, onClose, onRecorded }: CashMovementModalProps) {
  const activeShift = usePosStore((s) => s.activeShift);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [type, setType] = useState<MovementType>("payout");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit() {
    if (!activeShift || !currentWorker) return;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return;

    setLoading(true);
    setError(null);
    try {
      await posCreateCashMovement({
        shift_id: activeShift.id,
        worker_id: currentWorker.id,
        movement_type: type,
        amount: amt,
        reason,
      });
      onRecorded();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to record movement");
    } finally {
      setLoading(false);
    }
  }

  const amt = parseFloat(amount) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-md rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-base font-bold text-foreground">Record Cash Movement</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Movement type selector */}
        <div className="grid grid-cols-3 gap-2 px-6 py-4">
          {MOVEMENT_TYPES.map((mt) => {
            const Icon = mt.icon;
            const active = type === mt.key;
            return (
              <button
                key={mt.key}
                onClick={() => setType(mt.key)}
                className={`flex flex-col items-center gap-1.5 rounded-xl p-3 text-[11px] font-medium transition-colors ${
                  active ? "bg-ink text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span>{mt.label}</span>
              </button>
            );
          })}
        </div>

        {/* Amount */}
        <div className="px-6 pb-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount ({currencySymbol})</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.10"
            autoFocus
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Quick amounts */}
        <div className="flex gap-2 px-6 pb-3">
          {[50, 100, 200, 500, 1000].map((amt) => (
            <button
              key={amt}
              onClick={() => setAmount(String(amt))}
              className="flex-1 rounded-lg bg-muted py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
            >
              {formatCurrency(amt, currencySymbol)}
            </button>
          ))}
        </div>

        {/* Reason */}
        <div className="px-6 pb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              type === "payout" ? "e.g. Bought cigarettes for customer" :
              type === "payin" ? "e.g. Added personal cash to drawer" :
              "e.g. End of shift bank deposit"
            }
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 rounded-xl bg-red-50 p-3 text-xs text-red-600">{error}</div>
        )}

        {/* Submit */}
        <div className="px-6 pb-6">
          <button
            onClick={handleSubmit}
            disabled={loading || amt <= 0}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3.5 text-sm font-bold text-white transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Recording...</>
            ) : (
              <>Record {type === "payout" ? "Pay-out" : type === "payin" ? "Pay-in" : "Cash Drop"} — {formatCurrency(amt, currencySymbol)}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
