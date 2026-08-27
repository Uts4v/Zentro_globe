import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  posCreateCashMovement,
  posListCashMovements,
  PosCashMovement,
} from "../api";
import {
  HandCoins,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Plus,
  ArrowDownToLine,
  Banknote,
} from "lucide-react";

type MovementType = "payin" | "payout" | "cashdrop";

const TYPE_CONFIG: Record<MovementType, { label: string; icon: any; color: string; bg: string }> = {
  payin: { label: "Pay-in", icon: ArrowDownToLine, color: "text-green-600", bg: "bg-green-50" },
  payout: { label: "Pay-out", icon: ArrowUpRight, color: "text-red-600", bg: "bg-red-50" },
  cashdrop: { label: "Cash Drop", icon: Banknote, color: "text-blue-600", bg: "bg-blue-50" },
};

export default function CashMovementsScreen() {
  const activeShift = usePosStore((s) => s.activeShift);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [movements, setMovements] = useState<PosCashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<MovementType>("payin");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadMovements();
  }, [activeShift?.id]);

  async function loadMovements() {
    if (!activeShift) {
      setMovements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await posListCashMovements(activeShift.id);
      setMovements(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (!activeShift || !currentWorker) {
      setError("No active shift or worker");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await posCreateCashMovement({
        shift_id: activeShift.id,
        worker_id: currentWorker.id,
        movement_type: formType,
        amount: amt,
        reason: reason || undefined,
      });
      setSuccess(true);
      setTimeout(() => {
        setShowForm(false);
        setSuccess(false);
        setAmount("");
        setReason("");
        loadMovements();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Failed to record movement");
    } finally {
      setSubmitting(false);
    }
  }

  const totalPayins = movements
    .filter((m) => m.movement_type === "payin" || m.movement_type === "cashdrop")
    .reduce((sum, m) => sum + Number(m.amount), 0);
  const totalPayouts = movements
    .filter((m) => m.movement_type === "payout")
    .reduce((sum, m) => sum + Number(m.amount), 0);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HandCoins className="h-5 w-5 text-ink" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Cash In/Out</h1>
            <p className="text-xs text-muted-foreground">
              {activeShift
                ? `Shift #${String(activeShift.id).slice(0, 8)}`
                : "No active shift"}
            </p>
          </div>
        </div>
        {activeShift && (
          <button
            onClick={() => {
              setShowForm(true);
              setError(null);
              setSuccess(false);
            }}
            className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
          >
            <Plus className="h-4 w-4" />
            New Entry
          </button>
        )}
      </div>

      {/* Summary */}
      {activeShift && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Pay-ins</p>
            <p className="mt-1 text-lg font-bold text-green-600">
              {formatCurrency(totalPayins, currencySymbol)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Pay-outs</p>
            <p className="mt-1 text-lg font-bold text-red-600">
              {formatCurrency(totalPayouts, currencySymbol)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Net</p>
            <p className={`mt-1 text-lg font-bold ${totalPayins - totalPayouts >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(totalPayins - totalPayouts, currencySymbol)}
            </p>
          </div>
        </div>
      )}

      {/* Movement list */}
      {!activeShift ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <HandCoins className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">Open a shift to record cash movements</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : movements.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <HandCoins className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No cash movements today</p>
        </div>
      ) : (
        <div className="space-y-2">
          {movements.map((m) => {
            const cfg = TYPE_CONFIG[m.movement_type] || TYPE_CONFIG.payin;
            const Icon = cfg.icon;
            const isPositive = m.movement_type === "payin" || m.movement_type === "cashdrop";
            return (
              <div
                key={m.id}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4"
              >
                <div className={`grid h-10 w-10 place-items-center rounded-xl ${cfg.bg}`}>
                  <Icon className={`h-5 w-5 ${cfg.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{cfg.label}</p>
                  {m.reason && (
                    <p className="text-xs text-muted-foreground truncate">{m.reason}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(m.created_at).toLocaleTimeString()} · {m.worker_name || "Unknown"}
                  </p>
                </div>
                <p className={`text-lg font-bold ${isPositive ? "text-green-600" : "text-red-600"}`}>
                  {isPositive ? "+" : "-"} {formatCurrency(m.amount, currencySymbol)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* New Entry Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            {success ? (
              <div className="flex flex-col items-center py-4">
                <p className="text-lg font-bold text-foreground">Recorded</p>
              </div>
            ) : (
              <>
                <h2 className="mb-4 text-lg font-bold text-foreground">New Cash Entry</h2>

                {/* Type selector */}
                <div className="mb-4 flex gap-2">
                  {(["payin", "payout", "cashdrop"] as MovementType[]).map((t) => {
                    const cfg = TYPE_CONFIG[t];
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          setFormType(t);
                          setError(null);
                        }}
                        className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-medium capitalize transition-colors ${
                          formType === t
                            ? "bg-ink text-white"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>

                {/* Amount */}
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

                {/* Reason */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Reason (optional)
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Supplier payment"
                    className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>

                {error && (
                  <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowForm(false);
                      setAmount("");
                      setReason("");
                      setError(null);
                    }}
                    className="flex-1 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !amount}
                    className="flex-1 rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white hover:bg-ink/90 disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    ) : (
                      "Record"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
