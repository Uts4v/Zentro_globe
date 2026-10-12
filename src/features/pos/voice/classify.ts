/**
 * The single decision point for "should this terminal speak?".
 *
 * Kept pure and standalone so the answer is testable and so no other module has
 * to repeat the source/actor rules. Only sources listed here are treated as
 * remote; anything added to the backend later stays silent until deliberately
 * listed, which is the safe default (staff never want their own entries read
 * back to them).
 */

import type { VoiceSettings } from "./settings";
import type { Actor, AnnounceContext, OrderEvent } from "./types";

/** Order sources produced by the customer, off-terminal. */
export const REMOTE_SOURCES = new Set(["customer_app", "table_qr"]);

export function isRemoteSource(source: string): boolean {
  return REMOTE_SOURCES.has(source);
}

/**
 * A change made on this terminal is `local_staff` even when, on the wire, it
 * looks remote — e.g. staff adding an item to a table-QR order.
 */
export function classifyActor(source: string, locallySuppressed: boolean): Actor {
  if (locallySuppressed) return "local_staff";
  return isRemoteSource(source) ? "customer_remote" : "local_staff";
}

/**
 * Yes/no for one normalized event. `ctx.localBatchKeys` holds the batches this
 * terminal itself created, so the terminal that entered an add-on stays silent
 * while a different terminal may still announce it.
 */
export function shouldAnnounceOrder(
  event: Pick<OrderEvent, "kind" | "source" | "batchKey">,
  settings: VoiceSettings,
  ctx: AnnounceContext,
): boolean {
  if (!settings.enabled) return false;

  const actor = classifyActor(event.source, ctx.localBatchKeys.has(event.batchKey));
  if (actor !== "customer_remote") return false;

  return event.kind === "initial" ? settings.announceNewOrders : settings.announceAddOnOrders;
}
