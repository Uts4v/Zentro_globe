/**
 * Wires order events to the speech engine and is the only place that holds the
 * terminal's "already handled" state.
 *
 * Keeping this state here (rather than in the feed or the UI) means the rules
 * live in one spot: a remote initial order or add-on is spoken, a local one is
 * suppressed, and a batch this terminal created itself is remembered so the
 * next poll does not bounce it back as a remote add-on.
 */

import { playOrderChime } from "@/lib/audio";
import type { PosOrder } from "../api";
import { buildAnnouncement } from "./announcement";
import { isRemoteSource, shouldAnnounceOrder } from "./classify";
import { DedupStore } from "./dedup";
import { VoiceEngine } from "./engine";
import { batchBatchKey, initialBatchKey, newestKot } from "./normalize";
import { loadVoiceSettings, type VoiceSettings } from "./settings";
import type { AnnounceContext, OrderEvent } from "./types";

const dedup = new DedupStore();
const engine = new VoiceEngine();
const context: AnnounceContext = { localBatchKeys: new Set() };

export const TEST_ANNOUNCEMENT = "Voice announcements are ready. Table eight, two large pizzas.";

export function handleOrderEvents(events: OrderEvent[]): void {
  const settings = loadVoiceSettings();

  for (const event of events) {
    if (dedup.has(event.batchKey)) continue;

    const locallySuppressed = context.localBatchKeys.has(event.batchKey);
    const remote = isRemoteSource(event.source) && !locallySuppressed;

    if (shouldAnnounceOrder(event, settings, context)) {
      engine.enqueue({
        text: buildAnnouncement(event, settings),
        chime: true,
        volume: settings.volume,
        voiceURI: settings.voiceURI,
      });
      dedup.add(event.batchKey);
    } else if (remote && event.kind === "initial") {
      // The chime predates voice announcements; keep it for a new remote order
      // even when speech is switched off.
      playOrderChime(settings.volume);
      dedup.add(event.batchKey);
    } else if (remote) {
      // A remote add-on with speech off: remember it so we do not re-chime it.
      dedup.add(event.batchKey);
    }
  }
}

/**
 * Mark the newest batch on an order as entered on this terminal, so the next
 * poll treats it as local and never announces the staff member's own add-on.
 */
export function markLocalBatch(order: PosOrder): void {
  const kot = newestKot(order);
  const key = kot ? batchBatchKey(order.uuid, kot) : initialBatchKey(order.uuid);
  context.localBatchKeys.add(key);
  dedup.add(key);
}

export function testVoice(settings?: VoiceSettings): void {
  const active = settings ?? loadVoiceSettings();
  engine.speakNow(TEST_ANNOUNCEMENT, active.volume, active.voiceURI);
}

export function stopVoice(): void {
  engine.cancel();
}
