/**
 * Turns an `OrderEvent` into the sentence (or sentences) the voice reads.
 *
 * Deliberately pure: given the same event and settings it always produces the
 * same string, which is what the tests pin down. Speech order is:
 *   intro → table → customer → each item (qty, name, variant, add-ons) →
 *   item notes → order note last.
 */

import type { VoiceSettings } from "./settings";
import type { NormalizedLine, OrderEvent } from "./types";

/** Above this many order lines the voice summarizes instead of reading every line. */
export const SUMMARY_THRESHOLD = 6;

/** A single spoken note longer than this is replaced by a "check the KOT" line. */
export const MAX_NOTE_CHARS = 180;

export const TRUNCATED_NOTE_PHRASE = "Special instructions are included. Please check the KOT.";

export function firstName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

/** Collapse whitespace, drop control characters and strip URLs before speaking. */
export function cleanNote(text: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const withoutControl = (text ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ");
  return withoutControl
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A speakable note, or a generic instruction when the note is too long. */
export function notePhrase(text: string | null | undefined): string | null {
  const clean = cleanNote(text);
  if (!clean) return null;
  if (clean.length > MAX_NOTE_CHARS) return TRUNCATED_NOTE_PHRASE;
  return `Note: ${clean}`;
}

function describeTable(event: OrderEvent): string | null {
  if (event.tableNumber != null) return `Table ${event.tableNumber}.`;
  if (event.tableName) return `${event.tableName}.`;
  return null;
}

function describeLine(line: NormalizedLine, settings: VoiceSettings): string {
  const quantity = line.quantity || 1;
  let text = `${quantity} ${line.name}`;
  if (settings.includeVariants && line.variant.length > 0) {
    text += `, ${line.variant.join(", ")}`;
  }
  if (settings.includeModifiers && line.addOns.length > 0) {
    text += ` with ${line.addOns.join(", ")}`;
  }
  return `${text}.`;
}

function dedupeConsecutive(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (out.length > 0 && out[out.length - 1] === part) continue;
    out.push(part);
  }
  return out;
}

export function buildAnnouncement(event: OrderEvent, settings: VoiceSettings): string {
  const parts: string[] = [event.kind === "initial" ? "New order." : "New items added."];

  const table = describeTable(event);
  if (table) parts.push(table);

  if (settings.includeCustomerName) {
    const name = firstName(event.customerName);
    if (name) parts.push(`For ${name}.`);
  }

  const lines = event.lines.filter((line) => line.name);
  const lineCount = lines.length;
  const totalQuantity = lines.reduce((sum, line) => sum + (line.quantity || 1), 0);

  if (lineCount > 0 && lineCount <= SUMMARY_THRESHOLD) {
    for (const line of lines) {
      parts.push(describeLine(line, settings));
      if (settings.includeNotes) {
        const phrase = notePhrase(line.special_instructions);
        if (phrase) parts.push(phrase);
      }
    }
  } else if (lineCount > SUMMARY_THRESHOLD) {
    parts.push(
      `There are ${totalQuantity} items across ${lineCount} order lines. Please check the KOT.`,
    );
    if (settings.includeNotes) {
      for (const line of lines) {
        const phrase = notePhrase(line.special_instructions);
        if (phrase) parts.push(phrase);
      }
    }
  }

  // The order-level note is always read last, after any item notes.
  if (settings.includeNotes) {
    const orderNote = notePhrase(event.notes);
    if (orderNote) parts.push(orderNote);
  }

  return dedupeConsecutive(parts).join(" ");
}
