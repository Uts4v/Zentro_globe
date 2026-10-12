/**
 * The announce decision is the heart of the feature: remote customer/table-QR
 * changes speak, everything local stays quiet.
 * Run with: npm run test:voice
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyActor, isRemoteSource, shouldAnnounceOrder } from "./classify.ts";
import type { VoiceSettings } from "./settings";

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

const ctx = { localBatchKeys: new Set<string>() };

test("remote sources are recognized", () => {
  assert.equal(isRemoteSource("customer_app"), true);
  assert.equal(isRemoteSource("table_qr"), true);
  assert.equal(isRemoteSource("pos"), false);
  assert.equal(isRemoteSource("pos_online"), false);
  assert.equal(isRemoteSource("pos_offline"), false);
  assert.equal(isRemoteSource("merchant_dashboard"), false);
});

test("actor is customer_remote only for remote, unsuppressed events", () => {
  assert.equal(classifyActor("customer_app", false), "customer_remote");
  assert.equal(classifyActor("table_qr", false), "customer_remote");
  assert.equal(classifyActor("pos", false), "local_staff");
  assert.equal(classifyActor("customer_app", true), "local_staff");
});

test("new remote orders announce", () => {
  assert.equal(
    shouldAnnounceOrder({ kind: "initial", source: "customer_app", batchKey: "k" }, settings, ctx),
    true,
  );
});

test("local staff orders never announce", () => {
  for (const source of ["pos", "pos_online", "pos_offline", "merchant_dashboard"]) {
    assert.equal(
      shouldAnnounceOrder({ kind: "initial", source, batchKey: "k" }, settings, ctx),
      false,
      `${source} initial`,
    );
    assert.equal(
      shouldAnnounceOrder({ kind: "batch", source, batchKey: "k" }, settings, ctx),
      false,
      `${source} batch`,
    );
  }
});

test("a remote add-on entered on this terminal is suppressed", () => {
  const local = { localBatchKeys: new Set(["order:o1:batch:k1"]) };
  assert.equal(
    shouldAnnounceOrder(
      { kind: "batch", source: "customer_app", batchKey: "order:o1:batch:k1" },
      settings,
      local,
    ),
    false,
  );
  // A different batch on the same order is still announced.
  assert.equal(
    shouldAnnounceOrder(
      { kind: "batch", source: "customer_app", batchKey: "order:o1:batch:k2" },
      settings,
      local,
    ),
    true,
  );
});

test("disabled voice announces nothing", () => {
  assert.equal(
    shouldAnnounceOrder(
      { kind: "initial", source: "customer_app", batchKey: "k" },
      { ...settings, enabled: false },
      ctx,
    ),
    false,
  );
});

test("per-kind toggles apply", () => {
  assert.equal(
    shouldAnnounceOrder(
      { kind: "initial", source: "customer_app", batchKey: "k" },
      { ...settings, announceNewOrders: false },
      ctx,
    ),
    false,
  );
  assert.equal(
    shouldAnnounceOrder(
      { kind: "batch", source: "customer_app", batchKey: "k" },
      { ...settings, announceAddOnOrders: false },
      ctx,
    ),
    false,
  );
});
