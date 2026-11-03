import { useEffect } from "react";

import { refreshPosOrderFeed } from "../orders/feed";
import { startPosRealtime, stopPosRealtime, subscribePosRealtime } from "../realtime";
import { usePosStore } from "../store";

const FEED_REFRESH_DEBOUNCE_MS = 500;

export default function PosRealtimeBridge() {
  const merchantId = usePosStore((s) => s.merchant?.id);

  useEffect(() => {
    if (!merchantId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePosRealtime((event) => {
      if (event.event !== "order.changed") return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refreshPosOrderFeed();
      }, FEED_REFRESH_DEBOUNCE_MS);
    });

    startPosRealtime(merchantId);

    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      stopPosRealtime();
    };
  }, [merchantId]);

  return null;
}
