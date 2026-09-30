// src/features/inventory/components/usePreselectedItem.ts
import { useEffect, useState } from "react";
import { inventoryApi, type InventoryItem } from "@/lib/api";

/** Load the item a screen was opened for (e.g. "Record Waste" from an item). */
export function usePreselectedItem(
  itemId: number | undefined,
  apply: (item: InventoryItem) => void,
) {
  const [loaded, setLoaded] = useState<number | null>(null);
  useEffect(() => {
    if (!itemId || loaded === itemId) return;
    let cancelled = false;
    inventoryApi
      .itemDetail(itemId)
      .then((item) => {
        if (!cancelled) {
          apply(item);
          setLoaded(itemId);
        }
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, loaded]);
}

export function stockAtLocation(item: InventoryItem | null, locationId: number | null): number {
  if (!item || !locationId) return 0;
  return Number(item.locations.find((l) => l.location === locationId)?.on_hand ?? 0);
}
