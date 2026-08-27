// ── All shared API types ──────────────────────────────────────────────────────

export interface TodaySpecial {
  id: string;
  title: string;
  description: string;
  image_url: string;
  linked_menu_item: number | null;
  linked_menu_item_name: string | null;
  linked_menu_item_price: string | null;
  linked_reward: string | null;
  linked_reward_name: string | null;
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number | null;
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
  phone: string | null;
  logo_url: string | null;
  is_open: boolean;
  latitude: string | null;
  longitude: string | null;
  distance_km: number | null;
}

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
  preparation_area?: number | null;
  requires_preparation?: boolean;
}

export type MenuItemInput = Omit<MenuItem, "id" | "merchant_id" | "created_at" | "updated_at">;

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export type FulfillmentType = "dine_in" | "pickup" | "delivery";

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  name: string;
  price: string;
  quantity: number;
  subtotal: string;
  preparation_area?: number | null;
  requires_preparation?: boolean;
  preparation_status?: string;
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
  guest_session_id?: string;
  guest_name_snapshot?: string;
  kot_number?: number | null;
  can_add_items?: boolean;
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
  profiles?: { full_name: string | null };
  merchant_profiles?: { business_name: string };
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

export interface CreateGuestOrderPayload {
  merchant_id: string;
  items: {
    menu_item_id: string;
    quantity: number;
    name: string;
    price: number;
    points_per_item: number;
  }[];
  notes?: string;
  table_token: string;
  guest_session_id: string;
  guest_name: string;
}

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
  preparation_routing_enabled?: boolean;
  currency_code?: string;
  currency_symbol?: string;
  tax_enabled?: boolean;
  tax_rate_percent?: string;
  tax_components?: Array<{ name: string; rate: number }>;
  pos_enabled?: boolean;
  offline_pos_enabled?: boolean;
  credit_accounts_enabled?: boolean;
  debit_accounts_enabled?: boolean;
  discounts_enabled?: boolean;
  shift_management_enabled?: boolean;
  receipt_printing_enabled?: boolean;
  max_worker_discount_percent?: number;
  manager_approval_threshold?: number;
  offline_discounts_allowed?: boolean;
  offline_credit_allowed?: boolean;
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

export interface TransferResponse {
  transfer_group: string;
  sent_transaction: PointTransaction;
  received_transaction: PointTransaction;
  sender_balance: number;
  receiver_balance: number;
}

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

export interface MembershipQrResolve {
  merchant: { name: string; slug: string; logo: string | null };
  customer_name: string;
  membership_number: string;
  status: string;
}
