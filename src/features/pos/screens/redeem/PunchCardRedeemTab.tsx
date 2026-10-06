import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { posConfirmPunchCard, type PunchCardRedemptionResult } from "../../api/loyalty";
import { usePosStore } from "../../store";

/**
 * Staff types the 6-character code the customer shows on a full stamp card.
 *
 * Confirming creates a zero-value reward order so the free item reaches the
 * kitchen and prints on the receipt, then starts the customer's next card. The
 * server decides whether the code is valid, so this screen never guesses.
 */
export default function PunchCardRedeemTab() {
  const currentWorker = usePosStore((s) => s.currentWorker);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PunchCardRedemptionResult | null>(null);
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
      const result = await posConfirmPunchCard(trimmed, currentWorker.id);
      setDone(result);
      setCode("");
      toast.success(`${result.customer_name}'s reward is confirmed.`);
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't confirm that code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Ask the customer for the 6-character code on their full stamp card.
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
          placeholder="ABC123"
          aria-label="Punch card code"
          maxLength={6}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3 font-mono text-base uppercase tracking-[0.25em] focus:border-ink focus:outline-none"
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
            {done.customer_name} receives: <span className="font-medium">{done.reward_text}</span>
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            Added to the kitchen as a free item. Their next stamp card has started.
          </p>
        </div>
      )}
    </div>
  );
}
