// src/features/store-locator/components/LocationPickerMap.tsx
//
// Client-only (Leaflet touches `window` at import). Loaded via dynamic
// import() from LocationPicker.tsx — never import it directly.
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "../lib/geo";
import { MAP_TILES } from "../lib/mapTiles";

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:30px;height:30px;border-radius:9999px 9999px 9999px 0;transform:rotate(-45deg);
    background:#761c26;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);
  "></div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

export interface LocationPickerMapProps {
  value: LatLng;
  /** Bumped when the value came from outside the map (GPS, pasted coords). */
  focusKey: number;
  onPick: (point: LatLng) => void;
  className?: string;
}

function FocusOnValue({ value, focusKey }: { value: LatLng; focusKey: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([value.lat, value.lng], Math.max(map.getZoom(), 17));
    // Only re-centre for external changes; dragging the pin must not jump the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, map]);
  return null;
}

function TapToPlace({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

export function LocationPickerMap({ value, focusKey, onPick, className }: LocationPickerMapProps) {
  return (
    <div className={className}>
      <MapContainer
        center={[value.lat, value.lng]}
        zoom={17}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution={MAP_TILES.attribution}
          url={MAP_TILES.url}
          maxZoom={MAP_TILES.maxZoom}
        />
        <FocusOnValue value={value} focusKey={focusKey} />
        <TapToPlace onPick={onPick} />
        <Marker
          position={[value.lat, value.lng]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const p = (e.target as L.Marker).getLatLng();
              onPick({ lat: p.lat, lng: p.lng });
            },
          }}
        />
      </MapContainer>
    </div>
  );
}
