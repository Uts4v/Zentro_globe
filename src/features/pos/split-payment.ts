import type { PosSplitPaymentPayload } from "./api";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The cashier's inputs for a Cash + QR split. */
export interface SplitPaymentState {
  qrAmount: string;
  cashReceived: string;
  qrConfirmed: boolean;
  reference: string;
}

export interface SplitPaymentBreakdown {
  total: number;
  qrPortion: number;
  cashPortion: number;
  cashReceived: number;
  change: number;
  error: string | null;
}

export function emptySplitPaymentState(): SplitPaymentState {
  return { qrAmount: "", cashReceived: "", qrConfirmed: false, reference: "" };
}

/**
 * A split keeps the order total intact: the QR leg is entered by the cashier
 * and the cash leg is whatever is left. Change is only ever given from the
 * cash leg, never from the QR amount.
 */
export function evaluateSplitPayment(
  total: number,
  state: SplitPaymentState,
): SplitPaymentBreakdown {
  const safeTotal = roundMoney(Math.max(0, total));
  const qrPortion = roundMoney(Math.max(0, Number.parseFloat(state.qrAmount) || 0));
  const cashReceived = roundMoney(Math.max(0, Number.parseFloat(state.cashReceived) || 0));
  const cashPortion = roundMoney(Math.max(0, safeTotal - qrPortion));
  const change = roundMoney(Math.max(0, cashReceived - cashPortion));

  let error: string | null = null;
  if (safeTotal <= 0) {
    error = "There is nothing left to pay.";
  } else if (qrPortion <= 0) {
    error = "Enter the amount paid by QR.";
  } else if (qrPortion >= safeTotal) {
    error = "The QR portion must be less than the total; use QR Payment for a full QR sale.";
  } else if (cashReceived < cashPortion) {
    error = "Cash received must cover the remaining cash portion.";
  } else if (!state.qrConfirmed) {
    error = "Confirm that the customer has scanned the QR code.";
  }

  return { total: safeTotal, qrPortion, cashPortion, cashReceived, change, error };
}

interface SplitLegIds {
  qrMutationId: string;
  cashMutationId: string;
}

/**
 * Build the two net legs sent to the split endpoint. `change_amount` is the
 * change handed back from the cash leg, so it must never reduce the QR leg.
 */
export function buildSplitPaymentLegs(
  total: number,
  state: SplitPaymentState,
  qrMethod: string,
  ids: SplitLegIds,
): Pick<PosSplitPaymentPayload, "payments" | "change_amount"> {
  const breakdown = evaluateSplitPayment(total, state);
  if (breakdown.error) throw new Error(breakdown.error);

  const reference = state.reference.trim();
  return {
    payments: [
      {
        payment_method: qrMethod,
        amount: breakdown.qrPortion,
        external_reference: reference || undefined,
        client_mutation_id: ids.qrMutationId,
      },
      {
        payment_method: "cash",
        amount: breakdown.cashPortion,
        client_mutation_id: ids.cashMutationId,
      },
    ],
    change_amount: breakdown.change,
  };
}
