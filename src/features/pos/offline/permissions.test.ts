/**
 * The offline allowlist decides what a cashier can still reach with no
 * connection, so it needs to hold for every POS route — including the ones
 * that only look like they are under an allowed prefix.
 * Run with: npm run test:offline-permissions
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPosPathOfflineSafe, POS_NAV_SECTIONS } from "./permissions.ts";

test("the two offline-capable screens are allowed", () => {
  assert.equal(isPosPathOfflineSafe("/pos"), true);
  assert.equal(isPosPathOfflineSafe("/pos/"), true);
  assert.equal(isPosPathOfflineSafe("/pos/orders"), true);
});

test("nested order screens stay allowed", () => {
  assert.equal(isPosPathOfflineSafe("/pos/orders/12"), true);
  assert.equal(isPosPathOfflineSafe("/pos/orders/12/lines"), true);
});

test("every other POS screen is blocked", () => {
  const blocked = [
    "/pos/preparation",
    "/pos/preparation/3",
    "/pos/conflicts",
    "/pos/accounts",
    "/pos/cash-movements",
    "/pos/reports",
    "/pos/reports/z-report",
    "/pos/schedule",
    "/pos/staff",
    "/pos/settings",
    "/merchant",
  ];
  for (const path of blocked) {
    assert.equal(isPosPathOfflineSafe(path), false, `${path} must not be reachable offline`);
  }
});

test("/pos is matched exactly, never as a prefix", () => {
  // The regression this guards: treating "/pos" as a prefix would allow every
  // POS screen, silently disabling the whole point of the allowlist.
  assert.equal(isPosPathOfflineSafe("/posreports"), false);
  assert.equal(isPosPathOfflineSafe("/pos/ordersandmore"), false);
});

test("only Order and Orders stay enabled in the sidebar when offline", () => {
  const offlineSafe = POS_NAV_SECTIONS.flatMap((s) => s.items)
    .filter((item) => isPosPathOfflineSafe(item.to))
    .map((item) => item.label)
    .sort();
  assert.deepEqual(offlineSafe, ["Order", "Orders"]);
});

test("every sidebar entry has a unique route", () => {
  const routes = POS_NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.to);
  assert.equal(new Set(routes).size, routes.length);
});