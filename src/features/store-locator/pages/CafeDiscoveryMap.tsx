// src/features/store-locator/pages/CafeDiscoveryMap.tsx
//
// Public entry point. Deliberately contains NO top-level import of
// "leaflet" or "react-leaflet" — those are pulled in via a dynamic
// import() inside useEffect, so they only ever load in the browser and
// never touch the SSR bundle (Leaflet reads `window` at module load time).
import { useEffect, useState } from "react";
import type { MerchantDiscoveryItem } from "@/lib/api";
import type { CafeDiscoveryMapProps } from "./CafeDiscoveryMapInner";

export function CafeDiscoveryMap(props: CafeDiscoveryMapProps) {
  const [InnerMap, setInnerMap] = useState<React.ComponentType<CafeDiscoveryMapProps> | null>(null);

  useEffect(() => {
    let active = true;
    import("./CafeDiscoveryMapInner").then((mod) => {
      if (active) setInnerMap(() => mod.CafeDiscoveryMapInner);
    });
    return () => {
      active = false;
    };
  }, []);

  const skeletonClass = props.className ?? "glass rounded-3xl h-[260px] w-full";

  if (!InnerMap) {
    // Skeleton shown during SSR and while Leaflet loads on the client.
    // Uses the same className as the real map so layout never jumps.
    return <div className={skeletonClass} />;
  }

  return <InnerMap {...props} />;
}

export type { MerchantDiscoveryItem };
