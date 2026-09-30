import { QRCodeSVG } from "qrcode.react";
import { CalendarDays, ChevronRight } from "lucide-react";
import type { OfferClaim } from "@/lib/api/offers";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { claimState, formatDate, offerBadge, offerDescription } from "../lib/format";
import { MerchantMark, OfferBadge, StateLabel } from "./OfferVisuals";

/**
 * A saved offer in My Offers. Active vouchers are compact passes with a small
 * QR preview; used / expired ones are quiet history rows.
 */
export function WalletCard({ claim, onOpen }: { claim: OfferClaim; onOpen: () => void }) {
  const state = claimState(claim);
  const active = state.tone === "ready" || state.tone === "reserved" || state.tone === "expiring";
  const { offer } = claim;
  const currency = offer.merchant.currency_symbol || "Rs";
  const merchantLine = [offer.merchant.category?.name, offer.merchant.area || offer.merchant.city]
    .filter(Boolean)
    .join(" · ");

  let footer: string;
  if (state.tone === "used") {
    footer = claim.last_use ? `Used ${formatDate(claim.last_use.used_at)}` : "Used";
  } else if (state.tone === "expired") {
    footer = claim.expires_at ? `Expired ${formatDate(claim.expires_at)}` : "Expired";
  } else if (state.tone === "withdrawn") {
    footer = "Withdrawn by the store";
  } else {
    footer = claim.expires_at ? `Valid until ${formatDate(claim.expires_at)}` : "No end date";
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${offer.merchant.name}: ${offer.title}. ${state.label}. ${active ? "Open voucher" : "View details"}`}
      className={cn(
        "group relative flex w-full gap-4 overflow-hidden rounded-[22px] border p-4 text-left transition-[box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5",
        active
          ? "ticket-paper border-ticket-line text-ticket-ink shadow-[0_6px_20px_rgba(23,42,43,0.06)] hover:shadow-[0_12px_30px_-8px_rgba(15,61,58,0.22)] motion-safe:hover:-translate-y-0.5"
          : "border-border bg-card text-foreground hover:bg-muted/40",
      )}
    >
      {active && (
        <>
          <span
            aria-hidden="true"
            className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-ticket-line bg-background"
          />
          <span
            aria-hidden="true"
            className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-ticket-line bg-background"
          />
        </>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <MerchantMark
            name={offer.merchant.name}
            logoUrl={offer.merchant.logo_url}
            size={30}
            className={active ? "bg-[#0f3d3a] text-[#fff9f0]" : "opacity-70 grayscale"}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight">{offer.merchant.name}</p>
            {merchantLine && (
              <p
                className={cn(
                  "truncate text-[11px] leading-tight",
                  active ? "text-ticket-muted" : "text-muted-foreground",
                )}
              >
                {merchantLine}
              </p>
            )}
          </div>
        </div>

        <OfferBadge label={offerBadge(offer)} muted={!active} paper={active} className="mt-3" />
        <p
          className={cn(
            "mt-1.5 line-clamp-2 font-editorial text-[21px] leading-[1.12] sm:text-[23px]",
            !active && "text-foreground/65",
          )}
        >
          {offer.title}
        </p>
        <p
          className={cn(
            "mt-1 line-clamp-1 text-[13px]",
            active ? "text-ticket-muted" : "text-muted-foreground",
          )}
        >
          {offerDescription(offer)}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              active ? "text-ticket-muted" : "text-muted-foreground",
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {footer}
          </span>
          {active ? (
            <StateLabel tone={state.tone} label={state.label} />
          ) : state.tone === "used" && claim.last_use?.discount_amount ? (
            <span className="text-xs font-semibold text-success">
              You saved {formatCurrency(claim.last_use.discount_amount, currency)}
            </span>
          ) : (
            <StateLabel tone={state.tone} label={state.label} className="text-muted-foreground" />
          )}
        </div>
      </div>

      {active ? (
        <span className="hidden shrink-0 self-start rounded-xl bg-white p-1.5 ring-1 ring-black/5 min-[360px]:block">
          <QRCodeSVG
            value={claim.qr_payload}
            size={56}
            bgColor="#ffffff"
            fgColor="#0b1717"
            level="L"
            aria-hidden="true"
          />
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 self-center text-xs font-semibold text-muted-foreground group-hover:text-foreground">
          <span className="hidden sm:inline">View details</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}
