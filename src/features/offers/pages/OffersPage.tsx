import { useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronDown,
  Loader2,
  LocateFixed,
  MapPin,
  RotateCcw,
  Search,
  SearchX,
  SlidersHorizontal,
  Ticket,
  WalletCards,
  WifiOff,
  X,
} from "lucide-react";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { useAuth } from "@/lib/auth";
import { useDebouncedValue } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";
import { offersApi, type OfferClaim, type PublicOffer } from "@/lib/api/offers";
import { OfferCard } from "../components/OfferCard";
import { VoucherModal } from "../components/VoucherModal";
import { OfferCardSkeleton, OfferEmptyState } from "../components/OfferStates";
import { categoryIcon } from "../lib/categories";
import { useClaimOffer, useMyOffers, useOfferAreas, useOfferCategories } from "../lib/hooks";
import { btnPrimary, btnSecondary, microLabel } from "../lib/ui";

type Place =
  | { kind: "any" }
  | { kind: "near"; lat: number; lng: number }
  | { kind: "area"; city: string; area: string };

const PAGE = 18;
const RADII = [2, 5, 10, 25] as const;
const VISIBLE_CATEGORIES = 5;

const chip =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const chipOff = "border border-border bg-card text-foreground hover:bg-muted";
const chipOn = "bg-primary text-primary-foreground";

export function OffersPage() {
  const { user } = useAuth();
  const isCustomer = user?.role === "customer";
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 350);
  const [category, setCategory] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [place, setPlace] = useState<Place>({ kind: "any" });
  const [radius, setRadius] = useState<number>(10);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [openClaim, setOpenClaim] = useState<OfferClaim | null>(null);
  const areaSelect = useRef<HTMLSelectElement>(null);

  const categories = useOfferCategories();
  const areas = useOfferAreas();
  const saved = useMyOffers("available", isCustomer);
  const { claim, pendingId } = useClaimOffer("/offers");

  const filters = useMemo(
    () => ({
      q: q || undefined,
      category: category || undefined,
      ...(place.kind === "near" ? { lat: place.lat, lng: place.lng, radius_km: radius } : {}),
      ...(place.kind === "area" ? { city: place.city, area: place.area || undefined } : {}),
    }),
    [q, category, place, radius],
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
  const total = list.data?.pages[0]?.count ?? 0;
  const filtered = Boolean(q || category || place.kind !== "any");

  function locate() {
    setLocationError(null);
    if (typeof window === "undefined" || !("geolocation" in navigator) || !window.isSecureContext) {
      setLocationError("We couldn't access your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPlace({ kind: "near", lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocationError("We couldn't access your location.");
        setLocating(false);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
    );
  }

  function resetFilters() {
    setSearch("");
    setCategory("");
    setPlace({ kind: "any" });
    setRadius(10);
    setLocationError(null);
  }

  async function onGet(offer: PublicOffer) {
    const result = await claim(offer);
    if (!result) return;
    if (result.created) {
      toast.success("Offer saved to your wallet", {
        action: { label: "View ticket", onClick: () => setOpenClaim(result.claim) },
      });
    } else {
      setOpenClaim(result.claim);
    }
  }

  const allCategories = [{ slug: "", name: "All" }, ...(categories.data ?? [])];
  const selectedHidden = allCategories.findIndex((c) => c.slug === category) > VISIBLE_CATEGORIES;
  const visibleCategories =
    showAllCategories || selectedHidden
      ? allCategories
      : allCategories.slice(0, VISIBLE_CATEGORIES + 1);
  const hasMore = allCategories.length > VISIBLE_CATEGORIES + 1;
  const areaValue = place.kind === "area" ? `${place.city}|${place.area}` : "";
  const savedCount = saved.data?.length ?? 0;

  return (
    <MobileShell wide>
      <TopBar />
      <div className="px-5 sm:px-6 lg:px-8">
        <header className="mt-5 flex items-end justify-between gap-4 lg:mt-8">
          <div className="min-w-0">
            <p className={cn(microLabel, "text-muted-foreground")}>Discover</p>
            <h1 className="mt-1 text-[40px] font-extrabold leading-none tracking-[-0.035em] text-foreground lg:text-[54px]">
              Offers
            </h1>
            <p className="mt-2 text-[15px] text-muted-foreground lg:text-base">
              Exclusive deals from places you'll love.
            </p>
          </div>
          {isCustomer && (
            <Link
              to="/offers/mine"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
            >
              <WalletCards className="h-4 w-4" aria-hidden="true" />
              My Offers
              {savedCount > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
                  {savedCount}
                  <span className="sr-only"> saved</span>
                </span>
              )}
            </Link>
          )}
        </header>

        {/* Search + filters */}
        <div className="mt-6 lg:max-w-3xl">
          <div className="flex items-center gap-2 rounded-[18px] border border-border bg-card pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-ring">
            <Search
              className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <label htmlFor="offer-search" className="sr-only">
              Search offers, stores or categories
            </label>
            <input
              id="offer-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search offers, stores or categories…"
              enterKeyHint="search"
              className="h-[52px] min-w-0 flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="offer-filters"
              aria-label="Filters"
              className={cn(
                "grid h-10 w-10 place-items-center rounded-xl transition-colors",
                filtersOpen
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>

          {filtersOpen && (
            <div
              id="offer-filters"
              className="mt-2 rounded-[18px] border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            >
              <p className="text-sm font-bold text-foreground">Distance from you</p>
              <p className="text-xs text-muted-foreground">Used with “Near me”.</p>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Distance">
                {RADII.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={radius === r}
                    onClick={() => {
                      setRadius(r);
                      if (place.kind !== "near") locate();
                    }}
                    className={cn(chip, "h-9 px-3.5", radius === r ? chipOn : chipOff)}
                  >
                    {r} km
                  </button>
                ))}
              </div>
              {filtered && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Categories: scroll on phones, wrap on desktop */}
        <div
          className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 no-scrollbar edge-fade-x sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:[mask-image:none]"
          role="group"
          aria-label="Categories"
        >
          {visibleCategories.map((c) => {
            const Icon = categoryIcon(c.slug || "all");
            const on = category === c.slug;
            return (
              <button
                key={c.slug || "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(c.slug)}
                className={cn(chip, on ? chipOn : chipOff)}
              >
                <Icon className="h-[15px] w-[15px]" aria-hidden="true" />
                {c.name}
              </button>
            );
          })}
          {hasMore && !selectedHidden && (
            <button
              type="button"
              onClick={() => setShowAllCategories((v) => !v)}
              aria-expanded={showAllCategories}
              className={cn(chip, chipOff)}
            >
              {showAllCategories ? "Less" : "More"}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", showAllCategories && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          )}
        </div>

        {/* Location */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={place.kind === "near" ? () => setPlace({ kind: "any" }) : locate}
            disabled={locating}
            aria-pressed={place.kind === "near"}
            className={cn(chip, place.kind === "near" ? chipOn : chipOff)}
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden="true" />
            )}
            {place.kind === "near" ? `Near me · ${radius} km` : "Near me"}
          </button>
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <select
              ref={areaSelect}
              aria-label="Choose an area"
              value={areaValue}
              onChange={(e) => {
                setLocationError(null);
                if (!e.target.value) return setPlace({ kind: "any" });
                const [city, area] = e.target.value.split("|");
                setPlace({ kind: "area", city, area });
              }}
              className={cn(
                chip,
                "appearance-none pl-9 pr-9",
                place.kind === "area" ? chipOn : chipOff,
              )}
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
            <ChevronDown
              className={cn(
                "pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2",
                place.kind === "area" ? "text-primary-foreground" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
          </div>
        </div>
        {locationError && (
          <p
            className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
            role="status"
          >
            {locationError}
            <button
              type="button"
              onClick={() => areaSelect.current?.focus()}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              Choose an area
            </button>
          </p>
        )}
      </div>

      {/* Results */}
      <section className="mt-6 px-5 pb-10 sm:px-6 lg:mt-8 lg:px-8" aria-label="Offers">
        <p className="sr-only" aria-live="polite">
          {list.isSuccess ? `${total} offers` : ""}
        </p>
        {list.isSuccess && total > 0 && (
          <p className="mb-3 text-sm text-muted-foreground">
            {total} {total === 1 ? "offer" : "offers"}
            {place.kind === "near" ? " near you" : ""}
          </p>
        )}

        {list.isLoading && (
          <div className="grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <OfferCardSkeleton key={i} />
            ))}
          </div>
        )}

        {list.isError && (
          <OfferEmptyState
            icon={WifiOff}
            title="We couldn't load offers."
            body="Check your connection and try again."
            action={
              <button type="button" onClick={() => list.refetch()} className={btnPrimary}>
                Try again
              </button>
            }
          />
        )}

        {list.isSuccess && offers.length === 0 && (
          <OfferEmptyState
            icon={filtered ? SearchX : Ticket}
            title={filtered ? "No offers found." : "No offers yet."}
            body={
              filtered
                ? "Try changing your filters or location."
                : "New deals from places near you will show up here."
            }
            action={
              filtered ? (
                <button type="button" onClick={resetFilters} className={btnSecondary}>
                  Reset filters
                </button>
              ) : undefined
            }
          />
        )}

        {offers.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                busy={pendingId === offer.id}
                onGet={() => onGet(offer)}
              />
            ))}
          </div>
        )}

        {list.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className={cn(btnSecondary, "w-full sm:w-auto sm:min-w-56")}
            >
              {list.isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {list.isFetchingNextPage ? "Loading…" : "Show more offers"}
            </button>
          </div>
        )}
      </section>

      {openClaim && <VoucherModal claim={openClaim} onClose={() => setOpenClaim(null)} />}
    </MobileShell>
  );
}
