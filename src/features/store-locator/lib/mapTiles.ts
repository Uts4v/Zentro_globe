// src/features/store-locator/lib/mapTiles.ts
//
// Base-map tiles for every Leaflet map (Discover + merchant location picker).
// CARTO basemaps now need an API key — unkeyed requests return blank
// "API KEY REQUIRED" tiles — so the default is OpenStreetMap's standard layer.
// OSM's servers are for light use only; for production traffic set
// VITE_MAP_TILE_URL / VITE_MAP_TILE_ATTRIBUTION to a keyed provider.
export const MAP_TILES = {
  url:
    (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ||
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};
