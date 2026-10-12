/**
 * Speech text must be predictable, ordered (order note last) and safe against
 * very long notes and very large orders.
 * Run with: npm run test:voice
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAnnouncement,
  cleanNote,
  firstName,
  notePhrase,
  MAX_NOTE_CHARS,
  TRUNCATED_NOTE_PHRASE,
} from "./announcement.ts";
import type { VoiceSettings } from "./settings";
import type { NormalizedLine, OrderEvent } from "./types";

const settings: VoiceSettings = {
  enabled: true,
  announceNewOrders: true,
  announceAddOnOrders: true,
  includeCustomerName: true,
  includeVariants: true,
  includeModifiers: true,
  includeNotes: true,
  voiceURI: "",
  volume: 0.8,
};

function line(overrides: Partial<NormalizedLine> = {}): NormalizedLine {
  return {
    name: "Pizza",
    quantity: 1,
    variant: [],
    addOns: [],
    special_instructions: "",
    ...overrides,
  };
}

function event(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    kind: "initial",
    orderUuid: "o1",
    batchUuid: "o1",
    batchKey: "order:o1:initial",
    source: "customer_app",
    tableNumber: 8,
    tableName: null,
    customerName: "Jane Doe",
    notes: "",
    lines: [line()],
    ...overrides,
  };
}

test("first name only", () => {
  assert.equal(firstName("Jane Doe"), "Jane");
  assert.equal(firstName("  Ana  Maria "), "Ana");
  assert.equal(firstName(null), "");
  assert.equal(firstName(""), "");
});

test("notes are cleaned of urls and control characters", () => {
  assert.equal(cleanNote("no  onions\nplease https://x.co/y"), "no onions please");
  assert.equal(cleanNote("   "), "");
});

test("over-long notes fall back to the check-the-KOT line", () => {
  const long = "a".repeat(MAX_NOTE_CHARS + 1);
  assert.equal(notePhrase(long), TRUNCATED_NOTE_PHRASE);
  assert.equal(notePhrase("no onions"), "Note: no onions");
  assert.equal(notePhrase(""), null);
});

test("spoken order is intro, table, customer, items, item note, order note last", () => {
  const text = buildAnnouncement(
    event({
      notes: "Ring the bell",
      lines: [line({ name: "Pizza", quantity: 2, special_instructions: "no onions" })],
    }),
    settings,
  );
  assert.ok(text.startsWith("New order. Table 8. For Jane."));
  assert.ok(text.includes("2 Pizza."));
  assert.ok(text.includes("Note: no onions"));
  assert.ok(text.endsWith("Note: Ring the bell"));
});

test("variant and add-ons are read in order", () => {
  const text = buildAnnouncement(
    event({ lines: [line({ variant: ["Large"], addOns: ["Extra cheese", "Olives"] })] }),
    settings,
  );
  assert.ok(text.includes("1 Pizza, Large with Extra cheese, Olives."));
});

test("include flags remove what they control", () => {
  const text = buildAnnouncement(
    event({
      lines: [line({ variant: ["Large"], addOns: ["Cheese"] })],
    }),
    { ...settings, includeCustomerName: false, includeVariants: false, includeModifiers: false },
  );
  assert.ok(!text.includes("Jane"));
  assert.ok(!text.includes("Large"));
  assert.ok(!text.includes("Cheese"));
});

test("large orders summarize but still read every special instruction", () => {
  const lines: NormalizedLine[] = [];
  for (let i = 0; i < 7; i += 1) {
    lines.push(line({ name: `Item ${i + 1}`, special_instructions: i === 3 ? "gluten free" : "" }));
  }
  const text = buildAnnouncement(event({ lines }), settings);
  assert.ok(text.includes("There are 7 items across 7 order lines."));
  assert.ok(text.includes("Please check the KOT."));
  assert.ok(text.includes("Note: gluten free"));
});
