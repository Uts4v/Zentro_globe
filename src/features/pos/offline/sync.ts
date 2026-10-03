/**
 * Background sync engine for POS offline mutations.
 * Processes the sync queue when online, with retry logic.
 */

import { djangoFetch, apiUrl, tokenStore } from "@/lib/django-api-base";
import { refreshAccessToken, secondsUntilExpiry } from "@/lib/auth-tokens";
import { isGatewayError, isOnline, subscribeConnectivity } from "@/lib/connectivity";
import { posListOrders } from "../api";
import { syncQueue, offlineOrders, offlinePayments, cachedServerOrders, SyncQueueItem } from "./db";

const RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 300000;
/** Held for a whole pass so two tabs never send the same queue at once. */
const SYNC_LOCK = "zentro-pos-sync";

type SyncResult = { synced: number; failed: number; pending: number };
type Outcome = "synced" | "dropped" | "failed" | "offline" | "signed_out";

let isSyncing = false;
let passHadWork = false;
let needsSignIn = false;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let stopWatchingConnection: (() => void) | null = null;

function headers() {
  return {
    Authorization: `Bearer ${tokenStore.getAccess()}`,
    "Content-Type": "application/json",
  };
}

// ── Change notifications ────────────────────────────────────────────────────
// Screens showing queued work (sync bar, offline tickets, orders) re-read it
// when it changes instead of waiting for a poll or a reconnect.

const listeners = new Set<() => void>();
let revision = 0;

/**
 * Tell listeners that sync progress changed. `queueChanged` also moves the
 * revision on, which is what screens reload their orders on: it is reserved
 * for new work and for the end of a pass, so a pass of twenty items causes one
 * reload rather than twenty.
 */
function notify(queueChanged = false) {
  if (queueChanged) revision += 1;
  listeners.forEach((fn) => fn());
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncRevision(): number {
  return revision;
}

// ── Enqueue a mutation for offline sync ─────────────────────────────────────

export async function enqueueMutation(
  type: SyncQueueItem["type"],
  endpoint: string,
  method: SyncQueueItem["method"],
  body: Record<string, any>,
  clientMutationId: string,
): Promise<void> {
  const item: SyncQueueItem = {
    id: clientMutationId,
    type,
    endpoint,
    method,
    body,
    client_mutation_id: clientMutationId,
    status: "pending",
    attempts: 0,
    created_at: new Date().toISOString(),
  };

  await syncQueue.add(item);
  notify(true);
  if (isOnline()) syncInBackground();
}

// ── Process a single queue item ─────────────────────────────────────────────

function httpStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * An order taken offline is known by its local id until it syncs. Anything
 * queued against it (its payment, its status changes) is pointed at the
 * server's order here, at send time, so it is right whether it was queued
 * before or after the order went up.
 */
async function withServerOrderRef(item: SyncQueueItem): Promise<Record<string, any>> {
  const ref = item.body?.order_id;
  if (item.type === "order" || typeof ref !== "string") return item.body;
  const local = await offlineOrders.get(ref);
  return local?.server_order_uuid ? { ...item.body, order_id: local.server_order_uuid } : item.body;
}

async function send(item: SyncQueueItem): Promise<any> {
  return djangoFetch<any>(apiUrl(item.endpoint), {
    method: item.method,
    headers: headers(),
    body: JSON.stringify(await withServerOrderRef(item)),
  });
}

async function recordFailure(item: SyncQueueItem, error: unknown): Promise<Outcome> {
  const status = httpStatus(error);
  const message = (error as { message?: string } | null)?.message || "Sync failed";

  // No answer from the server: the connection dropped. That is not a failed
  // attempt, and there is no point trying the rest of the queue.
  if (status === null || isGatewayError(status)) {
    await syncQueue.update(item.id, { status: "pending" });
    return "offline";
  }
  if (status === 401) {
    await syncQueue.update(item.id, { status: "pending" });
    return "signed_out";
  }

  const refused = status < 500 && status !== 408 && status !== 429;
  if (refused) {
    // A status change the server no longer accepts (the order has moved on,
    // e.g. it was completed by its payment) has nothing left to do.
    if (item.type === "order_status" && status !== 403) {
      await syncQueue.remove(item.id);
      return "dropped";
    }
    await syncQueue.update(item.id, {
      status: "failed",
      attempts: item.attempts + 1,
      last_error: message,
      needs_attention: true,
    });
    if (item.type === "order") await offlineOrders.markFailed(item.client_mutation_id, message);
    return "failed";
  }

  // Exponential backoff with jitter (max 5 minutes)
  const delay =
    Math.min(MAX_RETRY_DELAY_MS, RETRY_DELAY_MS * Math.pow(2, item.attempts)) +
    Math.floor(Math.random() * 500);
  await syncQueue.update(item.id, {
    status: "failed",
    attempts: item.attempts + 1,
    last_error: message,
    next_retry_at: Date.now() + delay,
    needs_attention: false,
  });
  return "failed";
}

async function processItem(queued: SyncQueueItem): Promise<Outcome> {
  // The queue can be cleared from the Conflicts screen while a pass is running.
  const item = await syncQueue.get(queued.id);
  if (!item) return "dropped";

  await syncQueue.update(item.id, { status: "syncing" });

  let response: any;
  try {
    response = await send(item);
  } catch (firstError) {
    try {
      // The access token can run out mid-pass; refresh once and resend.
      if (httpStatus(firstError) !== 401 || (await refreshAccessToken()) !== "refreshed") {
        throw firstError;
      }
      response = await send(item);
    } catch (error) {
      return recordFailure(item, error);
    }
  }

  // Success — remove from queue
  await syncQueue.remove(item.id);

  if (item.type === "order" && (response?.id || response?.uuid)) {
    await offlineOrders.markSynced(
      item.client_mutation_id,
      response.id || 0,
      response.uuid ? String(response.uuid) : undefined,
    );
  }
  if (item.type === "payment" && response?.id) {
    await offlinePayments.markSynced(item.client_mutation_id, String(response.id));
  }

  return "synced";
}

// ── Process entire queue ────────────────────────────────────────────────────

/** A usable access token, refreshed first if it ran out while offline. */
async function ensureSignedIn(): Promise<"ok" | "offline" | "signed_out"> {
  const access = tokenStore.getAccess();
  if (access && secondsUntilExpiry(access) > 30) return "ok";
  const outcome = await refreshAccessToken();
  if (outcome === "refreshed") return "ok";
  return outcome === "unreachable" ? "offline" : "signed_out";
}

/**
 * Orders that just synced now live on the server. Save the fresh list so they
 * are still shown if the connection drops again before the orders screen is
 * next opened.
 */
async function refreshCachedOrders() {
  try {
    cachedServerOrders.save(await posListOrders());
  } catch {
    // the orders screen refreshes it on its next load
  }
}

async function runQueue(force: boolean): Promise<SyncResult> {
  let synced = 0;
  let failed = 0;

  const queue = await syncQueue.getPending();
  if (queue.length === 0) return { synced, failed, pending: 0 };

  passHadWork = true;
  notify();

  const session = await ensureSignedIn();
  needsSignIn = session === "signed_out";
  if (session !== "ok") return { synced, failed, pending: queue.length };

  // Sort by created_at to process in order
  queue.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Orders that are still not on the server after this pass reached them.
  // Their payment and status changes cannot go up before they do.
  const waitingOrders = new Set<string>();

  for (const item of queue) {
    const parentOrder = item.type === "order" ? null : item.body?.order_id;
    const notDue = !force && (item.needs_attention || (item.next_retry_at ?? 0) > Date.now());
    if (notDue || (parentOrder && waitingOrders.has(parentOrder))) {
      if (item.type === "order") waitingOrders.add(item.id);
      continue;
    }

    const outcome = await processItem(item);
    if (outcome === "synced") synced++;
    if (outcome === "failed") {
      failed++;
      if (item.type === "order") waitingOrders.add(item.id);
    }
    notify();

    // Stop if we go offline (or are signed out) mid-sync
    if (outcome === "offline") break;
    if (outcome === "signed_out") {
      needsSignIn = true;
      break;
    }

    // Small delay between requests to avoid overwhelming the server
    await new Promise((r) => setTimeout(r, 100));
  }

  if (synced > 0) await refreshCachedOrders();

  const remaining = await syncQueue.getPending();
  return { synced, failed, pending: remaining.length };
}

async function withSyncLock(run: () => Promise<SyncResult>, busy: SyncResult): Promise<SyncResult> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return run();
  return locks.request(SYNC_LOCK, { ifAvailable: true }, (lock) => (lock ? run() : busy));
}

/**
 * Send everything that is waiting. `force` is the staff "Sync now" button: it
 * also retries items that are backing off or that the server refused, and it
 * tries even when the server is only presumed unreachable.
 */
export async function processSyncQueue(options: { force?: boolean } = {}): Promise<SyncResult> {
  const idle = { synced: 0, failed: 0, pending: 0 };
  if (isSyncing) return idle;
  if (options.force ? navigator.onLine === false : !isOnline()) return idle;

  isSyncing = true;
  passHadWork = false;
  try {
    return await withSyncLock(() => runQueue(!!options.force), idle);
  } finally {
    isSyncing = false;
    if (passHadWork) notify(true);
  }
}

function syncInBackground() {
  processSyncQueue().catch(() => {
    // storage unavailable: the next pass tries again
  });
}

// ── Start/stop background sync ──────────────────────────────────────────────

export function startBackgroundSync(intervalMs = 30000) {
  if (syncInterval) return; // Already running

  // Auto-sync on reconnect
  stopWatchingConnection = subscribeConnectivity(() => {
    if (isOnline()) syncInBackground();
  });

  syncQueue.recoverInterrupted().finally(() => {
    syncInBackground();
  });

  // Then process periodically
  syncInterval = setInterval(syncInBackground, intervalMs);
}

export function stopBackgroundSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  stopWatchingConnection?.();
  stopWatchingConnection = null;
}

// ── Sync status query ───────────────────────────────────────────────────────

export async function getSyncStatus(): Promise<{
  pending: number;
  failed: number;
  dead: number;
  isSyncing: boolean;
  needsSignIn: boolean;
}> {
  const queue = await syncQueue.getPending();
  const failed = queue.filter((i) => i.status === "failed").length;
  const dead = queue.filter((i) => i.status === "dead").length;
  return {
    pending: Math.max(0, queue.length - failed - dead),
    failed,
    dead,
    isSyncing,
    needsSignIn: needsSignIn && queue.length > 0,
  };
}
// ── Retry a specific failed item ────────────────────────────────────────────

export async function retryItem(id: string): Promise<boolean> {
  const item = await syncQueue.get(id);
  if (!item || (item.status !== "failed" && item.status !== "dead")) return false;
  item.status = "pending";
  item.attempts = 0;
  delete item.next_retry_at;
  await syncQueue.add(item);
  await processSyncQueue();
  return true;
}

/**
 * Put every exhausted item back in the queue with a fresh attempt budget.
 * Used by the sync bar's "Retry failed" after something the server rejected has
 * been corrected on this device.
 */
export async function retryDead(): Promise<number> {
  const dead = await syncQueue.getDead();
  for (const item of dead) {
    item.status = "pending";
    item.attempts = 0;
    delete item.next_retry_at;
    await syncQueue.add(item);
  }
  await processSyncQueue();
  return dead.length;
}
