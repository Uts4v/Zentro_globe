/**
 * A staff-only till must be able to upload its offline work.
 *
 * A merchant signs their phone in with their own account. An employee signs
 * theirs in with a Staff Code + PIN and never sees those credentials — so a
 * sync engine that only knows how to send `Bearer <merchant JWT>` strands every
 * order a cashier takes while the connection is down: the queue waits for a
 * login that employee cannot perform.
 *
 * These tests pin the two decisions that decide whether a queued order ever
 * reaches the server: the headers a request carries, and whether this device is
 * allowed to send at all.
 *
 * Run with: npm run test:staff-only-sync
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { posAuthHeaders, posSessionState, type PosIdentity } from "./pos-auth-core.ts";

/** A staff session, shaped as `staff-session.ts` stores it. */
const STAFF = {
  token: "staff-token-abc",
  name: "Asha",
  role: "Cashier",
  workerId: "w-1",
  staffCode: "2001",
  permissions: ["pos.access", "orders.create", "payments.take"],
};

/** A merchant access token that expires in an hour. */
function validAccessToken(secondsAhead = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + secondsAhead;
  const payload = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

/** A registered till, as stored after a successful sign-in. */
function device(): Pick<PosIdentity, "deviceId" | "deviceToken"> {
  return { deviceId: "dev-1", deviceToken: "dev-token" };
}

/** No merchant session and no employee: a browser that has never signed in. */
function noIdentity(): PosIdentity {
  return { access: null, refresh: null, staffToken: null, deviceId: null, deviceToken: null };
}

/**
 * Runs the gate with the given identity and a controllable refresh result.
 * The expiry check is passed in rather than imported so the test does not
 * depend on how `auth-tokens` reads a JWT.
 */
async function sessionState(
  identity: PosIdentity,
  refreshResult: "refreshed" | "rejected" | "unreachable" = "rejected",
) {
  let refreshCalls = 0;
  const state = await posSessionState({
    read: () => identity,
    secondsUntilExpiry: (token) =>
      Number(JSON.parse(Buffer.from(token.split(".")[1], "base64").toString()).exp) -
      Math.floor(Date.now() / 1000),
    refresh: async () => {
      refreshCalls++;
      return refreshResult;
    },
  });
  return { state, refreshCalls };
}

test("a staff-only till authenticates with the staff token", () => {
  const headers = posAuthHeaders(() => ({
    access: null,
    refresh: null,
    staffToken: STAFF.token,
    ...device(),
  }));

  assert.equal(headers.Authorization, "Staff staff-token-abc");
  // Without this header the server attributes the order to the merchant owner,
  // which is the audit trail a shop disputes on.
  assert.equal(headers["X-Zentro-Staff"], "staff-token-abc");
});

test("the registered device is always identified", () => {
  const headers = posAuthHeaders(() => ({
    access: null,
    refresh: null,
    staffToken: STAFF.token,
    ...device(),
  }));

  assert.equal(headers["X-Pos-Device-Id"], "dev-1");
  assert.equal(headers["X-Pos-Device-Token"], "dev-token");
});

test("a merchant session wins over the staff token when both exist", () => {
  const access = validAccessToken();
  const headers = posAuthHeaders(() => ({
    access,
    refresh: "refresh",
    staffToken: STAFF.token,
    ...device(),
  }));

  assert.equal(headers.Authorization, `Bearer ${access}`);
  // Still attributed to the employee actually working the till.
  assert.equal(headers["X-Zentro-Staff"], STAFF.token);
});

test("no credentials yields no Authorization header, not a broken one", () => {
  const headers = posAuthHeaders(noIdentity);

  assert.equal("Authorization" in headers, false);
  assert.equal(headers["Content-Type"], "application/json");
});

test("a signed-in employee may sync — the bug this file guards", async () => {
  // No merchant access token, no refresh token. This used to answer
  // "signed_out", leaving the queue in IndexedDB until a merchant logged in on
  // this exact browser profile.
  const { state, refreshCalls } = await sessionState({
    access: null,
    refresh: null,
    staffToken: STAFF.token,
    ...device(),
  });

  assert.equal(state, "ok");
  assert.equal(refreshCalls, 0, "a staff session needs no token refresh");
});

test("a staff session is enough even with a stale merchant token present", async () => {
  const { state } = await sessionState({
    access: validAccessToken(-60),
    refresh: "refresh",
    staffToken: STAFF.token,
    deviceId: null,
    deviceToken: null,
  });

  assert.equal(state, "ok");
});

test("a registered device with no session is not reported as signed out", async () => {
  // A till registered by an earlier login, opened by whoever holds the phone.
  // Refreshing is impossible and pointless; the device is authorised on its
  // own, so this must not block the queue.
  const { state } = await sessionState({
    access: null,
    refresh: null,
    staffToken: null,
    ...device(),
  });

  assert.equal(state, "ok");
});

test("a device with no identity at all waits for a sign-in", async () => {
  const { state } = await sessionState(noIdentity());

  assert.equal(state, "signed_out");
});

test("a valid merchant token needs no refresh at all", async () => {
  const { state, refreshCalls } = await sessionState({
    access: validAccessToken(),
    refresh: "refresh",
    staffToken: null,
    ...device(),
  });

  assert.equal(state, "ok");
  assert.equal(refreshCalls, 0);
});

test("an unreachable server is reported as offline, not signed out", async () => {
  const { state } = await sessionState(
    { access: validAccessToken(-60), refresh: "refresh", staffToken: null, ...device() },
    "unreachable",
  );

  assert.equal(state, "offline");
});

test("a genuinely rejected merchant session is still signed out", async () => {
  const { state } = await sessionState(
    { access: validAccessToken(-60), refresh: "refresh", staffToken: null, ...device() },
    "rejected",
  );

  assert.equal(state, "signed_out");
});
