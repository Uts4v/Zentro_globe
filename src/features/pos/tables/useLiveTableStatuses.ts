import { useCallback, useEffect, useRef, useState } from "react";

import { posListTableStatuses, type PosTableStatus } from "../api";
import { subscribePosRealtime } from "../realtime";

const POLL_INTERVAL_MS = 5_000;
const REALTIME_DEBOUNCE_MS = 300;

export interface LiveTableStatuses {
  statuses: PosTableStatus[];
  loading: boolean;
  error: string | null;
  refresh: (silent?: boolean) => Promise<void>;
}

/**
 * Live table availability for screens that show occupancy. Polling is the
 * fallback; a table move broadcasts `order.changed`, which refreshes within
 * the debounce window so the table picker does not wait for the next poll.
 */
export function useLiveTableStatuses(): LiveTableStatuses {
  const [statuses, setStatuses] = useState<PosTableStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setLoading(false);
      return;
    }

    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const data = await posListTableStatuses();
      setStatuses(data.tables);
      setError(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message ? err.message : "Could not load table availability.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);

    const timer = setInterval(() => {
      if (navigator.onLine) void load(true);
    }, POLL_INTERVAL_MS);
    const onOnline = () => void load(true);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load(true);
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePosRealtime((event) => {
      if (event.event !== "order.changed") return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void load(true);
      }, REALTIME_DEBOUNCE_MS);
    });

    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  return { statuses, loading, error, refresh: load };
}
