// src/routes/map.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Navigation, Phone, Search } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { MobileShell, TopBar } from "@/components/MobileShell";
import type { MerchantDiscoveryItem } from "@/lib/api";
import { CafeDiscoveryMap } from "@/features/store-locator/pages/CafeDiscoveryMap";
import { useUserLocation } from "@/features/store-locator/hooks/useUserLocation";
import { useNearbyCafes } from "@/features/store-locator/hooks/useNearbyCafes";
import {
  LocationChip,
  LocationPrompt,
  NoCafesNearby,
} from "@/features/store-locator/components/DiscoverStates";
import {
  DISCOVERY_RADIUS_KM,
  DISCOVERY_WIDE_RADIUS_KM,
  formatDistance,
} from "@/features/store-locator/lib/geo";

export const Route = createFileRoute("/map")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Discover · Zentro" }] }),
  component: MapPage,
});

function MapPage() {
  const navigate = useNavigate();
  const { location, status, refreshing, refresh } = useUserLocation();
  const [radiusKm, setRadiusKm] = useState(DISCOVERY_RADIUS_KM);
  const {
    data: cafes = [],
    isPending,
    isFetching,
    isError,
    refetch,
  } = useNearbyCafes(location, radiusKm);
  const [search, setSearch] = useState("");
  const [highlightedId, setHighlightedId] = useState<MerchantDiscoveryItem["id"] | null>(null);

  // Map pins and list rows are the same array, in the same (nearest-first) order.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cafes;
    return cafes.filter(
      (m) =>
        m.business_name.toLowerCase().includes(q) ||
        (m.address ?? "").toLowerCase().includes(q) ||
        (m.business_type ?? "").toLowerCase().includes(q),
    );
  }, [cafes, search]);

  function openCafe(slug: string) {
    navigate({ to: "/m/$slug", params: { slug } });
  }

  return (
    <MobileShell>
      <TopBar title="Discover" />

      {/* Search + locate bar */}
      <div className="px-5 pb-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search nearby cafés…"
              className="h-11 w-full rounded-2xl bg-mist pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            aria-label="Update my location"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-white disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-center">
          <LocationChip status={status} location={location} />
        </div>
      </div>

      {status !== "ready" || !location ? (
        <section className="px-5">
          <LocationPrompt
            status={status === "ready" ? "locating" : status}
            refreshing={refreshing}
            onRetry={refresh}
          />
        </section>
      ) : (
        <>
          <section className="mx-5 mb-4">
            <CafeDiscoveryMap
              merchants={visible}
              userLocation={location}
              onSelectSlug={openCafe}
              highlightedId={highlightedId}
              onHighlight={setHighlightedId}
            />
          </section>

          <section className="px-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl text-foreground">Nearby cafés</h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
                {visible.length} within {radiusKm} km
              </span>
            </div>

            {isPending ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="glass rounded-3xl p-8 text-center">
                <p className="text-sm font-medium text-foreground">Couldn't load nearby cafés</p>
                <button
                  onClick={() => refetch()}
                  className="mt-2 text-xs font-semibold text-ember underline"
                >
                  Try again
                </button>
              </div>
            ) : cafes.length === 0 ? (
              <NoCafesNearby
                radiusKm={radiusKm}
                onWiden={() => setRadiusKm(DISCOVERY_WIDE_RADIUS_KM)}
              />
            ) : visible.length === 0 ? (
              <div className="glass rounded-3xl p-8 text-center">
                <p className="text-sm font-medium text-foreground">
                  No nearby cafés match "{search}"
                </p>
              </div>
            ) : (
              <ol className="space-y-3 pb-4">
                {visible.map((m, index) => (
                  <li key={m.id}>
                    <button
                      onClick={() => openCafe(m.slug)}
                      onMouseEnter={() => setHighlightedId(m.id)}
                      onMouseLeave={() => setHighlightedId(null)}
                      onFocus={() => setHighlightedId(m.id)}
                      onBlur={() => setHighlightedId(null)}
                      className={`glass w-full rounded-3xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98] ${
                        highlightedId === m.id ? "ring-2 ring-ember/40" : ""
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="relative shrink-0">
                          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-mist">
                            {m.logo_url ? (
                              <img
                                src={m.logo_url}
                                alt={m.business_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="font-display text-xl text-foreground">
                                {m.business_name.charAt(0)}
                              </span>
                            )}
                          </div>
                          <span className="absolute -left-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ink text-[10px] font-semibold text-primary-foreground">
                            {index + 1}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium text-foreground">
                              {m.business_name}
                            </p>
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                m.is_open
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                  : "bg-mist text-muted-foreground"
                              }`}
                            >
                              {m.is_open ? "Open" : "Closed"}
                            </span>
                          </div>
                          {m.address && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {m.address}
                            </p>
                          )}
                          {m.phone && (
                            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3 shrink-0" /> {m.phone}
                            </p>
                          )}
                          {m.distance_km != null && (
                            <p className="mt-0.5 text-xs font-medium text-ember">
                              {formatDistance(m.distance_km)} away
                            </p>
                          )}
                        </div>

                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </MobileShell>
  );
}
