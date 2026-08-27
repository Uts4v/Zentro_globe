import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  posCloseShift,
  posListCashMovements,
  posShiftSummary,
  PosCashMovement,
  CashShift,
  ShiftSummary,
} from "../api";
import CashMovementModal from "./CashMovementModal";
import {
  Wallet,
  Loader2,
  ArrowRight,
  Calculator,
  FileText,
  ArrowDownToLine,
  ArrowUpFromLine,
  Plus,
} from "lucide-react";

interface ShiftCloseProps {
  onShiftClosed: (shift: CashShift) => void;
}

const QUICK_CASH = [0, 50, 100, 200, 500];

export default function ShiftCloseScreen({ onShiftClosed }: ShiftCloseProps) {
  const activeShift = usePosStore((s) => s.activeShift);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [closingCash, setClosingCash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedShiftId, setClosedShiftId] = useState<string | null>(null);
  const [showCashMovement, setShowCashMovement] = useState(false);
  const [movements, setMovements] = useState<PosCashMovement[]>([]);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Fetch cash movements and live payment summary for this shift
  useEffect(() => {
    if (activeShift) {
      setSummaryLoading(true);
      Promise.all([
        posListCashMovements(activeShift.id).catch(() => []),
        posShiftSummary(activeShift.id).catch(() => null),
      ]).then(([movementsData, summaryData]) => {
        setMovements(movementsData);
        setSummary(summaryData);
        setSummaryLoading(false);
      });
    }
  }, [activeShift?.id]);

  const cash = parseFloat(closingCash) || 0;
  const canSubmit = cash >= 0 && !loading && currentWorker;

  // Use live summary data if available, fall back to stale store values
  const liveCashSales = summary ? Number(summary.total_cash_sales) : 0;
  const liveOpeningCash = summary ? Number(summary.opening_cash) : activeShift ? Number(activeShift.opening_cash) : 0;
  const livePayouts = summary ? Number(summary.cash_payouts) : 0;
  const livePayins = summary ? Number(summary.cash_payins) : 0;

  // Calculate expected vs actual (considering payouts and payins)
  const totalPayouts = movements
    .filter((m) => m.movement_type === "payout")
    .reduce((sum, m) => sum + Number(m.amount), 0);
  const totalPayins = movements
    .filter((m) => m.movement_type === "payin" || m.movement_type === "cashdrop")
    .reduce((sum, m) => sum + Number(m.amount), 0);

  const expectedCash = liveOpeningCash + liveCashSales - livePayouts + livePayins;
  const difference = cash - expectedCash;

  async function handleSubmit() {
    if (!canSubmit || !activeShift || !currentWorker) return;
    setLoading(true);
    setError(null);

    try {
      const result = await posCloseShift(activeShift.id, currentWorker.id, cash);
      setClosedShiftId(result.id);
      onShiftClosed(result);
    } catch (err: any) {
      setError(err?.message || "Failed to close shift");
    } finally {
      setLoading(false);
    }
  }

  if (!activeShift) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">No active shift to close.</p>
      </div>
    );
  }

  // Show success after shift closed
  if (closedShiftId) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-green-100">
            <Wallet className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Shift Closed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {difference === 0
              ? "Drawer is balanced"
              : difference > 0
                ? `Over by ${formatCurrency(difference, currencySymbol)}`
                : `Short by ${formatCurrency(Math.abs(difference), currencySymbol)}`}
          </p>
          <div className="mt-6 space-y-3">
            <a
              href={`/pos/reports/z-report?shift_id=${closedShiftId}`}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink py-4 text-sm font-bold text-white hover:opacity-90"
            >
              <FileText className="h-4 w-4" />
              View Z-Report
            </a>
            <Link
              to="/pos"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-4 text-sm font-bold text-foreground hover:bg-muted"
            >
              Back to POS
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-amber-100">
            <Wallet className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Close Shift</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Count the cash drawer and enter the closing amount
          </p>
        </div>

        {/* Shift summary with cash movement breakdown */}
        <div className="mb-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calculator className="h-4 w-4 text-ink" />
            <h3 className="text-xs font-bold text-foreground uppercase tracking-wide">
              Shift Summary
            </h3>
            {summaryLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Opening Cash</span>
              <span className="font-medium text-foreground">{formatCurrency(liveOpeningCash, currencySymbol)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Cash Sales ({summary?.total_orders ?? 0} orders)</span>
              <span className="font-medium text-green-600">+{formatCurrency(liveCashSales, currencySymbol)}</span>
            </div>
            {summary && Number(summary.total_card_sales) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Card Sales</span>
                <span className="font-medium text-foreground">
                  {formatCurrency(summary.total_card_sales, currencySymbol)}
                </span>
              </div>
            )}
            {totalPayouts > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ArrowUpFromLine className="h-3 w-3 text-red-500" />
                  Pay-outs
                </span>
                <span className="font-medium text-red-600">-{formatCurrency(totalPayouts, currencySymbol)}</span>
              </div>
            )}
            {totalPayins > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ArrowDownToLine className="h-3 w-3 text-green-500" />
                  Pay-ins
                </span>
                <span className="font-medium text-green-600">+{formatCurrency(totalPayins, currencySymbol)}</span>
              </div>
            )}
            <div className="border-t border-border pt-2 flex justify-between font-bold text-foreground">
              <span>Expected in Drawer</span>
              <span>{formatCurrency(expectedCash, currencySymbol)}</span>
            </div>
          </div>
        </div>

        {/* Cash movement button */}
        <button
          onClick={() => setShowCashMovement(true)}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
          Record Pay-in / Pay-out
        </button>

        {/* Recent movements */}
        {movements.length > 0 && (
          <div className="mb-4 rounded-xl bg-muted/30 px-3 py-2">
            <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
              Cash Movements
            </p>
            {movements.slice(0, 5).map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  {m.movement_type === "payout" ? (
                    <ArrowUpFromLine className="h-3 w-3 text-red-500" />
                  ) : (
                    <ArrowDownToLine className="h-3 w-3 text-green-500" />
                  )}
                  {m.reason || m.movement_type}
                </span>
                <span className={m.movement_type === "payout" ? "text-red-600" : "text-green-600"}>
                  {m.movement_type === "payout" ? "-" : "+"} {formatCurrency(m.amount, currencySymbol)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Closing cash input */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Closing Cash ({currencySymbol})
          </label>
          <input
            type="number"
            value={closingCash}
            onChange={(e) => setClosingCash(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.10"
            autoFocus
            className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-center text-3xl font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Quick cash buttons */}
        <div className="mb-4 flex gap-2">
          {QUICK_CASH.map((amt) => (
            <button
              key={amt}
              onClick={() => setClosingCash(String(amt))}
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

        {/* Difference indicator */}
        {closingCash !== "" && (
          <div
            className={`mb-4 rounded-xl p-3 text-center text-sm font-bold ${
              difference === 0
                ? "bg-green-50 text-green-700"
                : difference > 0
                  ? "bg-blue-50 text-blue-700"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {difference === 0
              ? "Drawer is balanced"
              : difference > 0
                ? `Over by ${formatCurrency(difference, currencySymbol)}`
                : `Short by ${formatCurrency(Math.abs(difference), currencySymbol)}`}
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
              Closing...
            </>
          ) : (
            <>
              Close Shift
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Cash Movement Modal */}
      <CashMovementModal
        open={showCashMovement}
        onClose={() => setShowCashMovement(false)}
        onRecorded={async () => {
          if (activeShift) {
            const [movementsData, summaryData] = await Promise.all([
              posListCashMovements(activeShift.id),
              posShiftSummary(activeShift.id).catch(() => null),
            ]);
            setMovements(movementsData);
            setSummary(summaryData);
          }
        }}
      />
    </div>
  );
}
