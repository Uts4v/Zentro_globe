import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, KeyRound, Loader2 } from "lucide-react";
import { redeemWithStorePin, type OfferClaim } from "@/lib/api/offers";
import { safeUuid } from "@/lib/utils";
import { btnPrimary, btnSecondary } from "../lib/ui";

const field =
  "h-12 w-full rounded-2xl border border-border bg-card px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

/**
 * Fallback when the store can't scan: staff type the store PIN on the
 * customer's phone. The customer never learns the PIN; the merchant is
 * notified each time it's used.
 */
export function StorePinConfirm({
  claim,
  onDone,
}: {
  claim: OfferClaim;
  onDone: (claim: OfferClaim) => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [bill, setBill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const attemptKey = useRef(safeUuid());
  const currency = claim.offer.merchant.currency_symbol || "Rs";

  async function submit() {
    if (claim.needs_bill_amount && !(Number(bill) > 0)) {
      setError(`Enter the ${claim.bill_label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await redeemWithStorePin(claim.id, {
        pin,
        idempotency_key: attemptKey.current,
        ...(claim.needs_bill_amount ? { bill_amount: bill } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ["offers"] });
      onDone(result.claim);
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      setPin("");
      // A refused attempt is final for that key; the next try gets a new one.
      attemptKey.current = safeUuid();
      if (err.code === "PIN_LOCKED") setLocked(true);
      setError(err.message || "Couldn't confirm the offer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[20px] border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <KeyRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex-1 text-sm font-semibold text-foreground">
          Store can't scan? Confirm with store PIN
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-3 border-t border-border px-4 pb-4 pt-3"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Hand your phone to the staff. They type the store PIN to confirm this offer, and it will
            be marked as used.
          </p>
          {claim.needs_bill_amount && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                {claim.bill_label} ({currency})
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={bill}
                onChange={(e) => setBill(e.target.value)}
                disabled={locked}
                className={field}
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Store PIN (staff only)
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              disabled={locked}
              className={`${field} text-center font-mono text-lg tracking-[0.4em]`}
            />
          </label>
          {error && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || locked || pin.length < 4}
              className={btnPrimary}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Confirm use
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
