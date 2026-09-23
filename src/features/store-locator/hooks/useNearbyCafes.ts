// src/features/store-locator/hooks/useNearbyCafes.ts
//
// One source of truth for Discover: the map pins and the nearby list both
// render this array, already ranked nearest-first by the backend.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { merchantApi } from "@/lib/api";
import { DISCOVERY_RADIUS_KM, type LatLng } from "../lib/geo";

export function useNearbyCafes(location: LatLng | null, radiusKm: number = DISCOVERY_RADIUS_KM) {
  return useQuery({
    queryKey: ["merchants", "nearby", location?.lat, location?.lng, radiusKm],
    queryFn: () => merchantApi.nearby(location!.lat, location!.lng, radiusKm),
    // No location → no request. Never fall back to an unfiltered list.
    enabled: location !== null,
    staleTime: 60_000,
    // Keep the previous results on screen while a moved position refetches.
    placeholderData: keepPreviousData,
  });
}
