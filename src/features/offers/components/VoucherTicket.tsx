import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, TimerOff } from "lucide-react";
import type { OfferClaim } from "@/lib/api/offers";
import { cn } from "@/lib/utils";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import { claimState, formatDate, offerBadge, offerDescription } from "../lib/format";
import { microLabel } from "../lib/ui";
import { MerchantMark, OfferBadge, StateLabel } from "./OfferVisuals";

/** Half-circle cut-outs; their fill matches the surface the ticket sits on. */
function Notch({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute z-10 h-6 w-6 rounded-full border border-[var(--ticket-edge)] bg-[var(--notch-bg,var(--card))]",
        className,
      )}
    />
  );
}

/**
 * The claimed voucher. Active: cream paper, champagne outline, large QR.
 * Used / expired: quiet neutral paper, QR marked inactive or removed.
 */
export function VoucherTicket({
  claim,
  copied,
  onCopy,
}: {
  claim: OfferClaim;
  copied: boolean;
  onCopy: () => void;
}) {
  const state = claimState(claim);
  const active = state.tone === "ready" || state.tone === "reserved" || state.tone === "expiring";
  const used = state.tone === "used";
  const { offer } = claim;
  const validLabel = used ? "Used on" : state.tone === "expired" ? "Expired on" : "Valid until";
  const validValue = used
    ? formatDate(claim.last_use?.used_at) || "—"
    : claim.expires_at
      ? formatDate(claim.expires_at)
      : "No end date";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[26px] border md:grid md:grid-cols-[minmax(0,1fr)_264px]",
        active
          ? "ticket-paper border-[var(--ticket-edge)] text-ticket-ink shadow-[0_18px_44px_-22px_rgba(15,61,58,0.45)] [--ticket-edge:var(--ticket-line)]"
          : "border-[var(--ticket-edge)] bg-[#f4f0e8] text-[#4d524f] [--ticket-edge:#ddd6c9] dark:bg-[#e9e4da]",
      )}
    >
      {/* Benefit */}
      <section className="min-w-0 p-5 sm:p-6 md:p-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <MerchantMark
              name={offer.merchant.name}
              logoUrl={offer.merchant.logo_url}
              size={40}
              className={cn("bg-[#0f3d3a] text-[#fff9f0]", !active && "grayscale")}
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-tight">{offer.merchant.name}</p>
              <p className="truncate text-xs text-ticket-muted">
                {offer.merchant.category?.name || "Zentro partner"}
              </p>
            </div>
          </div>
          <p className="hidden shrink-0 pt-1 font-mono text-[11px] tracking-wider text-ticket-muted md:block">
            #{claim.code}
          </p>
        </div>

        <OfferBadge label={offerBadge(offer)} muted={!active} paper className="mt-5" />
        <h2
          className={cn(
            "mt-2 font-editorial text-[32px] leading-[1.05] sm:text-[38px]",
            !active && "text-[#4d524f]/80",
          )}
        >
          {offer.title}
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ticket-muted">
          {offerDescription(offer)}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--ticket-edge)] pt-4">
          <div>
            <dt className={cn(microLabel, "text-ticket-muted")}>{validLabel}</dt>
            <dd className="mt-1 text-[15px] font-semibold">{validValue}</dd>
          </div>
          <div>
            <dt className={cn(microLabel, "text-ticket-muted")}>Status</dt>
            <dd className="mt-1">
              <StateLabel tone={state.tone} label={state.label} className="text-[13px]" />
            </dd>
          </div>
        </dl>
      </section>

      {/* Redemption rail (perforated) */}
      <section
        className={cn(
          "relative flex flex-col items-center border-t-2 border-dashed border-[var(--ticket-edge)] px-5 pb-6 pt-6 md:border-l-2 md:border-t-0 md:px-6 md:pt-7",
        )}
        aria-label="Redeem at the counter"
      >
        <Notch className="-left-[13px] -top-[13px] md:-left-[13px] md:-top-[13px]" />
        <Notch className="-right-[13px] -top-[13px] md:-bottom-[13px] md:-left-[13px] md:right-auto md:top-auto" />

        {active ? (
          <>
            <p className={cn(microLabel, "text-ticket-muted")}>Scan at counter</p>
            <div className="mt-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <QRCodeSVG
                value={claim.qr_payload}
                size={184}
                bgColor="#ffffff"
                fgColor="#0b1717"
                level="M"
                role="img"
                aria-label={`QR code for voucher ${claim.code}`}
              />
            </div>
          </>
        ) : used ? (
          <>
            <p className={cn(microLabel, "text-ticket-muted")}>Inactive</p>
            <div className="relative mt-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <QRCodeSVG
                value={claim.qr_payload}
                size={132}
                bgColor="#ffffff"
                fgColor="#8b8f8c"
                level="M"
                aria-hidden="true"
              />
              <span className="absolute inset-x-3 top-1/2 -translate-y-1/2 rounded-lg bg-white/95 py-1.5 text-center text-xs font-bold text-[#4d524f] ring-1 ring-black/10">
                Already used
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/5">
              <TimerOff className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-bold">{state.label}</p>
            <p className="mt-1 text-xs text-ticket-muted">This voucher can't be redeemed.</p>
          </div>
        )}

        <div className="mt-4 w-full rounded-2xl border border-[var(--ticket-edge)] bg-white/70 px-3 py-2.5">
          <p className="text-center text-[11px] text-ticket-muted">Voucher code</p>
          <div className="mt-0.5 flex items-center justify-center gap-2">
            <span
              className={cn(
                "font-mono text-[15px] font-bold tracking-[0.12em]",
                !active && "line-through decoration-1 opacity-70",
              )}
            >
              {claim.code}
            </span>
            {active && (
              <button
                type="button"
                onClick={onCopy}
                aria-label={copied ? "Code copied" : "Copy voucher code"}
                className="grid h-8 w-8 place-items-center rounded-lg text-ticket-muted transition-colors hover:bg-black/5 hover:text-ticket-ink"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>

        <ZentroLogo className="mt-5 h-5 w-auto opacity-80" title="" />
      </section>
    </div>
  );
}
