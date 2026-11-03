/**
 * Split tender keeps the order total intact and only gives change from cash.
 * Run with: npm run test:split-payment
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSplitPaymentLegs,
  emptySplitPaymentState,
  evaluateSplitPayment,
  type SplitPaymentState,
} from "./split-payment.ts";

const state = (patch: Partial<SplitPaymentState> = {}): SplitPaymentState => ({
  ...emptySplitPaymentState(),
  qrAmount: "400",
  cashReceived: "600",
  qrConfirmed: true,
  ...patch,
});

test("splits the total into QR and cash legs", () => {
  const result = evaluateSplitPayment(1000, state());
  assert.equal(result.qrPortion, 400);
  assert.equal(result.cashPortion, 600);
  assert.equal(result.change, 0);
  assert.equal(result.error, null);
});

test("change comes only from cash overpayment", () => {
  const result = evaluateSplitPayment(1000, state({ cashReceived: "650" }));
  assert.equal(result.cashPortion, 600);
  assert.equal(result.change, 50);
  assert.equal(result.error, null);
});

test("QR must be less than the total so both legs exist", () => {
  assert.match(
    evaluateSplitPayment(1000, state({ qrAmount: "1000" })).error ?? "",
    /less than the total/,
  );
});

test("cash received must cover the cash portion", () => {
  assert.match(
    evaluateSplitPayment(1000, state({ cashReceived: "500" })).error ?? "",
    /cover the remaining cash portion/,
  );
});

test("QR has to be confirmed", () => {
  assert.match(
    evaluateSplitPayment(1000, state({ qrConfirmed: false })).error ?? "",
    /scanned the QR/,
  );
});

test("legs carry net amounts, references and per-leg mutation ids", () => {
  const legs = buildSplitPaymentLegs(
    1000,
    state({ cashReceived: "650", reference: " TXN-9 " }),
    "bank_qr",
    { qrMutationId: "qr-id", cashMutationId: "cash-id" },
  );

  assert.equal(legs.change_amount, 50);
  assert.deepEqual(legs.payments, [
    {
      payment_method: "bank_qr",
      amount: 400,
      external_reference: "TXN-9",
      client_mutation_id: "qr-id",
    },
    {
      payment_method: "cash",
      amount: 600,
      client_mutation_id: "cash-id",
    },
  ]);
});

test("invalid splits cannot build a payload", () => {
  assert.throws(
    () =>
      buildSplitPaymentLegs(1000, state({ cashReceived: "1" }), "bank_qr", {
        qrMutationId: "qr-id",
        cashMutationId: "cash-id",
      }),
    /cash portion/,
  );
});
