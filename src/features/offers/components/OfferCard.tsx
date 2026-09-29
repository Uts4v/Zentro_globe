import { Clock, MapPin, Store, Ticket } from "lucide-react";
import type { PublicOffer } from "@/lib/api/offers";

export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "No expiry";
  const date = new Date(iso);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expired";
  if (days === 1) return "Ends today";
  if (days <= 7) return `Ends in ${days} days`;
  return `Until ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function OfferCard({
  offer,
  onOpen,
  onGet,
  busy,
}: {
  offer: PublicOffer;
  onOpen: () => void;
  onGet: () => void;
  busy?: boolean;
}) {
  const distance = formatDistance(offer.distance_km);
  const claimed = offer.my_claim_id !== null && offer.my_claim_id !== undefined;
  return (
    <article
      className="rounded-[26px] bg-card p-4"
      style={{ boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
    >
      <button onClick={onOpen} className="flex w-full items-start gap-3 text-left">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-mist">
          {offer.merchant.logo_url ? (
            <img src={offer.merchant.logo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Store className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-muted-foreground">
            {offer.merchant.name}
            {offer.merchant.category ? ` · ${offer.merchant.category.name}` : ""}
          </p>
          <h3 className="mt-0.5 text-[15px] font-extrabold leading-snug text-foreground">
            {offer.title}
          </h3>
          <p className="mt-1 font-display text-lg leading-tight text-ember">{offer.summary}</p>
          {offer.conditions.length > 0 && (
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
              {offer.conditions.slice(0, 2).join(" · ")}
            </p>
          )}
        </div>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> {formatExpiry(offer.ends_at)}
          </span>
          {distance && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {distance}
            </span>
          )}
          {offer.remaining !== null && offer.remaining <= 20 && (
            <span className="font-semibold text-ember">{offer.remaining} left</span>
          )}
        </div>
        <button
          onClick={onGet}
          disabled={busy}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-transform active:scale-95 disabled:opacity-60 ${
            claimed ? "bg-mist text-foreground" : "bg-ink text-primary-foreground"
          }`}
        >
          <Ticket className="h-3.5 w-3.5" />
          {busy ? "Getting…" : claimed ? "View code" : "Get Offer"}
        </button>
      </div>
    </article>
  );
}
