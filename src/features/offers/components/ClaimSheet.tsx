import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, KeyRound, Loader2, MapPin, X } from "lucide-react";
import { redeemWithStorePin, type OfferClaim } from "@/lib/api/offers";
import { formatCurrency } from "@/lib/currency";
import { safeUuid } from "@/lib/utils";
import { formatExpiry } from "./OfferCard";

const STATUS_TEXT: Record<OfferClaim["status"], string> = {
  available: "Ready to use",
  reserved: "Applied to an order",
  redeemed: "Used",
  expired: "Expired",
  revoked: "Withdrawn by the store",
};

/** The customer's voucher: QR + code, shown at the counter or used at checkout. */
export function ClaimSheet({
  claim: initialClaim,
  onClose,
}: {
  claim: OfferClaim;
  onClose: () => void;
}) {
  // Local copy so the sheet reflects a PIN confirmation immediately.
  const [claim, setClaim] = useState(initialClaim);
  const [confirmed, setConfirmed] = useState<{ at: string; discount: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const usable = claim.tab === "available";
  const pinAllowed = usable && claim.store_pin_enabled && claim.offer.channels !== "online";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(claim.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context): the code is still visible
    }
  }

  const where =
    claim.offer.channels === "in_store"
      ? "Show this at the counter."
      : claim.offer.channels === "online"
        ? "Apply it when you order in the app."
        : "Show this at the counter, or apply it when you order in the app.";

  const sheet = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-sheet-title"
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-card p-6 sm:rounded-[28px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-muted-foreground">
              {claim.offer.merchant.name}
            </p>
            <h2
              id="claim-sheet-title"
              className="font-display text-2xl leading-tight text-foreground"
            >
              {claim.offer.summary}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{claim.offer.title}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          className={`mt-5 flex flex-col items-center rounded-3xl bg-white p-5 ${usable ? "" : "opacity-40"}`}
        >
          <QRCodeSVG
            value={claim.qr_payload}
            size={196}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
          />
          <button
            onClick={copy}
            className="mt-3 inline-flex items-center gap-2 font-mono text-lg font-bold tracking-widest text-black"
          >
            {claim.code}
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4 text-neutral-500" />
            )}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs">
          <span
            className={`rounded-full px-3 py-1 font-semibold ${usable ? "bg-emerald-100 text-emerald-700" : "bg-mist text-muted-foreground"}`}
          >
            {STATUS_TEXT[claim.status] ?? claim.status}
          </span>
          <span className="text-muted-foreground">{formatExpiry(claim.expires_at)}</span>
        </div>
        {claim.uses_allowed > 1 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {claim.uses_remaining} of {claim.uses_allowed} uses left
          </p>
        )}
        {confirmed && (
          <div role="status" className="mt-4 rounded-2xl bg-emerald-50 p-4 text-center">
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="mt-1 font-bold text-emerald-800">Used ✓</p>
            <p className="text-xs text-emerald-900">
              Confirmed by the store at{" "}
              {new Date(confirmed.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {confirmed.discount
                ? ` · ${formatCurrency(confirmed.discount, claim.offer.merchant.currency_symbol || "Rs")} off`
                : ""}
            </p>
          </div>
        )}
        {usable && <p className="mt-3 text-sm text-foreground">{where}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Only the store can confirm this code. A screenshot alone isn't accepted.
        </p>

        {pinAllowed && (
          <StorePinConfirm
            claim={claim}
            onDone={(updated, at, discount) => {
              setClaim(updated);
              setConfirmed({ at, discount });
            }}
          />
        )}

        {claim.offer.conditions.length > 0 && (
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            {claim.offer.conditions.map((c) => (
              <li key={c}>• {c}</li>
            ))}
          </ul>
        )}
        {claim.offer.terms && (
          <p className="mt-3 whitespace-pre-line text-[11px] text-muted-foreground">
            {claim.offer.terms}
          </p>
        )}
        {claim.offer.merchant.address && (
          <p className="mt-4 inline-flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {claim.offer.merchant.address}
          </p>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}

/**
 * Fallback when the store can't scan: staff type the store PIN on the
 * customer's phone. The customer never learns the PIN; the merchant is
 * notified each time it's used.
 */
function StorePinConfirm({
  claim,
  onDone,
}: {
  claim: OfferClaim;
  onDone: (claim: OfferClaim, confirmedAt: string, discount: string | null) => void;
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
      onDone(result.claim, result.confirmed_at, result.discount_amount);
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-mist px-4 py-3 text-sm font-semibold text-foreground"
      >
        <KeyRound className="h-4 w-4" /> Store can't scan? Confirm with store PIN
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-4 space-y-3 rounded-2xl bg-mist p-4"
    >
      <p className="text-xs text-muted-foreground">
        Hand your phone to the staff. They type the store PIN to confirm this offer, and it will be
        marked as used.
      </p>
      {claim.needs_bill_amount && (
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
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
            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-base focus:outline-none focus:ring-2 focus:ring-ink/20"
          />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
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
          className="h-11 w-full rounded-xl border border-border bg-card px-3 text-center font-mono text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-ink/20"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs font-semibold text-rose-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-10 flex-1 rounded-xl bg-card text-sm font-semibold text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || locked || pin.length < 4}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm use
        </button>
      </div>
    </form>
  );
}
