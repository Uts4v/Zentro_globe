import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, MapPin, X } from "lucide-react";
import type { OfferClaim } from "@/lib/api/offers";
import { formatExpiry } from "./OfferCard";

const STATUS_TEXT: Record<OfferClaim["status"], string> = {
  available: "Ready to use",
  reserved: "Applied to an order",
  redeemed: "Used",
  expired: "Expired",
  revoked: "Withdrawn by the store",
};

/** The customer's voucher: QR + code, shown at the counter or used at checkout. */
export function ClaimSheet({ claim, onClose }: { claim: OfferClaim; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const usable = claim.tab === "available";

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
        {usable && <p className="mt-3 text-sm text-foreground">{where}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Only the store can confirm this code. A screenshot alone isn't accepted.
        </p>

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
