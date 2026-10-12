/**
 * The single source of live order data for the POS terminal.
 *
 * One 5s poll feeds both the Incoming Orders panel and the voice announcer, so
 * there is no second request loop competing with the first. It uses the paged
 * order endpoint because that path already prefetches `kots` and item options —
 * exactly the data an announcement needs — without an extra backend round-trip.
 *
 * The feed owns the "first load" rule: whatever is already on the server when a
 * terminal starts is remembered silently, and only orders/KOTs that appear
 * afterwards are emitted as events.
 */

import { posListOrdersPaged, type PosOrder } from "../api";
import { cachedServerOrders } from "../offline/db";
import { usePosStore } from "../store";
import { orderEventFromKot, orderEventFromOrder, orderKots } from "../voice/normalize";
import type { OrderEvent } from "../voice/types";

const POLL_INTERVAL_MS = 5000;
const PAGE_SIZE = 30;
/** Cap on remembered ids so a very long shift cannot grow memory without bound. */
const SEEN_LIMIT = 800;

export type PosOrderListener = (events: OrderEvent[]) => void;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let firstLoadDone = false;
const listeners = new Set<PosOrderListener>();
const seenOrders = new Set<string>();
const seenKots = new Set<string>();

function trim(set: Set<string>): void {
  if (set.size <= SEEN_LIMIT) return;
  const keep = Array.from(set).slice(set.size - SEEN_LIMIT);
  set.clear();
  for (const key of keep) set.add(key);
}

function kotUuid(order: PosOrder, kot: ReturnType<typeof orderKots>[number]): string {
  return kot.uuid || `kot:${kot.kot_number}`;
}

function isIncoming(order: PosOrder): boolean {
  return (
    ["customer_app", "table_qr"].includes(order.source) &&
    ["pending", "confirmed"].includes(order.status)
  );
}

function remember(order: PosOrder): void {
  seenOrders.add(order.uuid);
  for (const kot of orderKots(order)) seenKots.add(kot.uuid || `kot:${kot.kot_number}`);
}

async function poll(): Promise<void> {
  if (inFlight) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  inFlight = true;
  try {
    const page = await posListOrdersPaged(1, PAGE_SIZE);
    const results = page.results ?? [];

    // Keep the offline copy current even if nobody opens the Orders screen.
    cachedServerOrders.save(results);
    usePosStore.getState().setIncomingOrders(results.filter(isIncoming));

    if (!firstLoadDone) {
      // Never read out the backlog a terminal discovers on its first poll.
      results.forEach(remember);
      firstLoadDone = true;
      return;
    }

    const events: OrderEvent[] = [];
    for (const order of results) {
      const kots = orderKots(order);
      if (!seenOrders.has(order.uuid)) {
        seenOrders.add(order.uuid);
        if (isIncoming(order)) events.push(orderEventFromOrder(order));
      } else {
        for (const kot of kots) {
          if (seenKots.has(kotUuid(order, kot))) continue;
          events.push(orderEventFromKot(order, kot));
        }
      }
      for (const kot of kots) seenKots.add(kotUuid(order, kot));
    }

    trim(seenOrders);
    trim(seenKots);

    for (const listener of listeners) {
      try {
        listener(events);
      } catch {
        // A misbehaving listener must never stop the feed.
      }
    }
  } catch {
    // Offline or unreachable — keep the last data and retry on the next tick.
  } finally {
    inFlight = false;
  }
}

/** Subscribe to new order/KOT events. Starts the poll on the first subscriber. */
export function subscribePosOrderFeed(listener: PosOrderListener): () => void {
  listeners.add(listener);
  if (!timer) {
    void poll();
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Force an immediate poll (the panel's refresh button). Resolves when done. */
export function refreshPosOrderFeed(): Promise<void> {
  return poll();
}
