import { useState } from "react";
import { posProcessRefund, PosOrder } from "../api";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { AlertCircle, Loader2, X, RotateCcw, DollarSign } from "lucide-react";

interface RefundModalProps {
  order: PosOrder;
  onClose: () => void;
  onRefunded: () => void;
}

export default function RefundModal({ order, onClose, onRefunded }: RefundModalProps) {
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [refundType, setRefundType] = useState<"full" | "partial">("full");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderTotal = Number(order.total_amount);
  const refundAmount = refundType === "full" ? orderTotal : parseFloat(amount) || 0;
  const canSubmit = refundAmount > 0 && refundAmount <= orderTotal && reason.trim() && !loading && currentWorker;

  async function handleSubmit() {
    if (!canSubmit || !currentWorker) return;
    setLoading(true);
    setError(null);

    try {
      await posProcessRefund({
        order_id: String(order.uuid),
        worker_id: currentWorker.id,
        reason: reason.trim(),
        amount: refundType === "full" ? undefined : refundAmount,
        refund_method: refundMethod,
      });
      onRefunded();
    } catch (err: any) {
      setError(err?.message || "Refund failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-bold text-foreground">Process Refund</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Order info */}
          <div className="rounded-xl bg-muted/50 p-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Order #{order.id}</span>
              <span className="font-bold text-foreground">{formatCurrency(orderTotal, currencySymbol)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {order.items?.length || 0} items &middot; {order.payment_method}
            </p>
          </div>

          {/* Refund type */}
          <div>
            <label className="mb-2 block text-xs font-bold text-foreground">Refund Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setRefundType("full")}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  refundType === "full" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Full Refund
              </button>
              <button
                onClick={() => setRefundType("partial")}
                className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-colors ${
                  refundType === "partial" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Partial Refund
              </button>
            </div>
          </div>

          {/* Partial amount input */}
          {refundType === "partial" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount ({currencySymbol})</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  min={0.01}
                  max={orderTotal}
                  step="0.10"
                  className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Maximum: {formatCurrency(orderTotal, currencySymbol)}
              </p>
            </div>
          )}

          {/* Refund method */}
          <div>
            <label className="mb-2 block text-xs font-bold text-foreground">Refund Method</label>
            <div className="flex gap-2">
              {["cash", "card", "credit", "debit"].map((method) => (
                <button
                  key={method}
                  onClick={() => setRefundMethod(method)}
                  className={`flex-1 rounded-xl py-2 text-xs font-medium capitalize transition-colors ${
                    refundMethod === method
                      ? "bg-ink text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Enter refund reason..."
              rows={2}
              className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>

          {/* Refund amount preview */}
          <div className="rounded-xl bg-red-50 p-3 text-center">
            <p className="text-xs text-red-600">Refund Amount</p>
            <p className="text-2xl font-bold text-red-700">- {formatCurrency(refundAmount, currencySymbol)}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t border-border px-5 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 py-3 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                Refund
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
