import { useState } from "react";
import { usePosStore } from "../store";
import {
  posApplyDiscount,
  posWorkerLogin,
  ShiftWorker,
} from "../api";
import {
  X,
  Percent,
  DollarSign,
  Lock,
  AlertTriangle,
  Check,
  Loader2,
} from "lucide-react";

interface DiscountModalProps {
  open: boolean;
  orderId: string;
  onApplied: () => void;
  onClose: () => void;
}

export default function DiscountModal({
  open,
  orderId,
  onApplied,
  onClose,
}: DiscountModalProps) {
  const currentWorker = usePosStore((s) => s.currentWorker);
  const posSettings = usePosStore((s) => s.posSettings);
  const [type, setType] = useState<"percentage" | "fixed">("percentage");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manager approval state
  const [needsApproval, setNeedsApproval] = useState(false);
  const [managerWorker, setManagerWorker] = useState<ShiftWorker | null>(null);
  const [managerPin, setManagerPin] = useState("");
  const [managerError, setManagerError] = useState<string | null>(null);
  const [verifyingManager, setVerifyingManager] = useState(false);

  if (!open) return null;

  const numValue = parseFloat(value) || 0;
  const maxDiscount = posSettings
    ? parseFloat(posSettings.max_worker_discount_percent)
    : 0;
  const approvalThreshold = posSettings
    ? parseFloat(posSettings.manager_approval_threshold)
    : 0;

  const exceedsLimit =
    type === "percentage"
      ? numValue > maxDiscount && maxDiscount > 0
      : numValue > approvalThreshold && approvalThreshold > 0;

  const canSubmit =
    numValue > 0 &&
    !submitting &&
    (type === "fixed" || (numValue > 0 && numValue <= 100));

  async function handleManagerVerify() {
    if (!managerWorker || managerPin.length < 4) return;
    setVerifyingManager(true);
    setManagerError(null);

    try {
      await posWorkerLogin(managerWorker.id, managerPin);
      setNeedsApproval(false);
      // Now submit with manager approval
      await doSubmit(managerWorker.id);
    } catch (err: any) {
      setManagerError(err?.message || "Invalid PIN");
      setManagerPin("");
    } finally {
      setVerifyingManager(false);
    }
  }

  async function doSubmit(authorizedByWorkerId?: string) {
    if (!currentWorker) return;
    setSubmitting(true);
    setError(null);

    try {
      await posApplyDiscount({
        order_id: orderId,
        worker_id: currentWorker.id,
        discount_type: type,
        discount_value: numValue,
        reason,
        authorized_by_worker_id: authorizedByWorkerId,
        source: "pos",
      });
      onApplied();
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to apply discount");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    if (exceedsLimit && !needsApproval) {
      // Require manager approval
      setNeedsApproval(true);
      return;
    }

    await doSubmit();
  }

  // ── Manager PIN verification overlay ──
  if (needsApproval) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-100">
              <Lock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">
                Manager Approval Required
              </h3>
              <p className="text-xs text-muted-foreground">
                This discount exceeds your limit. A manager must approve.
              </p>
            </div>
          </div>

          {/* Manager selection */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Manager
            </label>
            <select
              onChange={(e) => {
                const workers = usePosStore.getState().workers;
                const w = workers.find((w) => w.id === e.target.value);
                setManagerWorker(w ?? null);
              }}
              className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            >
              <option value="">Select manager...</option>
              {usePosStore
                .getState()
                .workers.filter((w) => w.role === "manager" || w.can_apply_discount)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.display_name} ({w.role})
                  </option>
                ))}
            </select>
          </div>

          {/* Manager PIN */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Manager PIN
            </label>
            <input
              type="password"
              maxLength={4}
              value={managerPin}
              onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4-digit PIN"
              autoFocus
              className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-center text-lg tracking-[0.5em] focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>

          {managerError && (
            <p className="mb-3 text-center text-xs text-destructive">
              {managerError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => {
                setNeedsApproval(false);
                setManagerWorker(null);
                setManagerPin("");
                setManagerError(null);
              }}
              className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={handleManagerVerify}
              disabled={!managerWorker || managerPin.length < 4 || verifyingManager}
              className="flex-1 rounded-xl bg-ink py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
            >
              {verifyingManager ? (
                <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              ) : (
                "Approve"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main discount form ──
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">
            Apply Discount
          </h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type toggle */}
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setType("percentage")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
              type === "percentage"
                ? "bg-ink text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <Percent className="h-4 w-4" />
            Percentage
          </button>
          <button
            onClick={() => setType("fixed")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors ${
              type === "fixed"
                ? "bg-ink text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            <DollarSign className="h-4 w-4" />
            Fixed (Rs)
          </button>
        </div>

        {/* Value input */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {type === "percentage" ? "Discount %" : "Amount (Rs)"}
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
              {type === "percentage" ? "%" : "Rs"}
            </span>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0"
              min={0}
              max={type === "percentage" ? 100 : undefined}
              autoFocus
              className="w-full rounded-xl border border-border bg-muted/50 py-3 pl-12 pr-4 text-lg font-bold focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>
          {type === "percentage" && maxDiscount > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Your limit: {maxDiscount}%
            </p>
          )}
        </div>

        {/* Reason */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. VIP customer, complaint..."
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </div>

        {/* Warning for exceeding limit */}
        {exceedsLimit && (
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This discount exceeds your limit. A manager will need to approve
              it with their PIN.
            </p>
          </div>
        )}

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
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ember py-3 text-sm font-bold text-white shadow-[var(--shadow-ember)] hover:brightness-105 disabled:opacity-40"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Applying...
            </>
          ) : (
            <>
              <Check className="h-4 w-4" />
              Apply Discount
            </>
          )}
        </button>
      </div>
    </div>
  );
}
