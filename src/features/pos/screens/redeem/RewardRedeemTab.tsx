import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { posConfirmReward, type RewardRedemptionResult } from "../../api/loyalty";
import { usePosStore } from "../../store";

/**
 * Staff types the redemption code a customer earned by spending points in the
 * app. The points are already spent; confirming only marks the reward as
 * handed over, so this screen never touches a balance itself.
 */
export default function RewardRedeemTab() {
  const currentWorker = usePosStore((s) => s.currentWorker);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RewardRedemptionResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function confirm() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4 || !currentWorker) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await posConfirmReward(trimmed, currentWorker.id);
      setDone(result);
      setCode("");
      toast.success(`${result.customer_name}'s ${result.reward_name} is confirmed.`);
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't confirm that code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The customer redeems their reward in the app and shows you the code. Confirm it here.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
        className="flex gap-2"
      >
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="AB12CD"
          aria-label="Reward redemption code"
          maxLength={12}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3 font-mono text-base uppercase tracking-[0.2em] focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || code.trim().length < 4 || !currentWorker}
          className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-primary-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {done && (
        <div className="rounded-2xl bg-emerald-50 p-4">
          <p className="font-medium text-emerald-700">Reward confirmed</p>
          <p className="mt-0.5 text-sm text-emerald-600">
            {done.customer_name}: <span className="font-medium">{done.reward_name}</span> for{" "}
            {done.points_spent} points.
          </p>
          <p className="mt-1 text-xs text-emerald-600">Hand it over now. The code is spent.</p>
        </div>
      )}
    </div>
  );
}
