// src/features/store-locator/pages/StoresPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  MapPin,
  Phone,
  Loader2,
  ChevronRight,
  ArrowRight,
  Search,
  SlidersHorizontal,
  Coffee,
  Leaf,
  Croissant,
  Percent,
  Clock,
  Compass,
  Sparkles,
} from "lucide-react";
import { merchantApi, type MerchantDiscoveryItem } from "@/lib/api";
import { CafeDiscoveryMap } from "@/features/store-locator/pages/CafeDiscoveryMap";

// Fields your backend doesn't return yet — kept optional so real data can
// be wired in later (see notes below the component) without breaking this UI.
type DiscoveryItem = MerchantDiscoveryItem & {
  rating?: number;
  review_count?: number;
  glow_points?: number;
  banner_url?: string;
};

const FILTERS = [
  { key: "nearby", label: "Nearby", icon: Compass },
  { key: "coffee", label: "Coffee", icon: Coffee },
  { key: "tea", label: "Tea", icon: Leaf },
  { key: "bakery", label: "Bakery", icon: Croissant },
  { key: "rewards", label: "Rewards", icon: Percent },
  { key: "open", label: "Open Now", icon: Clock },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good Morning", emoji: "☀️" };
  if (hour < 17) return { text: "Good Afternoon", emoji: "☀️" };
  return { text: "Good Evening", emoji: "🌙" };
}

function distanceLabel(km: number | null) {
  if (km === null) return null;
  return km < 1 ? `${Math.round(km * 1000)}m away` : `${km.toFixed(1)}km away`;
}

function CafeImage({ store, className }: { store: DiscoveryItem; className: string }) {
  const src = store.banner_url || store.logo_url;
  if (src) {
    return (
      <div
        className={className}
        style={{ backgroundImage: `url(${src})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
    );
  }
  return (
    <div className={`${className} grid place-items-center bg-mist text-4xl`}>☕</div>
  );
}

function RatingBadge({ store }: { store: DiscoveryItem }) {
  if (!store.rating) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
      <span className="text-ember">★</span> {store.rating.toFixed(1)}
      {store.review_count != null && (
        <span className="text-muted-foreground">({store.review_count})</span>
      )}
    </span>
  );
}

function GlowPoints({ store }: { store: DiscoveryItem }) {
  if (!store.glow_points) return null;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-ember">
      <Sparkles className="h-3.5 w-3.5" /> Earn {store.glow_points} Glow Points
    </span>
  );
}

function PhoneLink({ store, className }: { store: DiscoveryItem; className: string }) {
  if (!store.phone) return null;
  return (
    <a
      href={`tel:${store.phone}`}
      onClick={(e) => e.stopPropagation()}
      className={`${className} flex items-center gap-1.5 text-muted-foreground hover:text-foreground`}
    >
      <Phone className="h-3.5 w-3.5 shrink-0" />
      <span>{store.phone}</span>
    </a>
  );
}

function FeaturedCard({ store, onOpen }: { store: DiscoveryItem; onOpen: () => void }) {
  return (
    <div className="glass-strong overflow-hidden rounded-3xl md:flex">
      <div className="relative h-56 shrink-0 md:h-auto md:w-[42%]">
        <CafeImage store={store} className="h-full w-full" />
        <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-amber-400 dark:bg-amber-500 px-3 py-1 text-xs font-semibold text-foreground">
          ★ Featured
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between gap-5 p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="font-display text-3xl leading-tight text-foreground">{store.business_name}</h2>
            <RatingBadge store={store} />
          </div>
          {(store.address || store.distance_km !== null) && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>
                {store.address}
                {store.address && store.distance_km !== null && " · "}
                {distanceLabel(store.distance_km)}
              </span>
            </p>
          )}
          <PhoneLink store={store} className="text-sm" />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <div className="flex flex-col items-start gap-2">
            <GlowPoints store={store} />
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                store.is_open ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700" : "bg-mist text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${store.is_open ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              {store.is_open ? "Open Now" : "Closed"}
            </span>
          </div>

          <button
            onClick={onOpen}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-6 text-sm font-medium text-primary-foreground transition-transform active:scale-95"
          >
            Visit Café <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CafeGridCard({ store, onOpen }: { store: DiscoveryItem; onOpen: () => void }) {
  return (
    <div className="glass flex items-stretch gap-3 rounded-3xl p-3">
      <CafeImage store={store} className="h-full min-h-[104px] w-28 shrink-0 rounded-2xl" />

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-display text-lg leading-tight text-foreground">{store.business_name}</p>
            <RatingBadge store={store} />
          </div>
          {(store.address || store.distance_km !== null) && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {store.address}
                {store.address && store.distance_km !== null && " · "}
                {distanceLabel(store.distance_km)}
              </span>
            </p>
          )}
          <PhoneLink store={store} className="text-xs" />
        </div>

        <div className="flex items-end justify-between gap-2 pt-2">
          <div className="flex flex-col items-start gap-1.5">
            <GlowPoints store={store} />
            <span
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                store.is_open ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700" : "bg-mist text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${store.is_open ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              {store.is_open ? "Open Now" : "Closed"}
            </span>
          </div>

          <button
            onClick={onOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-primary-foreground transition-transform active:scale-90"
            aria-label={`Open ${store.business_name}`}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function StoresPage() {
  const [stores, setStores] = useState<DiscoveryItem[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("nearby");
  const [showAll, setShowAll] = useState(false);
  const navigate = useNavigate();

  const greeting = useMemo(getGreeting, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      loadStores();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        loadStores(loc.lat, loc.lng);
      },
      () => {
        loadStores();
      },
      { timeout: 8000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadStores(lat?: number, lng?: number) {
    setLoading(true);
    setError("");
    try {
      const data = await merchantApi.nearby(lat, lng);
      setStores(data);
    } catch (e: any) {
      setError(e.message || "Failed to load nearby stores");
    } finally {
      setLoading(false);
    }
  }

  function openStore(slug: string) {
    navigate({ to: "/m/$slug", params: { slug } });
  }

  const filtered = useMemo(() => {
    let list = stores;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.business_name.toLowerCase().includes(q) ||
          (s.address ?? "").toLowerCase().includes(q) ||
          (s.business_type ?? "").toLowerCase().includes(q)
      );
    }

    if (activeFilter === "open") {
      list = list.filter((s) => s.is_open);
    } else if (activeFilter === "coffee" || activeFilter === "tea" || activeFilter === "bakery") {
      list = list.filter((s) => (s.business_type ?? "").toLowerCase().includes(activeFilter));
    }
    // "rewards" and "nearby" are cosmetic until the backend exposes reward
    // counts on the discovery endpoint — see notes below the component.

    return list;
  }, [stores, search, activeFilter]);

  const featured = filtered.find((s) => s.is_open) ?? filtered[0];
  const rest = filtered.filter((s) => s.id !== featured?.id);
  const visibleRest = showAll ? rest : rest.slice(0, 4);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 px-5 pb-10 pt-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {greeting.text} <span>{greeting.emoji}</span>
          </p>
          <h1 className="font-display mt-1 text-4xl leading-tight text-foreground sm:text-5xl">
            Discover
            <br />
            <span className="text-ember">Nearby Cafés</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Earn rewards while you sip.</p>
        </div>

        <span className="mt-1 inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
          <MapPin className="h-3.5 w-3.5" />
          {userLocation ? "Using your location" : "Location off"}
          <span className={`h-1.5 w-1.5 rounded-full ${userLocation ? "bg-emerald-500" : "bg-muted-foreground"}`} />
        </span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cafés, places or cuisines..."
          className="h-12 w-full rounded-full bg-mist pl-11 pr-11 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none focus:ring-2 focus:ring-ink/15"
        />
        <button
          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-background text-muted-foreground hover:text-foreground"
          aria-label="Filters"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Filter pills */}
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(({ key, label, icon: Icon }) => {
          const active = activeFilter === key;
          return (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                active ? "bg-ink text-primary-foreground" : "glass text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="glass rounded-3xl py-16 text-center">
          <p className="text-4xl">🔍</p>
          <p className="mt-3 text-sm text-muted-foreground">No cafés match right now</p>
        </div>
      ) : (
        <>
          {/* Featured */}
          {featured && <FeaturedCard store={featured} onOpen={() => openStore(featured.slug)} />}

          {/* Grid */}
          {rest.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl text-foreground">Nearby Cafés</h2>
                {rest.length > 4 && (
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="inline-flex items-center gap-1 text-sm font-medium text-foreground"
                  >
                    {showAll ? "Show less" : "View all"} <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {visibleRest.map((store) => (
                  <CafeGridCard key={store.id} store={store} onOpen={() => openStore(store.slug)} />
                ))}
              </div>
            </section>
          )}

          {/* Map — square on the left, headline on the right */}
          <section className="glass-strong overflow-hidden rounded-3xl md:flex md:items-stretch">
            <div className="p-4 md:w-1/2 md:p-5">
              <CafeDiscoveryMap
                merchants={filtered}
                userLocation={userLocation}
                onSelectSlug={openStore}
                className="aspect-square w-full overflow-hidden rounded-2xl"
              />
            </div>

            <div className="flex flex-col justify-center gap-3 p-6 md:w-1/2 md:p-10">
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-mist px-3 py-1 text-xs font-medium text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {filtered.length} café{filtered.length === 1 ? "" : "s"} pinned
              </span>
              <h2 className="font-display text-4xl leading-[1.1] tracking-tight text-foreground sm:text-5xl">
                Find Cafés
                <br />
                <span className="text-ember">on the Map</span>
              </h2>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                Every pin is a place waiting to be sipped. Tap one to see what's brewing.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}