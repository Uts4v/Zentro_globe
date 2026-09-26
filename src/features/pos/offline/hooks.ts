import { useState, useEffect, useCallback } from "react";
import {
  startBackgroundSync,
  stopBackgroundSync,
  processSyncQueue,
  getSyncStatus,
} from "./sync";
import { offlineOrders, OfflineOrder } from "./db";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Orders captured on this device that have not reached the server yet.
 *
 * These are the orders a cashier still needs after going offline: the kitchen
 * display and the orders screen are both server-driven, so without this the
 * only trace of an offline sale would be IndexedDB. `server_order_id` is set
 * once the order syncs, so filtering on it keeps a freshly synced order from
 * showing up twice while the orders list is still on a stale fetch.
 */
export function usePendingOfflineOrders() {
  const isOnline = useOnlineStatus();
  const [orders, setOrders] = useState<OfflineOrder[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    offlineOrders.getPending().then((pending) => {
      if (!cancelled) setOrders(pending.filter((o) => !o.server_order_id));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, isOnline]);

  return { orders, reload };
}

export function useSyncStatus() {
  const [status, setStatus] = useState({
    pending: 0,
    failed: 0,
    isSyncing: false,
  });
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    getSyncStatus().then(setStatus);
  }, [refreshKey]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      getSyncStatus().then(setStatus);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return { ...status, refresh };
}

export function useBackgroundSync() {
  useEffect(() => {
    startBackgroundSync(30000);
    return () => stopBackgroundSync();
  }, []);

  const syncNow = useCallback(() => {
    return processSyncQueue();
  }, []);

  return { syncNow };
}
