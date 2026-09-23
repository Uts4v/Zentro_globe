// src/features/store-locator/pages/CafeDiscoveryMapInner.tsx
//
// This file is only ever loaded via a dynamic import() from
// CafeDiscoveryMap.tsx, which happens inside a useEffect (client-only).
// Never import this file directly, and never import it at the top of a
// file that participates in SSR — Leaflet touches `window` at module load
// time and will crash the server render.
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import type { MerchantDiscoveryItem } from "@/lib/api";
import { formatDistance, toLatLng } from "../lib/geo";
import { MAP_TILES } from "../lib/mapTiles";

const userIcon = L.divIcon({
  className: "",
  html: `<div style="
    width: 16px; height: 16px; border-radius: 9999px;
    background: #3b82f6; border: 3px solid white;
    box-shadow: 0 0 0 2px rgba(59,130,246,0.4);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Numbered pins: pin N on the map is row N in the nearby list. Fixed colours
// (not theme tokens) because the base map looks the same in both themes.
const PIN_COLOR = "#172a2b";
const PIN_HIGHLIGHT_COLOR = "#761c26";
const pinIconCache = new Map<string, L.DivIcon>();
function pinIcon(rank: number, highlighted: boolean): L.DivIcon {
  const key = `${rank}:${highlighted}`;
  let icon = pinIconCache.get(key);
  if (!icon) {
    const size = highlighted ? 34 : 28;
    icon = L.divIcon({
      className: "",
      html: `<div style="
        width:${size}px;height:${size}px;border-radius:9999px 9999px 9999px 0;
        transform:rotate(-45deg);display:grid;place-items:center;
        background:${highlighted ? PIN_HIGHLIGHT_COLOR : PIN_COLOR};
        border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);
      "><span style="transform:rotate(45deg);color:white;font:600 ${highlighted ? 13 : 12}px/1 system-ui,sans-serif">${rank}</span></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
      popupAnchor: [0, -size],
    });
    pinIconCache.set(key, icon);
  }
  return icon;
}

export interface CafeDiscoveryMapProps {
  /** Cafés in display order (nearest first). Pin numbers follow this order. */
  merchants: MerchantDiscoveryItem[];
  userLocation: { lat: number; lng: number; accuracy?: number } | null;
  /** Opens the café — the same handler the list uses. */
  onSelectSlug: (slug: string) => void;
  /** Café to emphasise (e.g. the list row being hovered). */
  highlightedId?: MerchantDiscoveryItem["id"] | null;
  onHighlight?: (id: MerchantDiscoveryItem["id"] | null) => void;
  /** Full className for the map's outer container — controls size/shape.
   *  Defaults to a fixed-height rounded box. Pass e.g. "aspect-square w-full
   *  overflow-hidden rounded-3xl" for a square map. */
  className?: string;
}

/** Re-frame the map whenever the user moves or the set of cafés changes. */
function FitToContent({
  user,
  points,
}: {
  user: { lat: number; lng: number } | null;
  points: { lat: number; lng: number }[];
}) {
  const map = useMap();
  const key = JSON.stringify([user, points]);

  useEffect(() => {
    const all = [...(user ? [user] : []), ...points];
    if (all.length === 0) return;
    if (all.length === 1) {
      map.setView([all[0].lat, all[0].lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng] as [number, number])), {
      padding: [36, 36],
      maxZoom: 16,
    });
    // `key` captures every coordinate; the arrays themselves change identity each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);

  return null;
}

export function CafeDiscoveryMapInner({
  merchants,
  userLocation,
  onSelectSlug,
  highlightedId,
  onHighlight,
  className,
}: CafeDiscoveryMapProps) {
  const pins = useMemo(
    () =>
      merchants.flatMap((m, index) => {
        const point = toLatLng(m.latitude, m.longitude);
        return point ? [{ ...m, ...point, rank: index + 1 }] : [];
      }),
    [merchants],
  );

  const user = userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null;
  const containerClass = className ?? "glass overflow-hidden rounded-3xl h-[260px] w-full";

  if (!user && pins.length === 0) {
    return (
      <div className={containerClass}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
          <MapPin className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm font-medium text-muted-foreground">Waiting for your location</p>
        </div>
      </div>
    );
  }

  const initial = user ?? pins[0];

  return (
    <div className={containerClass}>
      <MapContainer
        center={[initial.lat, initial.lng]}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution={MAP_TILES.attribution}
          url={MAP_TILES.url}
          maxZoom={MAP_TILES.maxZoom}
        />

        <FitToContent user={user} points={pins.map(({ lat, lng }) => ({ lat, lng }))} />

        {userLocation && (
          <>
            {userLocation.accuracy != null && userLocation.accuracy < 2000 && (
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={userLocation.accuracy}
                pathOptions={{ color: "#3b82f6", weight: 1, fillOpacity: 0.08 }}
              />
            )}
            {/* Above regular pins so a café right next to the user can't hide the dot. */}
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={userIcon}
              zIndexOffset={500}
            >
              <Popup>You are here</Popup>
            </Marker>
          </>
        )}

        {pins.map((store) => {
          const highlighted = store.id === highlightedId;
          return (
            <Marker
              key={store.id}
              position={[store.lat, store.lng]}
              icon={pinIcon(store.rank, highlighted)}
              zIndexOffset={highlighted ? 1000 : -store.rank}
              eventHandlers={{
                click: () => onHighlight?.(store.id),
                popupclose: () => onHighlight?.(null),
              }}
            >
              <Popup>
                <div className="min-w-[160px] text-sm">
                  <div className="font-medium">
                    {store.rank}. {store.business_name}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      formatDistance(store.distance_km) &&
                        `${formatDistance(store.distance_km)} away`,
                      store.is_open ? "Open" : "Closed",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {store.address && (
                    <div className="text-xs text-muted-foreground">{store.address}</div>
                  )}
                  <button
                    onClick={() => onSelectSlug(store.slug)}
                    className="mt-1.5 text-xs font-semibold text-ember underline"
                  >
                    View café →
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
