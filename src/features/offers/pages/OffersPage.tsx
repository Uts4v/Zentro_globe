import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { LocateFixed, Loader2, MapPin, Search, Ticket, X } from "lucide-react";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/use-debounce";
import { offersApi, type OfferClaim, type PublicOffer } from "@/lib/api/offers";
import { OfferCard } from "../components/OfferCard";
import { ClaimSheet } from "../components/ClaimSheet";

type Place =
  | { kind: "any" }
  | { kind: "near"; lat: number; lng: number }
  | { kind: "area"; city: string; area: string };

const PAGE = 20;

export function OffersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 350);
  const [category, setCategory] = useState("");
  const [place, setPlace] = useState<Place>({ kind: "any" });
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openClaim, setOpenClaim] = useState<OfferClaim | null>(null);

  const categories = useQuery({
    queryKey: ["offers", "categories"],
    queryFn: offersApi.categories,
    staleTime: 3_600_000,
  });
  const areas = useQuery({
    queryKey: ["offers", "areas"],
    queryFn: offersApi.areas,
    staleTime: 600_000,
  });

  const filters = useMemo(
    () => ({
      q: q || undefined,
      category: category || undefined,
      ...(place.kind === "near" ? { lat: place.lat, lng: place.lng, radius_km: 25 } : {}),
      ...(place.kind === "area" ? { city: place.city, area: place.area || undefined } : {}),
    }),
    [q, category, place],
  );

  const list = useInfiniteQuery({
    queryKey: ["offers", "list", filters, Boolean(user)],
    queryFn: ({ pageParam }) => offersApi.list({ ...filters, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.results.length, 0);
      return loaded < last.count ? loaded : undefined;
    },
  });
  const offers = list.data?.pages.flatMap((p) => p.results) ?? [];

  useEffect(() => setActionError(null), [filters]);

  function locate() {
    setLocationError(null);
    if (typeof window === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setLocationError("Location isn't available here. Choose your area instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({ kind: "near", lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocationError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is off. Choose your area instead."
            : "Couldn't get your location. Choose your area instead.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
    );
  }

  async function getOffer(offer: PublicOffer) {
    setActionError(null);
    if (!user) {
      navigate({ to: "/auth/login", search: { redirect: "/offers" } });
      return;
    }
    if (user.role !== "customer") {
      setActionError("Offers are claimed with a customer account.");
      return;
    }
    setClaimingId(offer.id);
    try {
      const claim = offer.my_claim_id
        ? await offersApi.myClaim(offer.my_claim_id)
        : await offersApi.claim(offer.id);
      setOpenClaim(claim);
      queryClient.invalidateQueries({ queryKey: ["offers", "list"] });
      queryClient.invalidateQueries({ queryKey: ["offers", "mine"] });
    } catch (e: unknown) {
      setActionError((e as Error).message || "Couldn't get this offer. Please try again.");
    } finally {
      setClaimingId(null);
    }
  }

  const areaValue = place.kind === "area" ? `${place.city}|${place.area}` : "";

  return (
    <MobileShell>
      <TopBar />
      <div className="px-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Discover</p>
            <h1 className="font-display mt-1 text-4xl text-foreground">Offers</h1>
          </div>
          {user?.role === "customer" && (
            <Link
              to="/offers/mine"
              className="inline-flex items-center gap-1.5 rounded-full bg-mist px-4 py-2 text-xs font-bold text-foreground"
            >
              <Ticket className="h-3.5 w-3.5" /> My Offers
            </Link>
          )}
        </div>

        <label className="mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search offers or stores"
            aria-label="Search offers or stores"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label="Clear search">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </label>

        <div
          className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1"
          role="tablist"
          aria-label="Categories"
        >
          {[{ slug: "", name: "All", icon: "✨" }, ...(categories.data ?? [])].map((c) => (
            <button
              key={c.slug || "all"}
              role="tab"
              aria-selected={category === c.slug}
              onClick={() => setCategory(c.slug)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                category === c.slug ? "bg-ink text-primary-foreground" : "bg-mist text-foreground"
              }`}
            >
              {c.icon} {c.name}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={place.kind === "near" ? () => setPlace({ kind: "any" }) : locate}
            disabled={locating}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold ${
              place.kind === "near"
                ? "bg-ember text-white"
                : "border border-border bg-card text-foreground"
            }`}
          >
            {locating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LocateFixed className="h-3.5 w-3.5" />
            )}
            {place.kind === "near" ? "Near me ✓" : "Near me"}
          </button>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <select
              aria-label="Choose an area"
              value={areaValue}
              onChange={(e) => {
                if (!e.target.value) return setPlace({ kind: "any" });
                const [city, area] = e.target.value.split("|");
                setPlace({ kind: "area", city, area });
              }}
              className="appearance-none rounded-full border border-border bg-card py-1.5 pl-8 pr-4 text-xs font-bold text-foreground"
            >
              <option value="">Any area</option>
              {(areas.data ?? []).map((c) => (
                <optgroup key={c.city} label={c.city}>
                  <option value={`${c.city}|`}>All of {c.city}</option>
                  {c.areas.map((a) => (
                    <option key={a} value={`${c.city}|${a}`}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        {locationError && <p className="mt-2 text-xs text-ember">{locationError}</p>}
        {actionError && (
          <p role="alert" className="mt-3 rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {actionError}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-3 px-5 pb-10">
        {list.isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Finding offers…</p>
        )}
        {list.isError && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn't load offers. Pull to refresh.
          </p>
        )}
        {!list.isLoading && !list.isError && offers.length === 0 && (
          <div className="glass rounded-3xl py-14 text-center">
            <p className="text-4xl">🎟️</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {place.kind === "near" ? "No offers within 25 km yet." : "No offers match yet."}
            </p>
          </div>
        )}
        {offers.map((offer) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            busy={claimingId === offer.id}
            onOpen={() =>
              navigate({
                to: "/offers/$id",
                params: { id: String(offer.id) },
                search: { t: undefined },
              })
            }
            onGet={() => getOffer(offer)}
          />
        ))}
        {list.hasNextPage && (
          <button
            onClick={() => list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="w-full rounded-2xl bg-mist py-3 text-sm font-bold text-foreground"
          >
            {list.isFetchingNextPage ? "Loading…" : "Show more offers"}
          </button>
        )}
      </div>

      {openClaim && <ClaimSheet claim={openClaim} onClose={() => setOpenClaim(null)} />}
    </MobileShell>
  );
}
