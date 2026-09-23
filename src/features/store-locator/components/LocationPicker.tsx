// src/features/store-locator/components/LocationPicker.tsx
//
// Lets a merchant pin their storefront precisely: GPS for a starting point,
// then drag the pin / tap the map (or paste coordinates) to fine-tune.
// Laptop "current location" is often Wi-Fi/IP based and kilometres off, so
// rough fixes are flagged instead of silently trusted.
import { useEffect, useState, type ComponentType } from "react";
import { AlertTriangle, Loader2, LocateFixed } from "lucide-react";
import type { LocationPickerMapProps } from "./LocationPickerMap";
import { formatAccuracy, parseLatLngText, PRECISE_ACCURACY_M, type LatLng } from "../lib/geo";

export function LocationPicker({
  value,
  onChange,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
}) {
  const [MapView, setMapView] = useState<ComponentType<LocationPickerMapProps> | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");

  useEffect(() => {
    let active = true;
    import("./LocationPickerMap").then((mod) => {
      if (active) setMapView(() => mod.LocationPickerMap);
    });
    return () => {
      active = false;
    };
  }, []);

  function setFromOutside(point: LatLng) {
    onChange(point);
    setFocusKey((k) => k + 1);
  }

  function locateMe() {
    if (!window.isSecureContext) {
      setError(
        "Location only works on https:// — open the dashboard over https, or paste coordinates below.",
      );
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("Your browser doesn't support location. Paste coordinates below instead.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsAccuracy(pos.coords.accuracy);
        setFromOutside({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Enable it in your browser settings, or paste coordinates below."
            : "Couldn't get your location. Try again, or paste coordinates below.",
        );
        setLocating(false);
      },
      // Fresh, high-accuracy fix: a cached position may be from somewhere else.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  function applyPasted() {
    const point = parseLatLngText(pasted);
    if (!point) {
      setError('Couldn\'t read those coordinates. Use the format "27.717245, 85.324001".');
      return;
    }
    setError(null);
    setGpsAccuracy(null);
    setPasted("");
    setFromOutside(point);
  }

  const rough = gpsAccuracy !== null && gpsAccuracy > PRECISE_ACCURACY_M;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={locateMe}
        disabled={locating}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
      >
        {locating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <LocateFixed className="h-4 w-4" />
        )}
        {locating
          ? "Getting your location…"
          : value
            ? "Move pin to my current location"
            : "Use my current location"}
      </button>

      {value && (
        <>
          {MapView ? (
            <MapView
              value={value}
              focusKey={focusKey}
              onPick={onChange}
              className="h-56 w-full overflow-hidden rounded-2xl border border-border"
            />
          ) : (
            <div className="h-56 w-full rounded-2xl bg-mist" />
          )}
          <p className="text-xs text-muted-foreground">
            Drag the pin or tap the map to put it exactly on your entrance.{" "}
            <span className="tabular-nums">
              {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
            </span>
          </p>
        </>
      )}

      {rough && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            This device's location is approximate ({formatAccuracy(gpsAccuracy)}) — common on
            laptops. Drag the pin onto your café, or use your phone at the store for a precise fix.
          </span>
        </p>
      )}
      {gpsAccuracy !== null && !rough && (
        <p className="text-xs text-emerald-600">
          GPS fix accurate to {formatAccuracy(gpsAccuracy)}.
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyPasted();
            }
          }}
          placeholder="Or paste coordinates, e.g. 27.717245, 85.324001"
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-transparent px-3 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-ink"
        />
        <button
          type="button"
          onClick={applyPasted}
          disabled={!pasted.trim()}
          className="h-10 shrink-0 rounded-xl border border-border px-3 text-xs font-medium text-ink hover:border-ink disabled:opacity-40"
        >
          Set
        </button>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
