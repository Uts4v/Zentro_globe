// src/routes/map.tsx
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { merchantApi, type MerchantDiscoveryItem } from "@/lib/api";
import { CafeDiscoveryMap } from "@/features/store-locator/pages/CafeDiscoveryMap";
import { useEffect, useState } from "react";
import { Navigation, Loader2, ChevronRight, Search, Phone } from "lucide-react";
import { useStore } from "@/lib/store";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/map")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Discover · Zentro" }] }),
  component: MapPage,
});

function MapPage() {
  const { setSelectedMerchant } = useStore();
  const navigate = useNavigate();
  const [merchants, setMerchants] = useState<MerchantDiscoveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [search, setSearch] = useState("");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);

  // Load merchants on mount (no location yet)
  useEffect(() => {
    merchantApi
      .nearby()
      .then(setMerchants)
      .catch(() => setMerchants([]))
      .finally(() => setLoading(false));
  }, []);

  function handleLocate() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setUserPos({ lat, lng });
        try {
          const data = await merchantApi.nearby(lat, lng);
          setMerchants(data);
        } catch {
          // Keep whatever list we already had rather than wiping it out
        } finally {
          setLocating(false);
        }
      },
      () => setLocating(false),
      { timeout: 8000 },
    );
  }

  function handleSelectMerchant(m: MerchantDiscoveryItem) {
    setSelectedMerchant(m.id);
    navigate({ to: "/" as any });
  }

  const filtered = merchants.filter((m) =>
    m.business_name.toLowerCase().includes(search.toLowerCase()) ||
    (m.address ?? "").toLowerCase().includes(search.toLowerCase()),
  );

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
              placeholder="Search cafés, restaurants…"
              className="h-11 w-full rounded-2xl bg-mist pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>
          <button
            onClick={handleLocate}
            disabled={locating}
            aria-label="Use my location"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ink text-white disabled:opacity-50"
          >
            {locating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Navigation className="h-4 w-4" />
            )}
          </button>
        </div>
        {userPos && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Sorted by distance from your location
          </p>
        )}
      </div>

      {/* Real map */}
      <section className="mx-5 mb-4">
        <CafeDiscoveryMap
          merchants={filtered}
          userLocation={userPos}
          onSelectSlug={(slug) => {
            const m = merchants.find((mm) => mm.slug === slug);
            if (m) handleSelectMerchant(m);
          }}
        />
      </section>

      {/* Merchant list */}
      <section className="px-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl text-foreground">
            {userPos ? "Nearby stores" : "All stores"}
          </h2>
          <span className="text-xs text-muted-foreground">{filtered.length} found</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-3xl p-8 text-center">
            <p className="text-sm font-medium text-foreground">No stores found</p>
            <p className="mt-1 text-xs text-muted-foreground">Try a different search term</p>
          </div>
        ) : (
          <div className="space-y-3 pb-4">
            {filtered.map((m) => (
              <button
                key={m.id}
                onClick={() => handleSelectMerchant(m)}
                className="glass w-full rounded-3xl p-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-mist">
                    {m.logo_url ? (
                      <img src={m.logo_url} alt={m.business_name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-display text-xl text-foreground">
                        {m.business_name.charAt(0)}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{m.business_name}</p>
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
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.address}</p>
                    )}
                    {m.phone && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3 shrink-0" /> {m.phone}
                      </p>
                    )}
                    {m.distance_km != null && (
                      <p className="mt-0.5 text-xs text-ember font-medium">
                        {m.distance_km < 1
                          ? `${Math.round(m.distance_km * 1000)} m away`
                          : `${m.distance_km.toFixed(1)} km away`}
                      </p>
                    )}
                  </div>

                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </MobileShell>
  );
}
