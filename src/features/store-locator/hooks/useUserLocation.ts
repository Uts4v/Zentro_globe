// src/features/store-locator/hooks/useUserLocation.ts
//
// The customer's live device location for Discover. Each device asks its own
// browser for GPS — nothing here is shared, cached server-side or defaulted,
// so two phones in two cities always get two different results.
import { useCallback, useEffect, useRef, useState } from "react";
import { haversineKm, type LatLng } from "../lib/geo";

export type UserLocation = LatLng & { accuracy: number };

export type LocationStatus =
  | "locating" // waiting for the first fix (or the permission prompt)
  | "ready" // we have a position
  | "denied" // user or browser blocked location for this site
  | "unavailable" // device couldn't produce a fix (no GPS signal, timeout)
  | "unsupported" // browser has no Geolocation API
  | "insecure"; // page served over plain http — browsers block GPS there

// Ignore GPS jitter: only publish a new position once the user has actually
// moved, so the nearby list isn't refetched every few seconds.
const MOVE_THRESHOLD_KM = 0.15;

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>("locating");
  const [refreshing, setRefreshing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastRef = useRef<UserLocation | null>(null);
  const forceRef = useRef(false);

  useEffect(() => {
    if (!window.isSecureContext || !("geolocation" in navigator)) {
      setStatus(window.isSecureContext ? "unsupported" : "insecure");
      setRefreshing(false);
      return;
    }
    if (!lastRef.current) setStatus("locating");

    const onPosition = (pos: GeolocationPosition) => {
      const next = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };
      const prev = lastRef.current;
      const moved = !prev || haversineKm(prev, next) >= MOVE_THRESHOLD_KM;
      // A coarse network fix is often followed by a sharp GPS one nearby.
      const sharper = !!prev && next.accuracy < prev.accuracy / 2;
      if (forceRef.current || moved || sharper) {
        lastRef.current = next;
        setLocation(next);
      }
      forceRef.current = false;
      setRefreshing(false);
      setStatus("ready");
    };

    const onError = (err: GeolocationPositionError) => {
      setRefreshing(false);
      if (err.code === err.PERMISSION_DENIED) {
        lastRef.current = null;
        setLocation(null);
        setStatus("denied");
      } else if (!lastRef.current) {
        // A timeout after a good fix just means "no update yet" — keep it.
        setStatus("unavailable");
      }
    };

    const watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: forceRef.current ? 0 : 60_000,
      timeout: 20_000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [attempt]);

  /** Re-read GPS now (e.g. the user tapped "locate me"); retries after errors too. */
  const refresh = useCallback(() => {
    forceRef.current = true;
    setRefreshing(true);
    setAttempt((n) => n + 1);
  }, []);

  return { location, status, refreshing, refresh };
}
