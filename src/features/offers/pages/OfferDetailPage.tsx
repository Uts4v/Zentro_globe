import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Gift,
  Loader2,
  MapPin,
  Share2,
  Ticket,
  TicketX,
} from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import { offersApi, type OfferClaim } from "@/lib/api/offers";
import { VoucherModal } from "../components/VoucherModal";
import { MerchantMark, OfferBadge, OfferImage, StatusChip } from "../components/OfferVisuals";
import { OfferDetailSkeleton, OfferEmptyState } from "../components/OfferStates";
import {
  formatDate,
  formatDistance,
  isEndingSoon,
  offerBadge,
  offerDescription,
  offerPlace,
} from "../lib/format";
import { useClaimOffer } from "../lib/hooks";
import { btnPrimary, btnSecondary, microLabel } from "../lib/ui";

export function OfferDetailPage({ id, linkToken }: { id: string; linkToken?: string }) {
  const back = `/offers/${id}${linkToken ? `?t=${encodeURIComponent(linkToken)}` : ""}`;
  const { claim, pendingId } = useClaimOffer(back);
  const [openClaim, setOpenClaim] = useState<OfferClaim | null>(null);
  const [justSaved, setJustSaved] = useState<OfferClaim | null>(null);
  const offer = useQuery({
    queryKey: ["offers", "detail", id, linkToken],
    queryFn: () => offersApi.detail(id, linkToken),
  });
  const o = offer.data;

  async function getOffer() {
    if (!o) return;
    const result = await claim(o, linkToken);
    if (!result) return;
    if (result.created) setJustSaved(result.claim);
    else setOpenClaim(result.claim);
  }

  async function share() {
    if (!o) return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: o.title, text: `${o.merchant.name}: ${o.title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      // share sheet dismissed: nothing to do
    }
  }

  const claimable = o?.claimable !== false;
  const inWallet = Boolean(o?.my_claim_id) || Boolean(justSaved);
  const place = o ? offerPlace(o.merchant) : "";
  const distance = o ? formatDistance(o.distance_km) : null;
  const details = o ? [...o.conditions] : [];
  // The street address goes in the details only when "Available at" shows the area.
  const showAddress = Boolean(o?.merchant.address && place);

  return (
    <MobileShell wide>
      <div className="flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))] sm:px-6 lg:px-8 lg:pt-8">
        <Link
          to="/offers"
          className="inline-flex h-11 items-center gap-2 rounded-2xl pr-3 text-sm font-semibold text-foreground hover:text-primary"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" /> Back to offers
        </Link>
        {o && (
          <button
            type="button"
            onClick={share}
            aria-label="Share offer"
            className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
          >
            <Share2 className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="px-5 pb-12 pt-4 sm:px-6 lg:px-8 lg:pt-6">
        {offer.isLoading && <OfferDetailSkeleton />}

        {offer.isError && (
          <OfferEmptyState
            icon={TicketX}
            title="This offer is no longer available."
            body="It may have ended or been withdrawn by the store."
            action={
              <Link to="/offers" className={btnPrimary}>
                Browse offers
              </Link>
            }
          />
        )}

        {o && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
            <div className="lg:sticky lg:top-8">
              <OfferImage
                src={o.image_url}
                categorySlug={o.merchant.category?.slug}
                eager
                sizes="(min-width: 1024px) 600px, 100vw"
                className="aspect-[4/3] w-full rounded-[24px] lg:aspect-[5/4]"
              />
            </div>

            <article className="min-w-0">
              <div className="flex items-center gap-3">
                <MerchantMark name={o.merchant.name} logoUrl={o.merchant.logo_url} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-foreground">{o.merchant.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {[o.merchant.category?.name, o.merchant.area || o.merchant.city]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {distance && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" aria-hidden="true" /> {distance}
                  </span>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <OfferBadge label={offerBadge(o)} />
                {isEndingSoon(o.ends_at) && <StatusChip tone="warning">Ending soon</StatusChip>}
                {inWallet && <StatusChip tone="teal">In wallet</StatusChip>}
              </div>
              <h1 className="mt-3 font-editorial text-[36px] leading-[1.04] text-foreground sm:text-[42px] lg:text-[48px]">
                {o.title}
              </h1>
              <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-muted-foreground">
                {offerDescription(o)}
              </p>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5">
                <div className="flex gap-3">
                  <CalendarDays
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <div>
                    <dt className="text-xs text-muted-foreground">Valid until</dt>
                    <dd className="text-[15px] font-semibold text-foreground">
                      {o.ends_at ? formatDate(o.ends_at) : "No end date"}
                    </dd>
                  </div>
                </div>
                <div className="flex min-w-0 gap-3">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Available at</dt>
                    <dd className="text-[15px] font-semibold text-foreground">
                      {place || o.merchant.address || o.merchant.name}
                    </dd>
                  </div>
                </div>
              </dl>

              <section className="mt-6 flex gap-3 rounded-[20px] bg-oat/70 p-5 dark:bg-muted">
                <Gift className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <h2 className={cn(microLabel, "text-foreground")}>What you get</h2>
                  <ul className="mt-2 space-y-1 text-[15px] text-foreground">
                    {(o.what_you_get?.length ? o.what_you_get : [o.summary]).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </section>

              {(details.length > 0 || o.terms || showAddress) && (
                <section className="mt-6">
                  <h2 className={cn(microLabel, "text-foreground")}>Important details</h2>
                  {details.length > 0 && (
                    <ul className="mt-3 space-y-2 text-[15px] text-muted-foreground">
                      {details.map((c) => (
                        <li key={c} className="flex gap-2.5">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.terms && (
                    <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {o.terms}
                    </p>
                  )}
                  {showAddress && (
                    <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {o.merchant.address}
                    </p>
                  )}
                </section>
              )}

              {o.remaining !== null && o.remaining > 0 && o.remaining <= 20 && (
                <p className="mt-5 text-sm font-semibold text-warning">Only {o.remaining} left</p>
              )}

              <div className="mt-7">
                {justSaved ? (
                  <div
                    role="status"
                    className="rounded-[20px] border border-success/30 bg-success/8 p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
                  >
                    <p className="flex items-center gap-2 font-bold text-foreground">
                      <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
                      Offer saved to your wallet.
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setOpenClaim(justSaved)}
                        className={btnPrimary}
                      >
                        <Ticket className="h-4 w-4" aria-hidden="true" /> View ticket
                      </button>
                      <Link to="/offers/mine" className={btnSecondary}>
                        Go to My Offers
                      </Link>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={getOffer}
                    disabled={pendingId === o.id || (!claimable && !o.my_claim_id)}
                    className={cn(btnPrimary, "h-14 w-full text-base")}
                  >
                    {pendingId === o.id ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Ticket className="h-5 w-5" aria-hidden="true" />
                    )}
                    {pendingId === o.id
                      ? "Saving…"
                      : o.my_claim_id
                        ? "View my ticket"
                        : claimable
                          ? "Get Offer"
                          : "No longer available"}
                  </button>
                )}
              </div>
            </article>
          </div>
        )}
      </div>

      {openClaim && <VoucherModal claim={openClaim} onClose={() => setOpenClaim(null)} />}
    </MobileShell>
  );
}
