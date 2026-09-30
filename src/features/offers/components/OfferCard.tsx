import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Check, Loader2, MapPin } from "lucide-react";
import type { PublicOffer } from "@/lib/api/offers";
import {
  formatDistance,
  formatExpiry,
  isEndingSoon,
  offerBadge,
  offerDescription,
} from "../lib/format";
import { MerchantMark, OfferBadge, OfferImage, StatusChip } from "./OfferVisuals";

/**
 * Discovery card: a clean marketplace card, not a ticket (no QR here).
 * Horizontal on phones, vertical in the tablet/desktop grid.
 */
export function OfferCard({
  offer,
  onGet,
  busy,
}: {
  offer: PublicOffer;
  onGet: () => void;
  busy?: boolean;
}) {
  const distance = formatDistance(offer.distance_km);
  const inWallet = offer.my_claim_id !== null && offer.my_claim_id !== undefined;
  const endingSoon = isEndingSoon(offer.ends_at);
  const merchantLine = [offer.merchant.category?.name, offer.merchant.area || offer.merchant.city]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="group relative flex overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_6px_20px_rgba(23,42,43,0.05)] transition-[box-shadow,transform] duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(23,42,43,0.09)] focus-within:ring-2 focus-within:ring-ring md:flex-col">
      <div className="relative w-[38%] shrink-0 md:w-full">
        <OfferImage
          src={offer.image_url}
          categorySlug={offer.merchant.category?.slug}
          sizes="(min-width: 1280px) 380px, (min-width: 768px) 50vw, 40vw"
          className="h-full min-h-[190px] w-full md:aspect-[16/10] md:h-auto md:min-h-0"
        />
        {endingSoon && (
          <span className="absolute left-2.5 top-2.5 hidden md:inline-flex">
            <StatusChip tone="warning">Ending soon</StatusChip>
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-2">
          <MerchantMark name={offer.merchant.name} logoUrl={offer.merchant.logo_url} size={28} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold leading-tight text-foreground">
              {offer.merchant.name}
            </p>
            {merchantLine && (
              <p className="truncate text-[11px] leading-tight text-muted-foreground">
                {merchantLine}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <OfferBadge label={offerBadge(offer)} />
          {inWallet && (
            <StatusChip tone="teal">
              <Check className="h-3 w-3" aria-hidden="true" /> In wallet
            </StatusChip>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 font-editorial text-[21px] leading-[1.12] text-foreground md:text-[23px]">
          <Link
            to="/offers/$id"
            params={{ id: String(offer.id) }}
            search={{ t: undefined }}
            className="outline-none after:absolute after:inset-0 after:content-['']"
          >
            {offer.title}
          </Link>
        </h3>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground md:text-sm">
          {offerDescription(offer)}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div className="min-w-0 space-y-0.5 text-[11px] text-muted-foreground sm:text-xs">
            {distance && (
              <p className="flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {distance}
              </p>
            )}
            <p
              className={`flex items-center gap-1 ${endingSoon ? "font-semibold text-warning" : ""}`}
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {formatExpiry(offer.ends_at)}
            </p>
            {offer.remaining !== null && offer.remaining > 0 && offer.remaining <= 20 && (
              <p className="font-semibold text-warning">{offer.remaining} left</p>
            )}
          </div>
          <button
            type="button"
            onClick={onGet}
            disabled={busy}
            className={`relative z-10 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[14px] px-3.5 text-[13px] font-bold transition-[transform,background-color] duration-150 active:scale-[0.97] disabled:opacity-60 motion-reduce:active:scale-100 sm:h-11 sm:px-4 ${
              inWallet
                ? "bg-secondary text-secondary-foreground hover:bg-[var(--secondary-hover)]"
                : "bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]"
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Saving…" : inWallet ? "View ticket" : "Get Offer"}
            {!busy && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </article>
  );
}
