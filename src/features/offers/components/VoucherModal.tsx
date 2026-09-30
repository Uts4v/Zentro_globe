import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, Copy, Info, ReceiptText, Check, TimerOff, X } from "lucide-react";
import type { OfferClaim } from "@/lib/api/offers";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { claimState, formatDate, formatDateTime } from "../lib/format";
import { btnPrimary, btnSecondary, microLabel } from "../lib/ui";
import { VoucherTicket } from "./VoucherTicket";
import { StorePinConfirm } from "./StorePinConfirm";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function howToUse(channels: OfferClaim["offer"]["channels"]) {
  if (channels === "in_store") return "Show this QR at the counter.";
  if (channels === "online") return "Apply this offer at checkout when you order in Zentro.";
  return "Show this QR at the counter, or apply this offer while ordering in Zentro.";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // insecure context: the code stays visible to read out
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-semibold text-foreground">{children}</dd>
    </div>
  );
}

/** Full voucher: the premium ticket with its QR, or the used / expired record. */
export function VoucherModal({
  claim: initialClaim,
  onClose,
}: {
  claim: OfferClaim;
  onClose: () => void;
}) {
  const [claim, setClaim] = useState(initialClaim);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const state = claimState(claim);
  const active = state.tone === "ready" || state.tone === "reserved" || state.tone === "expiring";
  const currency = claim.offer.merchant.currency_symbol || "Rs";
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus, Esc, Tab trap, scroll lock, focus restore (once per opening).
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  async function copy() {
    if (await copyText(claim.code)) {
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast("Copy isn't available here. Read the code to staff instead.");
    }
  }

  const sheet = (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0b1a19]/60 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voucher-title"
        className="flex max-h-[94dvh] w-full max-w-[800px] flex-col overflow-hidden rounded-t-[28px] bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] [--notch-bg:var(--background)] motion-safe:animate-in motion-safe:slide-in-from-bottom-6 motion-safe:duration-250 sm:rounded-[28px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-7">
          <div className="min-w-0">
            <p className={cn(microLabel, "text-muted-foreground")}>
              {active ? "Your voucher" : "Voucher details"}
            </p>
            <p id="voucher-title" className="truncate text-[15px] font-bold text-foreground">
              {claim.offer.merchant.name}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-secondary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto overscroll-contain px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:px-7 sm:pb-7">
          <VoucherTicket claim={claim} copied={copied} onCopy={copy} />

          {active && (
            <div className="mt-5 space-y-4">
              <button type="button" onClick={copy} className={cn(btnPrimary, "w-full")}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy code"}
              </button>

              {claim.status === "reserved" && (
                <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-foreground">
                  This voucher is applied to an open order. It's used when that order is completed,
                  and comes back if the order is cancelled.
                </p>
              )}

              <section className="rounded-[20px] bg-oat/70 p-4 dark:bg-muted">
                <p className={cn(microLabel, "flex items-center gap-1.5 text-foreground")}>
                  <Info className="h-3.5 w-3.5" aria-hidden="true" /> How to use
                </p>
                <ol className="mt-2 space-y-1.5 text-sm text-foreground/85">
                  <li>1. {howToUse(claim.offer.channels)}</li>
                  <li>2. Staff will verify the voucher before redemption.</li>
                </ol>
                {claim.uses_allowed > 1 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {claim.uses_remaining} of {claim.uses_allowed} uses left
                  </p>
                )}
              </section>

              {claim.store_pin_enabled &&
                claim.status === "available" &&
                claim.offer.channels !== "online" && (
                  <StorePinConfirm
                    claim={claim}
                    onDone={(updated) => {
                      setClaim(updated);
                      toast.success("Offer used. Enjoy!");
                    }}
                  />
                )}
            </div>
          )}

          {state.tone === "used" && (
            <section className="mt-5 rounded-[20px] border border-border bg-card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <p className="font-bold text-foreground">This voucher has been used.</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {claim.last_use?.discount_amount
                      ? `You saved ${formatCurrency(claim.last_use.discount_amount, currency)}.`
                      : "Confirmed by the store."}
                  </p>
                </div>
              </div>
              <dl className="mt-3 divide-y divide-border border-t border-border">
                <Row label="Store">{claim.offer.merchant.name}</Row>
                {claim.last_use && (
                  <Row label="Date used">{formatDateTime(claim.last_use.used_at)}</Row>
                )}
                {claim.last_use?.order_id && <Row label="Order">#{claim.last_use.order_id}</Row>}
              </dl>
              {claim.last_use?.order_id && (
                <Link
                  to="/orders/$id"
                  params={{ id: String(claim.last_use.order_id) }}
                  className={cn(btnSecondary, "mt-3 w-full")}
                >
                  <ReceiptText className="h-4 w-4" aria-hidden="true" /> View order details
                </Link>
              )}
            </section>
          )}

          {(state.tone === "expired" || state.tone === "withdrawn") && (
            <section className="mt-5 flex items-start gap-3 rounded-[20px] border border-border bg-card p-4 sm:p-5">
              <TimerOff
                className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-foreground">
                  {state.tone === "withdrawn"
                    ? "The store withdrew this offer."
                    : claim.expires_at
                      ? `This voucher expired on ${formatDate(claim.expires_at)}.`
                      : "This voucher has expired."}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  It can't be redeemed any more.
                </p>
                <Link to="/offers" className={cn(btnSecondary, "mt-3 h-11")} onClick={onClose}>
                  Browse offers
                </Link>
              </div>
            </section>
          )}

          {(claim.offer.conditions.length > 0 || claim.offer.terms) && (
            <details className="group mt-4 rounded-[20px] border border-border bg-card px-4 py-3">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-sm font-semibold text-foreground">
                Offer details
                <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
              </summary>
              {claim.offer.conditions.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {claim.offer.conditions.map((c) => (
                    <li key={c} className="flex gap-2">
                      <span aria-hidden="true">•</span> {c}
                    </li>
                  ))}
                </ul>
              )}
              {claim.offer.terms && (
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                  {claim.offer.terms}
                </p>
              )}
            </details>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
