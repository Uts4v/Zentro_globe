/**
 * Dedup keeps the same KOT/order from being read twice across polls or reloads.
 * Run with: npm run test:voice
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DedupStore } from "./dedup.ts";

const HOUR = 60 * 60 * 1000;

test("remembers keys and forgets them after the ttl", () => {
  let now = 1_000;
  const store = new DedupStore(() => now);
  store.add("order:o1:batch:k1");
  assert.equal(store.has("order:o1:batch:k1"), true);
  assert.equal(store.has("order:o1:batch:k2"), false);

  now += 25 * HOUR;
  assert.equal(store.has("order:o1:batch:k1"), false);
});

test("caps the number of entries", () => {
  const store = new DedupStore(() => 1_000);
  for (let i = 0; i < 700; i += 1) store.add(`k${i}`);
  assert.ok(store.size() <= 500);
  // The newest key survives the trim.
  assert.equal(store.has("k699"), true);
});
