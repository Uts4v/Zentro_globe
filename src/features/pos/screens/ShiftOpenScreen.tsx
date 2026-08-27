import { useState, useEffect } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { posOpenShift, posGetLastClosedShift, CashShift } from "../api";
import { Wallet, Loader2, ArrowRight, AlertTriangle } from "lucide-react";

interface ShiftOpenProps {
  onShiftOpened: (shift: CashShift) => void;
}

const QUICK_CASH = [0, 50, 100, 200, 500];

export default function ShiftOpenScreen({ onShiftOpened }: ShiftOpenProps) {
  const device = usePosStore((s) => s.device);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [openingCash, setOpeningCash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastClosed, setLastClosed] = useState<CashShift | null>(null);

  useEffect(() => {
    if (!device) return;
    posGetLastClosedShift(device.id)
      .then((resp) => setLastClosed(resp.shift))
      .catch(() => {});
  }, [device?.id]);

  const cash = parseFloat(openingCash) || 0;
  const expectedCash = lastClosed ? Number(lastClosed.closing_cash) : null;
  const cashMismatch = expectedCash !== null && openingCash !== "" && cash !== expectedCash;
  const canSubmit = cash >= 0 && !loading && device && currentWorker;

  async function handleSubmit() {
    if (!canSubmit || !device || !currentWorker) return;
    setLoading(true);
    setError(null);

    try {
      const result = await posOpenShift(device.id, currentWorker.id, cash);
      onShiftOpened(result);
    } catch (err: any) {
      setError(err?.message || "Failed to open shift");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-ink/10">
            <Wallet className="h-8 w-8 text-ink" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Open Shift</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Count the cash in the drawer and enter the opening amount
          </p>
        </div>

        {/* Opening cash input */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Opening Cash ({currencySymbol})
          </label>
          <input
            type="number"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.10"
            autoFocus
            className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-center text-3xl font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Quick cash buttons */}
        <div className="mb-6 flex gap-2">
          {QUICK_CASH.map((amt) => (
            <button
              key={amt}
              onClick={() => setOpeningCash(String(amt))}
              className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
                cash === amt
                  ? "bg-ink text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {amt === 0 ? "Empty" : formatCurrency(amt, currencySymbol)}
            </button>
          ))}
        </div>

        {/* Expected cash from previous shift */}
        {expectedCash !== null && (
          <div className="mb-4 rounded-xl bg-muted/50 px-4 py-2.5 text-center text-xs text-muted-foreground">
            Previous shift closing cash: <span className="font-bold text-foreground">{formatCurrency(expectedCash, currencySymbol)}</span>
          </div>
        )}

        {/* Cash mismatch warning */}
        {cashMismatch && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {cash > expectedCash
              ? `Over by ${formatCurrency(cash - expectedCash, currencySymbol)} from previous shift`
              : `Short by ${formatCurrency(expectedCash - cash, currencySymbol)} from previous shift`}
          </div>
        )}

        {/* Worker info */}
        {currentWorker && (
          <div className="mb-4 rounded-xl bg-muted/50 px-4 py-2.5 text-center text-xs text-muted-foreground">
            Opening as <span className="font-medium text-foreground">{currentWorker.display_name}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-center text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-4 text-sm font-bold text-white transition-colors hover:opacity-90 disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Opening...
            </>
          ) : (
            <>
              Open Shift
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
