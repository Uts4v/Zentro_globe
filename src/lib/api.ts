/**
 * src/lib/api.ts
 *
 * All API calls to the Django backend.
 * Drop-in replacement for the Supabase version — same function signatures,
 * same return types, just backed by Django REST instead of Supabase.
 */

import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

// ── Types (kept identical to Supabase version for compatibility) ──────────────

export interface TodaySpecial {
  id: string;
  title: string;
  description: string;
  image_url: string;
  linked_menu_item: number | null;
  linked_menu_item_name: string | null;
  linked_reward: string | null;
  linked_reward_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export interface MerchantDiscoveryItem {
  id: string;
  business_name: string;
  slug: string;
  business_type: string | null;
  address: string | null;
  logo_url: string | null;
  is_open: boolean;
  latitude: string | null;
  longitude: string | null;
  distance_km: number | null;
}

export const specialApi = {
  // Customer — public, no auth needed
  forSlug: async (slug: string): Promise<TodaySpecial | null> => {
    const data = await djangoFetch<TodaySpecial | null>(apiUrl(`/loyalty/specials/${slug}/`));
    return data ?? null;
  },

  // Merchant
  list: async (): Promise<TodaySpecial[]> => {
    return djangoFetch<TodaySpecial[]>(apiUrl("/loyalty/merchant/specials/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Partial<TodaySpecial>): Promise<TodaySpecial> => {
    return djangoFetch<TodaySpecial>(apiUrl("/loyalty/merchant/specials/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<TodaySpecial>): Promise<TodaySpecial> => {
    return djangoFetch<TodaySpecial>(apiUrl(`/loyalty/merchant/specials/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/loyalty/merchant/specials/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};

export interface MenuItem {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  price: string;
  image_url: string;
  category: string;
  is_available: boolean;
  is_featured: boolean;
  loyalty_reward: boolean;
  points_per_item: number;
  emoji: string;
  created_at: string;
  updated_at: string;
}

export type MenuItemInput = Omit<MenuItem, "id" | "merchant_id" | "created_at" | "updated_at">;

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  name: string;
  price: string;
  quantity: number;
  subtotal: string;
}
// ── Notifications ─────────────────────────────────────────────────────────────
export interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  merchant_name: string;
  context_url: string;
  order_id: number | null;
  merchant_id: number | null;
  reward_id: number | null;
  is_read: boolean;
  created_at: string;
}

export const notificationApi = {
  list: async (): Promise<Notification[]> => {
    return djangoFetch<Notification[]>(apiUrl("/notifications/"), {
      headers: authHeaders(),
    });
  },

  markRead: async (id: string): Promise<void> => {
    await djangoFetch(apiUrl(`/notifications/${id}/read/`), {
      method: "PATCH",
      headers: authHeaders(),
    });
  },

  markAllRead: async (): Promise<void> => {
    await djangoFetch(apiUrl("/notifications/read-all/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
  },

  clearAll: async (): Promise<void> => {
    await djangoFetch(apiUrl("/notifications/clear/"), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  unreadCount: async (): Promise<{ unread_count: number }> => {
    return djangoFetch<{ unread_count: number }>(apiUrl("/notifications/unread-count/"), {
      headers: authHeaders(),
    });
  },
};
export interface JoinedMerchant {
  merchant_id: number;
  merchant_slug: string;
  business_name: string;
  logo_url: string;
  is_open: boolean;
  points_balance: number;
  tier_level: string;
  active_rewards_count: number;
  pending_orders_count: number;
  joined_at: string;
}
export interface Order {
  id: string;
  order_type?: "regular" | "punch_card_redemption" | "reward_redemption";
  fulfillment_type?: FulfillmentType;
  cancellation_reason?: string;
  cancelled_by?: string;
  customer_id: string;
  merchant_id: string;
  status: OrderStatus;
  total_amount: string;
  points_earned: number;
  notes: string;
  table_id?: number | null;
  table_name_snapshot?: string;
  table_number_snapshot?: number | null;
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
  profiles?: { full_name: string | null };
  merchant_profiles?: { business_name: string };
  // Django-side aliases (normalised below)
  items?: OrderItem[];
  customer_name?: string;
  merchant_name?: string;
}

export interface CreateOrderPayload {
  merchant_id: string;
  items: {
    menu_item_id: string;
    quantity: number;
    name: string;
    price: number;
    points_per_item: number;
  }[];
  notes?: string;
  fulfillment_type?: FulfillmentType;
  table_token?: string;
}
export interface MerchantProfile {
  id: string;
  user_id?: string;
  business_name: string;
  slug: string | null;
  business_type: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  banner_url: string | null;
  description: string | null;
  is_approved: boolean;
  is_open: boolean;
  onboarding_complete?: boolean;
  latitude?: string | null;
  longitude?: string | null;
  qr_code?: string;
  store_theme_color?: string;
  card_text_color?: string;
  card_background_image?: string;
  table_ordering_enabled?: boolean;
  allow_pickup?: boolean;
  allow_delivery?: boolean;
  allow_dine_in?: boolean;
}

export interface MerchantTable {
  id: number;
  name: string;
  table_number: number;
  public_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TableResolution {
  merchant: {
    id: number;
    name: string;
    slug: string;
    logo: string | null;
  };
  table: {
    id: number;
    name: string;
    table_number: number;
    public_token: string;
  };
}

export type FulfillmentType = "dine_in" | "pickup" | "delivery";
export interface MerchantPunchCard {
  id: string;
  merchant_id: string;
  name: string;
  mode: "per_order" | "per_streak";
  stamps_required: number;
  reward_text: string;
  background_image?: string;
  animated_gif_background?: string;
  color_scheme?: string;
  stamp_icon?: string;
  stamp_gif_url?: string;
  logo?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerPunchCard {
  id: string;
  customer_id: string;
  punch_card?: MerchantPunchCard;
  merchant_id: string;
  merchant_name: string;
  current_stamps: number;
  is_completed: boolean;
  completed_at?: string;
  is_redeemed: boolean;
  redeemed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PointTransaction {
  id: string;
  merchant_id: string;
  merchant_name: string;
  customer_id: string;
  customer_name: string;
  transaction_type: string;
  points: number;
  balance_before: number;
  balance_after: number;
  expiry_date?: string;
  status: string;
  description?: string;
  created_at: string;
}

export interface CustomerProfile {
  id: string;
  full_name: string | null;
  loyalty_points: number;
  streak_days: number;
  tier: string;
  total_orders: number;
  last_streak_at?: string | null;
  streak_free_earned?: boolean;
  transfer_code?: string;
}

export interface CustomerMerchantWallet {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  points_balance: number;
  lifetime_points: number;
  expired_points: number;
  order_count: number;
  streak_days: number;
  last_order_date: string | null;
  last_point_earned_at: string | null;
  tier_level: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerMerchantProfile {
  id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_slug: string;
  joined_at: string;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

export interface Mission {
  id: string;
  merchant_id: string;
  title: string;
  description: string;
  icon: string;
  target_count: number;
  reward_points: number;
  mission_type:
    | "order_count"
    | "spend_amount"
    | "visit_streak"
    | "purchase"
    | "visit"
    | "referral"
    | "special";
  is_active: boolean;
  restart_interval: "never" | "daily" | "weekly" | "monthly";
  linked_menu_item: number | null;
  linked_menu_item_name: string | null;
  created_at: string;
}

export interface MissionView {
  id: string;
  title: string;
  description: string;
  icon: string;
  target_count: number;
  current_count: number;
  reward_points: number;
  is_completed: boolean;
  mission_type: string;
  linked_menu_item_name: string | null;
}

export interface Reward {
  id: string;
  merchant_id: string;
  name: string;
  description: string;
  emoji: string;
  points_cost: number;
  stock: number;
  is_active: boolean;
  linked_menu_item: number | null;
  linked_menu_item_name: string | null;
  created_at: string;
}

export interface Redemption {
  id: string;
  customer_id: string;
  reward_id: string;
  points_spent: number;
  code: string;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  expires_at: string;
  confirmed_at: string | null;
  created_at: string;
}

export interface LoyaltyRules {
  id: string;
  merchant_id: string;
  points_per_npr: number;
  streak_multiplier: number;
  welcome_bonus: number;
  birthday_bonus: number;
  streak_min_amount: number;
  updated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a Django Order response into the shape the frontend expects. */
function normaliseOrder(o: any): Order {
  const items = (o.items ?? o.order_items ?? []).map((item: any) => ({
    ...item,
    id: String(item.id ?? ""),
    order_id: String(item.order_id ?? o.id ?? ""),
    menu_item_id: String(item.menu_item_id ?? item.menu_item ?? ""),
  }));

  return {
    ...o,
    id: String(o.id),
    customer_id: String(o.customer_id ?? o.customer ?? ""),
    merchant_id: String(o.merchant_id ?? o.merchant ?? ""),
    fulfillment_type: o.fulfillment_type ?? "pickup",
    table_id: o.table_id ?? o.table ?? null,
    table_name_snapshot: o.table_name_snapshot ?? "",
    table_number_snapshot: o.table_number_snapshot ?? null,
    order_items: items,
    profiles: { full_name: o.customer_name ?? null },
    merchant_profiles: { business_name: o.merchant_name ?? "" },
  };
}

// ── Menu Items ────────────────────────────────────────────────────────────────

export const menuApi = {
  myItems: async (): Promise<MenuItem[]> => {
    return djangoFetch<MenuItem[]>(apiUrl("/merchants/menu-items/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Partial<MenuItemInput>): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl("/merchants/menu-items/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<MenuItemInput>): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl(`/merchants/menu-items/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/merchants/menu-items/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  toggleAvailability: async (id: string): Promise<MenuItem> => {
    return djangoFetch<MenuItem>(apiUrl(`/merchants/menu-items/${id}/toggle-availability/`), {
      method: "PATCH",
      headers: authHeaders(),
    });
  },

  forMerchant: async (merchantId: string): Promise<MenuItem[]> => {
    return djangoFetch<MenuItem[]>(apiUrl(`/merchants/${merchantId}/menu/`));
  },
};

// ── Orders ────────────────────────────────────────────────────────────────────

export const orderApi = {
  cancelByMerchant: async (id: string, reason: string): Promise<Order> => {
    const data = await djangoFetch<any>(apiUrl(`/orders/${id}/cancel/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({ reason }),
    });
    return normaliseOrder(data);
  },
  myOrders: async (): Promise<Order[]> => {
    const data = await djangoFetch<any[]>(apiUrl("/orders/my-orders/"), {
      headers: authHeaders(),
    });
    return data.map(normaliseOrder);
  },

  storeOrders: async (filterStatus?: string): Promise<Order[]> => {
    const qs = filterStatus ? `?status=${filterStatus}` : "";
    const data = await djangoFetch<any[]>(apiUrl(`/orders/store-orders/${qs}`), {
      headers: authHeaders(),
    });
    return data.map(normaliseOrder);
  },

  create: async (payload: CreateOrderPayload): Promise<Order> => {
    // Django create-order body uses integer IDs and simple items array
    const body = {
      merchant_id: payload.merchant_id,
      items: payload.items.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
      })),
      notes: payload.notes ?? "",
      fulfillment_type: payload.fulfillment_type ?? "pickup",
      table_token: payload.table_token ?? "",
    };
    const data = await djangoFetch<any>(apiUrl("/orders/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    });
    return normaliseOrder(data);
  },

  updateStatus: async (id: string, status: OrderStatus): Promise<Order> => {
    const data = await djangoFetch<any>(apiUrl(`/orders/${id}/update-status/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({ status }),
    });
    return normaliseOrder(data);
  },

  cancel: async (id: string): Promise<Order> => {
    const data = await djangoFetch<any>(apiUrl(`/orders/${id}/cancel/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
    return normaliseOrder(data);
  },

  get: async (id: string): Promise<Order> => {
    const data = await djangoFetch<any>(apiUrl(`/orders/${id}/`), {
      headers: authHeaders(),
    });
    return normaliseOrder(data);
  },

  merchantHistory: async (params?: {
    search?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }): Promise<Order[]> => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.status) qs.set("status", params.status);
    if (params?.date_from) qs.set("date_from", params.date_from);
    if (params?.date_to) qs.set("date_to", params.date_to);
    const query = qs.toString();
    const data = await djangoFetch<any[]>(
      apiUrl(`/orders/merchant-history/${query ? `?${query}` : ""}`),
      { headers: authHeaders() },
    );
    return data.map(normaliseOrder);
  },
};

// ── Merchant Profile ──────────────────────────────────────────────────────────

export const merchantApi = {
  me: async (): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl("/merchants/me/"), {
      headers: authHeaders(),
    });
  },

  list: async (): Promise<MerchantProfile[]> => {
    return djangoFetch<MerchantProfile[]>(apiUrl("/merchants/"));
  },

  nearby: async (lat?: number, lng?: number): Promise<MerchantDiscoveryItem[]> => {
    const params = new URLSearchParams();
    if (lat !== undefined && lng !== undefined) {
      params.set("lat", String(lat));
      params.set("lng", String(lng));
    }
    const qs = params.toString();
    return djangoFetch<MerchantDiscoveryItem[]>(apiUrl(`/merchants/nearby/${qs ? `?${qs}` : ""}`));
  },

  get: async (id: string): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl(`/merchants/${id}/`));
  },

  bySlug: async (slug: string): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl(`/merchants/slug/${encodeURIComponent(slug)}/`));
  },

  update: async (input: Partial<MerchantProfile>): Promise<MerchantProfile> => {
    return djangoFetch<MerchantProfile>(apiUrl("/merchants/me/update/"), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  regenerateQR: async (): Promise<{ qr_code: string }> => {
    return djangoFetch<{ qr_code: string }>(apiUrl("/merchants/me/regenerate-qr/"), {
      method: "POST",
      headers: authHeaders(true),
    });
  },
};

// ── Customer ──────────────────────────────────────────────────────────────────

export const customerApi = {
  profile: async (): Promise<CustomerProfile> => {
    const data = await djangoFetch<any>(apiUrl("/auth/me/"), {
      headers: authHeaders(),
    });
    const cp = data.customer_profile ?? {};
    return {
      id: cp.id ? String(cp.id) : String(data.id),
      full_name: cp.full_name ?? null,
      loyalty_points: cp.loyalty_points ?? 0,
      streak_days: cp.streak_days ?? 0,
      tier: cp.tier ?? "bronze",
      total_orders: cp.total_orders ?? 0,
      transfer_code: cp.transfer_code ?? undefined,
    };
  },

  // old PunchCard APIs removed

  /** Merchant-scoped wallet — source of truth for points at a store. */
  getWallet: async (merchantId: string): Promise<CustomerMerchantWallet | null> => {
    try {
      const data = await djangoFetch<any>(apiUrl(`/loyalty/wallets/mine/?merchant=${merchantId}`), {
        headers: authHeaders(),
      });
      if (!data) return null;
      return {
        id: String(data.id ?? ""),
        merchant_id: String(data.merchant_id ?? merchantId),
        merchant_name: data.merchant_name ?? "",
        merchant_slug: data.merchant_slug ?? "",
        points_balance: data.points_balance ?? 0,
        lifetime_points: data.lifetime_points ?? 0,
        expired_points: data.expired_points ?? 0,
        order_count: data.order_count ?? 0,
        streak_days: data.streak_days ?? 0,
        last_order_date: data.last_order_date ?? null,
        last_point_earned_at: data.last_point_earned_at ?? null,
        tier_level: data.tier_level ?? "bronze",
        created_at: data.created_at ?? "",
        updated_at: data.updated_at ?? "",
      };
    } catch {
      return null;
    }
  },

  listWallets: async (): Promise<CustomerMerchantWallet[]> => {
    const data = await djangoFetch<any[]>(apiUrl("/loyalty/wallets/"), {
      headers: authHeaders(),
    });
    return (data ?? []).map((w) => ({
      id: String(w.id ?? ""),
      merchant_id: String(w.merchant_id ?? ""),
      merchant_name: w.merchant_name ?? "",
      merchant_slug: w.merchant_slug ?? "",
      points_balance: w.points_balance ?? 0,
      lifetime_points: w.lifetime_points ?? 0,
      expired_points: w.expired_points ?? 0,
      order_count: w.order_count ?? 0,
      streak_days: w.streak_days ?? 0,
      last_order_date: w.last_order_date ?? null,
      last_point_earned_at: w.last_point_earned_at ?? null,
      tier_level: w.tier_level ?? "bronze",
      created_at: w.created_at ?? "",
      updated_at: w.updated_at ?? "",
    }));
  },

  joinMerchant: async (
    merchantSlug: string,
  ): Promise<{
    profile: CustomerMerchantProfile;
    wallet: CustomerMerchantWallet;
    created: boolean;
  }> => {
    const data = await djangoFetch<any>(apiUrl("/loyalty/merchant-profiles/join/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ merchant_slug: merchantSlug }),
    });
    const normProfile = (p: any): CustomerMerchantProfile => ({
      id: String(p.id ?? ""),
      merchant_id: String(p.merchant_id ?? ""),
      merchant_name: p.merchant_name ?? "",
      merchant_slug: p.merchant_slug ?? merchantSlug,
      joined_at: p.joined_at ?? "",
      status: p.status ?? "active",
      created_at: p.created_at ?? "",
      updated_at: p.updated_at ?? "",
    });
    const normWallet = (w: any): CustomerMerchantWallet => ({
      id: String(w.id ?? ""),
      merchant_id: String(w.merchant_id ?? ""),
      merchant_name: w.merchant_name ?? "",
      merchant_slug: w.merchant_slug ?? merchantSlug,
      points_balance: w.points_balance ?? 0,
      lifetime_points: w.lifetime_points ?? 0,
      expired_points: w.expired_points ?? 0,
      order_count: w.order_count ?? 0,
      streak_days: w.streak_days ?? 0,
      last_order_date: w.last_order_date ?? null,
      last_point_earned_at: w.last_point_earned_at ?? null,
      tier_level: w.tier_level ?? "bronze",
      created_at: w.created_at ?? "",
      updated_at: w.updated_at ?? "",
    });
    return {
      profile: normProfile(data.profile),
      wallet: normWallet(data.wallet),
      created: Boolean(data.created),
    };
  },

  joinedMerchants: async (): Promise<JoinedMerchant[]> => {
    return djangoFetch<JoinedMerchant[]>(apiUrl("/loyalty/merchant-profiles/joined/"), {
      headers: authHeaders(),
    });
  },
};

// ── Missions ──────────────────────────────────────────────────────────────────

export const missionApi = {
  myMissions: async (merchantId?: string): Promise<MissionView[]> => {
    const qs = merchantId ? `?merchant=${merchantId}` : "";
    return djangoFetch<MissionView[]>(apiUrl(`/loyalty/missions/my-missions/${qs}`), {
      headers: authHeaders(),
    });
  },

  merchantMissions: async (): Promise<Mission[]> => {
    return djangoFetch<Mission[]>(apiUrl("/loyalty/missions/merchant/"), {
      headers: authHeaders(),
    });
  },

  create: async (input: Omit<Mission, "id" | "merchant_id" | "created_at" | "linked_menu_item_name">): Promise<Mission> => {
    return djangoFetch<Mission>(apiUrl("/loyalty/missions/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  update: async (id: string, input: Partial<Mission>): Promise<Mission> => {
    return djangoFetch<Mission>(apiUrl(`/loyalty/missions/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    });
  },

  delete: async (id: string): Promise<void> => {
    return djangoFetch<void>(apiUrl(`/loyalty/missions/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },
};

// ── Rewards ───────────────────────────────────────────────────────────────────

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

// ── Loyalty Rules + Merchant Rewards ─────────────────────────────────────────

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

  confirmRedemption: async (
    code: string,
  ): Promise<{ customer_name: string; points_deducted: number }> => {
    const data = await djangoFetch<any>(apiUrl("/loyalty/redemptions/confirm/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ code }),
    });
    return {
      customer_name: data.customer_name ?? "Customer",
      points_deducted: data.points_spent ?? 0,
    };
  },

  getRedemptions: async (): Promise<Redemption[]> => {
    return djangoFetch<Redemption[]>(apiUrl("/loyalty/redemptions/merchant/"), {
      headers: authHeaders(),
    });
  },
};

// ── Point Transactions ────────────────────────────────────────────────────────

export const transactionApi = {
  customerList: async (merchantId: string): Promise<PointTransaction[]> => {
    return djangoFetch<PointTransaction[]>(
      apiUrl(`/loyalty/transactions/?merchant=${merchantId}`),
      {
        headers: authHeaders(),
      },
    );
  },

  merchantList: async (): Promise<PointTransaction[]> => {
    return djangoFetch<PointTransaction[]>(apiUrl("/loyalty/merchant/transactions/"), {
      headers: authHeaders(),
    });
  },
};

// ── Punch Cards ───────────────────────────────────────────────────────────────

export const punchCardApi = {
  generateProof: async (
    id: string,
  ): Promise<{
    proof_code: string;
    expires_at: string;
    reward_text: string;
    store_name: string;
    customer_name: string;
  }> => {
    return djangoFetch(apiUrl(`/loyalty/punch-cards/${id}/generate-proof/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
  },

  confirmProof: async (
    proofCode: string,
  ): Promise<{
    success: boolean;
    customer_name: string;
    reward_text: string;
    order_id: string;
    new_card_started: boolean;
  }> => {
    return djangoFetch(apiUrl("/loyalty/punch-cards/confirm-proof/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ proof_code: proofCode }),
    });
  },
  merchantList: async (): Promise<MerchantPunchCard[]> => {
    return djangoFetch<MerchantPunchCard[]>(apiUrl("/loyalty/merchant/punch-cards/"), {
      headers: authHeaders(),
    });
  },

  merchantCreate: async (data: Partial<MerchantPunchCard>): Promise<MerchantPunchCard> => {
    return djangoFetch<MerchantPunchCard>(apiUrl("/loyalty/merchant/punch-cards/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  merchantUpdate: async (
    id: string,
    data: Partial<MerchantPunchCard>,
  ): Promise<MerchantPunchCard> => {
    return djangoFetch<MerchantPunchCard>(apiUrl(`/loyalty/merchant/punch-cards/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  customerList: async (
    merchantId: string,
  ): Promise<{ active: CustomerPunchCard[]; completed: CustomerPunchCard[] }> => {
    return djangoFetch<{ active: CustomerPunchCard[]; completed: CustomerPunchCard[] }>(
      apiUrl(`/loyalty/punch-cards/?merchant=${merchantId}`),
      {
        headers: authHeaders(),
      },
    );
  },

  customerRedeem: async (id: string): Promise<CustomerPunchCard> => {
    return djangoFetch<CustomerPunchCard>(apiUrl(`/loyalty/punch-cards/${id}/redeem/`), {
      method: "POST",
      headers: authHeaders(),
    });
  },
};

// ── Tables ────────────────────────────────────────────────────────────────────

export const tableApi = {
  list: async (): Promise<MerchantTable[]> => {
    return djangoFetch<MerchantTable[]>(apiUrl("/merchants/tables/"), {
      headers: authHeaders(),
    });
  },

  create: async (data: { name: string; table_number: number }): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl("/merchants/tables/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  update: async (id: number, data: Partial<MerchantTable>): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl(`/merchants/tables/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  delete: async (id: number): Promise<void> => {
    await djangoFetch(apiUrl(`/merchants/tables/${id}/delete/`), {
      method: "DELETE",
      headers: authHeaders(),
    });
  },

  generate: async (count: number, namePrefix?: string): Promise<MerchantTable[]> => {
    return djangoFetch<MerchantTable[]>(apiUrl("/merchants/tables/generate/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ count, name_prefix: namePrefix ?? "Table" }),
    });
  },

  regenerateQR: async (id: number): Promise<MerchantTable> => {
    return djangoFetch<MerchantTable>(apiUrl(`/merchants/tables/${id}/regenerate-qr/`), {
      method: "POST",
      headers: authHeaders(true),
    });
  },

  resolve: async (slug: string, token: string): Promise<TableResolution> => {
    return djangoFetch<TableResolution>(
      apiUrl(`/merchants/public/${encodeURIComponent(slug)}/tables/${encodeURIComponent(token)}/`),
    );
  },
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsApi = {
  merchant: async (days = 30) => {
    return djangoFetch<any>(apiUrl(`/merchants/analytics/?days=${days}`), {
      headers: authHeaders(),
    });
  },
};

// ── Point Transfers ───────────────────────────────────────────────────────────

export interface TransferResponse {
  transfer_group: string;
  sent_transaction: PointTransaction;
  received_transaction: PointTransaction;
  sender_balance: number;
  receiver_balance: number;
}

export const transferApi = {
  create: async (payload: {
    receiver_transfer_code: string;
    merchant_id: number;
    amount: number;
    description?: string;
  }): Promise<TransferResponse> => {
    return djangoFetch<TransferResponse>(apiUrl("/loyalty/transfers/create/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(payload),
    });
  },

  customerList: async (merchantId?: string): Promise<PointTransaction[]> => {
    const qs = merchantId ? `?merchant=${merchantId}` : "";
    return djangoFetch<PointTransaction[]>(apiUrl(`/loyalty/transfers/${qs}`), {
      headers: authHeaders(),
    });
  },

  merchantList: async (): Promise<PointTransaction[]> => {
    return djangoFetch<PointTransaction[]>(apiUrl("/loyalty/merchant/transfers/"), {
      headers: authHeaders(),
    });
  },
};

// ── Membership Cards ─────────────────────────────────────────────────────────

export interface MembershipCardDesign {
  card_title: string;
  card_subtitle: string | null;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  text_mode: string;
  background_type: string;
  background_image: string | null;
  background_pattern: string | null;
  logo: string | null;
  tier_style: string;
  points_label: string | null;
  membership_label: string | null;
  show_lifetime_points: boolean;
  show_joined_date: boolean;
  show_qr_shortcut: boolean;
  show_color_overlay: boolean;
  is_published: boolean;
}

export const merchantCardDesignApi = {
  get: async (): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/"), {
      headers: authHeaders(),
    });
  },

  update: async (data: Partial<MembershipCardDesign>): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/"), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    });
  },

  publish: async (): Promise<MembershipCardDesign> => {
    return djangoFetch<MembershipCardDesign>(apiUrl("/loyalty/merchant/card-design/publish/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({}),
    });
  },
};

export interface MembershipCard {
  merchant: {
    name: string;
    slug: string;
    logo: string | null;
  };
  membership: {
    membership_number_masked: string;
    membership_number_full: string;
    joined_at: string | null;
    status: string;
  };
  wallet: {
    points_balance: number;
    lifetime_points: number;
    redeemed_points: number;
    tier: string;
    streak_days: number;
  };
  card_design: MembershipCardDesign | null;
  transfer_enabled: boolean;
}

export interface MembershipQrToken {
  public_token: string;
  token_version: number;
  created_at: string;
}

export const membershipCardApi = {
  list: async (): Promise<MembershipCard[]> => {
    return djangoFetch<MembershipCard[]>(apiUrl("/loyalty/membership-cards/"), {
      headers: authHeaders(),
    });
  },

  getQr: async (merchantSlug: string): Promise<MembershipQrToken> => {
    return djangoFetch<MembershipQrToken>(
      apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/qr/`),
      { headers: authHeaders() },
    );
  },

  rotateQr: async (merchantSlug: string): Promise<MembershipQrToken> => {
    return djangoFetch<MembershipQrToken>(
      apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/qr/`),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify({}),
      },
    );
  },

  getMembershipDetail: async (merchantSlug: string) => {
    return djangoFetch<any>(apiUrl(`/customer/memberships/${encodeURIComponent(merchantSlug)}/`), {
      headers: authHeaders(),
    });
  },
};

export interface MembershipQrResolve {
  merchant: { name: string; slug: string; logo: string | null };
  customer_name: string;
  membership_number: string;
  status: string;
}

export const publicQrApi = {
  resolve: async (token: string): Promise<MembershipQrResolve> => {
    return djangoFetch<MembershipQrResolve>(apiUrl(`/loyalty/qr/${encodeURIComponent(token)}/`));
  },
};

// ── Leaderboard ───────────────────────────────────────────────────────────────

export const leaderboardApi = {
  get: async (merchantId?: string, limit = 10) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (merchantId) qs.set("merchant", merchantId);
    return djangoFetch<any[]>(apiUrl(`/loyalty/leaderboard/?${qs}`));
  },
};
