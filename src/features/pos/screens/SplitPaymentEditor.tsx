import { formatCurrency } from "@/lib/currency";
import type { PosPaymentQr } from "../api";
import { evaluateSplitPayment, type SplitPaymentState } from "../split-payment";
import PaymentQrBlock from "./PaymentQrBlock";

interface SplitPaymentEditorProps {
  total: number;
  currencySymbol: string;
  qr: PosPaymentQr;
  state: SplitPaymentState;
  onChange: (state: SplitPaymentState) => void;
}

export default function SplitPaymentEditor({
  total,
  currencySymbol,
  qr,
  state,
  onChange,
}: SplitPaymentEditorProps) {
  const breakdown = evaluateSplitPayment(total, state);
  const reference = state.reference;

  function update(patch: Partial<SplitPaymentState>) {
    onChange({ ...state, ...patch });
  }

  return (
    <div className="space-y-4 border-t border-border px-6 py-4">
      <div>
        <p className="text-sm font-bold text-foreground">Split payment</p>
        <p className="text-xs text-muted-foreground">
          Take part on the QR and the rest in cash. Change comes from the cash portion.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Amount paid by QR
        </label>
        <input
          type="number"
          value={state.qrAmount}
          onChange={(e) => update({ qrAmount: e.target.value, qrConfirmed: false })}
          placeholder="0.00"
          min={0}
          max={Math.max(0, total - 0.01)}
          step="0.01"
          className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
        <div className="mt-2 flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Cash portion</span>
          <span className="numeric font-bold text-ink">
            {formatCurrency(breakdown.cashPortion, currencySymbol)}
          </span>
        </div>
      </div>

      {breakdown.qrPortion > 0 && (
        <PaymentQrBlock
          qr={qr}
          amount={breakdown.qrPortion}
          currencySymbol={currencySymbol}
          confirmed={state.qrConfirmed}
          onConfirmedChange={(confirmed) => update({ qrConfirmed: confirmed })}
        />
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          QR reference / Transaction ID (optional)
        </label>
        <input
          type="text"
          value={reference}
          onChange={(e) => update({ reference: e.target.value })}
          placeholder="e.g. TXN-123456"
          className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Cash received
        </label>
        <input
          type="number"
          value={state.cashReceived}
          onChange={(e) => update({ cashReceived: e.target.value })}
          placeholder="0.00"
          min={0}
          step="0.10"
          className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => update({ cashReceived: breakdown.cashPortion.toFixed(2) })}
            className="min-h-[44px] flex-1 rounded-lg bg-muted px-2 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/80"
          >
            Exact cash
          </button>
        </div>
        {breakdown.change > 0 && (
          <p className="mt-2 rounded-xl bg-green-50 p-2 text-center text-sm font-bold text-green-700">
            Change: {formatCurrency(breakdown.change, currencySymbol)}
          </p>
        )}
      </div>

      {breakdown.error && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700">{breakdown.error}</p>
      )}
    </div>
  );
}
