// src/features/store-locator/lib/geo.ts
//
// Small geo helpers shared by Discover (customer) and the merchant location
// picker. Server-side ranking lives in backend/merchants/views.py — keep the
// radius constants in sync with DISCOVERY_DEFAULT_RADIUS_KM / _MAX_ there.

export type LatLng = { lat: number; lng: number };

/** Search radius Discover uses by default. */
export const DISCOVERY_RADIUS_KM = 25;
/** Widest radius the backend accepts ("search wider" fallback). */
export const DISCOVERY_WIDE_RADIUS_KM = 100;

/** Above this GPS accuracy (metres) a fix is too rough to pin a storefront. */
export const PRECISE_ACCURACY_M = 100;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km == null || Number.isNaN(km)) return null;
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatAccuracy(metres: number): string {
  return metres < 1000 ? `±${Math.round(metres)} m` : `±${(metres / 1000).toFixed(1)} km`;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/** Parse the string coordinates the API returns ("27.717245") into a point. */
export function toLatLng(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): LatLng | null {
  if (
    lat === null ||
    lat === undefined ||
    lat === "" ||
    lng === null ||
    lng === undefined ||
    lng === ""
  ) {
    return null;
  }
  const point = { lat: Number(lat), lng: Number(lng) };
  return isValidLatLng(point.lat, point.lng) ? point : null;
}

/** Parse pasted text such as "27.717245, 85.324001" (Google Maps format). */
export function parseLatLngText(text: string): LatLng | null {
  const match = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return toLatLng(match[1], match[2]);
}

/** Same point to the precision the backend stores (6 dp ≈ 0.1 m)? */
export function sameLatLng(a: LatLng | null, b: LatLng | null): boolean {
  if (!a || !b) return a === b;
  return a.lat.toFixed(6) === b.lat.toFixed(6) && a.lng.toFixed(6) === b.lng.toFixed(6);
}
