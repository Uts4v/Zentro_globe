// src/features/store-locator/components/DiscoverStates.tsx
//
// Location status + empty states shared by both Discover screens (/map, /stores).
import { Loader2, LocateFixed, MapPin, MapPinOff } from "lucide-react";
import type { LocationStatus, UserLocation } from "../hooks/useUserLocation";
import { DISCOVERY_WIDE_RADIUS_KM, formatAccuracy } from "../lib/geo";

const PROMPT_COPY: Record<Exclude<LocationStatus, "ready">, { title: string; body: string }> = {
  locating: {
    title: "Finding cafés near you…",
    body: "Allow location access if your browser asks. Discover uses it to show cafés around you.",
  },
  denied: {
    title: "Location access is off",
    body: "Discover only shows cafés near where you are. Allow location for this site in your browser or phone settings, then try again.",
  },
  unavailable: {
    title: "Couldn't get your location",
    body: "Make sure location services are turned on for your device and browser, then try again.",
  },
  unsupported: {
    title: "Location isn't supported here",
    body: "This browser can't share your location. Try a recent version of Chrome or Safari.",
  },
  insecure: {
    title: "Location needs a secure connection",
    body: "Browsers only share GPS with https:// sites. Open Zentro over https (not an http:// or local network address) to see cafés near you.",
  },
};

export function LocationPrompt({
  status,
  refreshing,
  onRetry,
}: {
  status: Exclude<LocationStatus, "ready">;
  refreshing: boolean;
  onRetry: () => void;
}) {
  const { title, body } = PROMPT_COPY[status];
  const canRetry = status === "denied" || status === "unavailable";
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center">
      {status === "locating" ? (
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      ) : (
        <MapPinOff className="h-7 w-7 text-muted-foreground" />
      )}
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{body}</p>
      {canRetry && (
        <button
          onClick={onRetry}
          disabled={refreshing}
          className="mt-1 inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
          Try again
        </button>
      )}
    </div>
  );
}

export function LocationChip({
  status,
  location,
}: {
  status: LocationStatus;
  location: UserLocation | null;
}) {
  const on = status === "ready" && location;
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
      {status === "locating" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <MapPin className="h-3.5 w-3.5" />
      )}
      {on
        ? `Near you · ${formatAccuracy(location.accuracy)}`
        : status === "locating"
          ? "Locating…"
          : "Location off"}
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground"}`}
      />
    </span>
  );
}

export function NoCafesNearby({ radiusKm, onWiden }: { radiusKm: number; onWiden: () => void }) {
  return (
    <div className="glass rounded-3xl px-6 py-12 text-center">
      <p className="text-4xl">☕</p>
      <p className="mt-3 font-medium text-foreground">No cafés within {radiusKm} km of you yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Zentro cafés appear here once they're near your current location.
      </p>
      {radiusKm < DISCOVERY_WIDE_RADIUS_KM && (
        <button
          onClick={onWiden}
          className="mt-4 inline-flex h-10 items-center rounded-full border border-border px-5 text-sm font-medium text-foreground hover:border-ink"
        >
          Search within {DISCOVERY_WIDE_RADIUS_KM} km
        </button>
      )}
    </div>
  );
}
