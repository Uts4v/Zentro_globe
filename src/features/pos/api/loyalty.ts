/**
 * Loyalty redemption from a POS terminal.
 *
 * An employee working a till is not signed in to the merchant dashboard, so
 * these are the routes they can actually reach. They mirror the dashboard
 * confirmations and go through the same server-side rules; the only thing that
 * differs is that the acting employee is named explicitly so the POS audit log
 * records who handed the reward over.
 *
 * Nothing here is queued for offline replay. A redemption gives something away
 * for free, so it needs the server's answer before it happens: an offline till
 * can still take orders, but cannot confirm a reward.
 */

import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { posAuthHeaders } from "../offline/pos-auth";

function headers(): Record<string, string> {
  return {
    ...posAuthHeaders(),
    "Content-Type": "application/json",
  };
}

export interface PunchCardRedemptionResult {
  success: boolean;
  customer_name: string;
  reward_text: string;
  order_id: number;
  new_card_started: boolean;
}

export interface RewardRedemptionResult {
  success: boolean;
  customer_name: string;
  reward_name: string;
  points_spent: number;
  code: string;
}

export interface PosPointTransaction {
  id: string;
  customer_id: string;
  customer_name: string;
  transaction_type: string;
  points: number;
  balance_before: number;
  balance_after: number;
  description?: string;
  created_at: string;
}

/** Confirm a customer's completed punch card from their proof code. */
export const posConfirmPunchCard = (proofCode: string, workerId: string) =>
  djangoFetch<PunchCardRedemptionResult>(apiUrl("/pos/loyalty/punch-cards/confirm/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ proof_code: proofCode.trim().toUpperCase(), worker_id: workerId }),
  });

/** Confirm a points redemption the customer already paid for in the app. */
export const posConfirmReward = (code: string, workerId: string) =>
  djangoFetch<RewardRedemptionResult>(apiUrl("/pos/loyalty/rewards/confirm/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ code: code.trim().toUpperCase(), worker_id: workerId }),
  });

/** Recent point activity, so staff can answer "what did they just spend?". */
export const posLoyaltyTransactions = (limit = 25) =>
  djangoFetch<PosPointTransaction[]>(apiUrl(`/pos/loyalty/transactions/?limit=${limit}`), {
    headers: headers(),
  });
