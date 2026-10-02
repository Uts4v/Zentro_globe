import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { isOnline, subscribeConnectivity } from "@/lib/connectivity";
import {
  startBackgroundSync,
  stopBackgroundSync,
  processSyncQueue,
  getSyncStatus,
  subscribeSync,
  getSyncRevision,
} from "./sync";
import { offlineOrders, OfflineOrder } from "./db";

/**
 * False while the POS has to work on its own: the device has no network, or
 * it has one but the server is not answering.
 */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribeConnectivity, isOnline, () => true);
}

/**
 * Changes whenever new work is queued or a sync pass finishes — the moments
 * at which anything listing unsynced work is out of date.
 */
export function useSyncRevision() {
  return useSyncExternalStore(subscribeSync, getSyncRevision, () => 0);
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
  const online = useOnlineStatus();
  const syncRevision = useSyncRevision();
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
  }, [reloadKey, online, syncRevision]);

  return { orders, reload };
}

export function useSyncStatus() {
  const [status, setStatus] = useState({
    pending: 0,
    failed: 0,
    dead: 0,
    isSyncing: false,
    needsSignIn: false,
  });

  const refresh = useCallback(() => {
    getSyncStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeSync(refresh);
    // Another tab can change the queue too, so keep a slow poll as well.
    const interval = setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  return { ...status, refresh };
}

export function useBackgroundSync() {
  useEffect(() => {
    startBackgroundSync(30000);
    return () => stopBackgroundSync();
  }, []);

  const syncNow = useCallback(() => {
    return processSyncQueue({ force: true });
  }, []);

  return { syncNow };
}
