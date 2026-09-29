import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, MapPin, Store, Ticket } from "lucide-react";
import { MobileShell } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth";
import { offersApi, type OfferClaim } from "@/lib/api/offers";
import { ClaimSheet } from "../components/ClaimSheet";
import { formatDistance, formatExpiry } from "../components/OfferCard";

export function OfferDetailPage({ id, linkToken }: { id: string; linkToken?: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [claim, setClaim] = useState<OfferClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const offer = useQuery({
    queryKey: ["offers", "detail", id, linkToken],
    queryFn: () => offersApi.detail(id, linkToken),
  });

  async function getOffer() {
    setError(null);
    if (!user) {
      const back = `/offers/${id}${linkToken ? `?t=${encodeURIComponent(linkToken)}` : ""}`;
      navigate({ to: "/auth/login", search: { redirect: back } });
      return;
    }
    if (user.role !== "customer") {
      setError("Offers are claimed with a customer account.");
      return;
    }
    setBusy(true);
    try {
      const o = offer.data;
      const c = o?.my_claim_id
        ? await offersApi.myClaim(o.my_claim_id)
        : await offersApi.claim(id, linkToken);
      setClaim(c);
      queryClient.invalidateQueries({ queryKey: ["offers"] });
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't get this offer.");
    } finally {
      setBusy(false);
    }
  }

  const o = offer.data;
  const claimable = o?.claimable !== false;

  return (
    <MobileShell>
      <div className="px-5 pt-5">
        <Link
          to="/offers"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All offers
        </Link>
      </div>
      {offer.isLoading && (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
      )}
      {offer.isError && (
        <div className="px-5 py-16 text-center">
          <p className="text-4xl">🎟️</p>
          <p className="mt-3 text-sm text-muted-foreground">This offer isn't available.</p>
        </div>
      )}
      {o && (
        <div className="px-5 pb-12">
          {o.image_url && (
            <img
              src={o.image_url}
              alt=""
              className="mt-4 aspect-[16/9] w-full rounded-3xl object-cover"
            />
          )}
          <div className="mt-4 flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-mist">
              {o.merchant.logo_url ? (
                <img src={o.merchant.logo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <Store className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground">{o.merchant.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[o.merchant.category?.name, o.merchant.area, o.merchant.city]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <h1 className="font-display mt-4 text-3xl leading-tight text-foreground">{o.summary}</h1>
          <p className="mt-1 text-base font-semibold text-foreground">{o.title}</p>
          {o.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {o.description}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {formatExpiry(o.ends_at)}
            </span>
            {formatDistance(o.distance_km) && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {formatDistance(o.distance_km)}
              </span>
            )}
            {o.remaining !== null && (
              <span className="font-semibold text-ember">{o.remaining} left</span>
            )}
          </div>

          {o.conditions.length > 0 && (
            <ul className="mt-4 space-y-1.5 rounded-2xl bg-mist p-4 text-xs text-foreground">
              {o.conditions.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          )}
          {o.terms && (
            <p className="mt-3 whitespace-pre-line text-[11px] text-muted-foreground">{o.terms}</p>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {error}
            </p>
          )}
          <button
            onClick={getOffer}
            disabled={busy || (!claimable && !o.my_claim_id)}
            className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-base font-bold text-primary-foreground disabled:opacity-50"
          >
            <Ticket className="h-5 w-5" />
            {busy
              ? "Getting your offer…"
              : o.my_claim_id
                ? "View my code"
                : claimable
                  ? "Get Offer"
                  : "No longer available"}
          </button>
        </div>
      )}
      {claim && <ClaimSheet claim={claim} onClose={() => setClaim(null)} />}
    </MobileShell>
  );
}
