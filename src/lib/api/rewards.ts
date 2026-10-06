import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { Reward, Redemption, LoyaltyRules } from "./types";

/** What the merchant sees after confirming a customer's points redemption. */
export interface RewardConfirmation {
  success: boolean;
  customer_name: string;
  reward_name: string;
  points_spent: number;
  code: string;
}

export const rewardApi = {
  list: async (merchantId?: string): Promise<Reward[]> => {
    const qs = merchantId ? `?merchant=${merchantId}` : "";
    return djangoFetch<Reward[]>(apiUrl(`/loyalty/rewards/${qs}`));
  },

  redeem: async (rewardId: string): Promise<Redemption> => {
    return djangoFetch<Redemption>(apiUrl(`/loyalty/rewards/${rewardId}/redeem/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
  },
};

export const loyaltyApi = {
  getRules: async (): Promise<LoyaltyRules> => {
    return djangoFetch<LoyaltyRules>(apiUrl("/loyalty/rules/"), {
      headers: authHeaders(),
    });
  },

  saveRules: async (
    input: Pick<
      LoyaltyRules,
      | "points_per_npr"
      | "streak_multiplier"
      | "welcome_bonus"
      | "birthday_bonus"
      | "streak_min_amount"
    >,
  ): Promise<LoyaltyRules> => {
    return djangoFetch<LoyaltyRules>(apiUrl("/loyalty/rules/"), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  getRewards: async (): Promise<Reward[]> => {
    return djangoFetch<Reward[]>(apiUrl("/loyalty/rewards/merchant/"), {
      headers: authHeaders(),
    });
  },

  createReward: async (
    input: Omit<Reward, "id" | "merchant_id" | "created_at" | "linked_menu_item_name">,
  ): Promise<Reward> => {
    return djangoFetch<Reward>(apiUrl("/loyalty/rewards/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  updateReward: async (id: string, input: Partial<Reward>): Promise<Reward> => {
    return djangoFetch<Reward>(apiUrl(`/loyalty/rewards/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  deleteReward: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/loyalty/rewards/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  confirmRedemption: async (code: string): Promise<RewardConfirmation> => {
    const data = await djangoFetch<Partial<RewardConfirmation> & { reward_name?: string }>(
      apiUrl("/loyalty/redemptions/confirm/"),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({ code }),
      },
    );
    // The server returns every field a confirmation receipt needs. Passing them
    // all through used to throw away the reward name and the code itself,
    // which left the merchant reading "Customer spent 50 points" and having to
    // work out what they had just handed over.
    return {
      success: true,
      customer_name: data.customer_name ?? "Customer",
      reward_name: data.reward_name ?? "",
      points_spent: data.points_spent ?? 0,
      code: data.code ?? code.trim().toUpperCase(),
    };
  },

  getRedemptions: async (): Promise<Redemption[]> => {
    return djangoFetch<Redemption[]>(apiUrl("/loyalty/redemptions/merchant/"), {
      headers: authHeaders(),
    });
  },
};
