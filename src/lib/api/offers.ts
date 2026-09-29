import { apiUrl, djangoFetch, tokenStore } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

// ── Types ────────────────────────────────────────────────────────────────────

export type BenefitKind = "percent_off" | "amount_off" | "free_item" | "buy_x_get_y";

export interface OfferMerchant {
  id: number;
  name: string;
  slug: string;
  logo_url: string;
  category: { slug: string; name: string; icon: string } | null;
  city: string;
  area: string;
  address: string;
  currency_symbol: string;
}

export interface PublicOffer {
  id: number;
  title: string;
  description: string;
  terms: string;
  image_url: string;
  summary: string;
  conditions: string[];
  benefit_kind: BenefitKind;
  merchant: OfferMerchant;
  distance_km: number | null;
  starts_at: string | null;
  ends_at: string | null;
  remaining: number | null;
  my_claim_id: number | null;
  effective_status?: string;
  claimable?: boolean;
}

export interface OfferClaim {
  id: number;
  code: string;
  qr_payload: string;
  /** Money offers (and minimum-spend offers) need the bill amount at the counter. */
  needs_bill_amount: boolean;
  bill_label: string;
  /** The store accepts confirmation with its counter PIN on the customer's phone. */
  store_pin_enabled: boolean;
  status: "available" | "reserved" | "redeemed" | "expired" | "revoked";
  tab: "available" | "used" | "expired";
  uses_allowed: number;
  uses_count: number;
  uses_remaining: number;
  claimed_at: string;
  expires_at: string | null;
  offer: {
    id: number;
    title: string;
    summary: string;
    conditions: string[];
    terms: string;
    image_url: string;
    benefit_kind: BenefitKind;
    channels: "all" | "online" | "in_store";
    merchant: OfferMerchant;
  };
}

export interface RewardOption {
  menu_item_id: number;
  name: string;
  price: string;
  selections: Array<{ group_id: number; option_id: number }>;
}

export interface OfferReason {
  code: string;
  message?: string;
  required?: string | number;
  current?: string | number;
  shortfall?: string;
}

export interface OfferEvaluation {
  eligible: boolean;
  discount_amount?: string;
  reason: OfferReason | null;
  reward_options?: RewardOption[];
  /** The server's full pricing of the basket with this offer. */
  pricing?: {
    subtotal: string;
    discount_total: string;
    taxable_total: string;
    tax_total: string;
    charge_total: string;
    grand_total: string;
    prices_include_tax: boolean;
    taxes: Array<{ name: string; rate: string; amount: string }>;
    charges: Array<{ kind: string; label: string; amount: string; tax: string; taxable: boolean }>;
  } | null;
}

export interface OfferCategory {
  id: number;
  slug: string;
  name: string;
  icon: string;
  children: Array<{ id: number; slug: string; name: string; icon: string }>;
}

export interface OfferArea {
  city: string;
  areas: string[];
}

export interface CampaignTarget {
  role: "benefit" | "qualifying";
  menu_item?: number | null;
  category?: number | null;
  option?: number | null;
  label?: string;
}

export interface CampaignBenefit {
  kind: BenefitKind;
  scope: "order" | "targets";
  value: string | null;
  reward_quantity: number;
  reward_discount_percent: string;
  reward_selection: "customer_choice" | "cheapest";
  max_applications: number;
  include_modifiers: boolean;
}

export interface Campaign {
  id: number;
  title: string;
  description: string;
  terms: string;
  image_url: string;
  status: "draft" | "published" | "paused" | "ended" | "archived";
  effective_status: "draft" | "scheduled" | "active" | "paused" | "ended" | "archived";
  visibility: "public" | "link_only";
  channels: "all" | "online" | "in_store";
  starts_at: string | null;
  ends_at: string | null;
  claim_valid_days: number | null;
  max_claims: number | null;
  max_redemptions: number | null;
  per_customer_limit: number;
  min_order_amount: string | null;
  max_discount_amount: string | null;
  exclude_discounted_items: boolean;
  restore_on_cancel: boolean;
  version: number;
  currency_code: string;
  claims_count: number;
  reserved_count: number;
  redemptions_count: number;
  summary: string;
  conditions_text: string[];
  benefit: CampaignBenefit | null;
  targets: CampaignTarget[];
  qualifying_quantity: number | null;
  share_path: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignInput = Partial<
  Omit<
    Campaign,
    "id" | "status" | "effective_status" | "benefit" | "targets" | "summary" | "conditions_text"
  >
> & {
  benefit?: Partial<CampaignBenefit>;
  targets?: CampaignTarget[];
  qualifying_quantity?: number;
};

export interface CampaignStats {
  campaign_id: number;
  currency_code: string;
  views: number;
  unique_viewers: number;
  claims: number;
  redemptions: number;
  voided: number;
  reserved_now: number;
  claim_rate: number | null;
  redemption_rate: number | null;
  discount_total: string;
  sales_total: string;
  new_customers: number;
  returning_customers: number;
  returned_within_7d_rate: number | null;
  returned_within_30d_rate: number | null;
  series: Array<{
    date: string;
    views: number;
    claims: number;
    redemptions: number;
    voids: number;
    discount_total: string;
    sales_total: string;
  }>;
}

export interface PosOfferLookup {
  claim_id: number;
  code: string;
  needs_bill_amount: boolean;
  bill_label: string;
  status: string;
  customer_first_name: string;
  uses_remaining: number;
  expires_at: string | null;
  offer: {
    id: number;
    title: string;
    summary: string;
    conditions: string[];
    benefit_kind: BenefitKind;
  };
  evaluation: OfferEvaluation;
}

type CartLine = {
  menu_item_id: number | string;
  quantity: number;
  selections?: Array<{ group_id: number | string; option_id: number | string }>;
  special_instructions?: string;
};

/**
 * Attach the customer's token only while it is still valid: a public endpoint
 * rejects an expired token with 401 instead of treating the caller as anonymous.
 */
function optionalAuth(): HeadersInit {
  const token = typeof window !== "undefined" ? tokenStore.getAccess() : null;
  if (!token) return {};
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp > Math.floor(Date.now() / 1000)) return { Authorization: `Bearer ${token}` };
  } catch {
    // fall through: anonymous
  }
  return {};
}

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Customer ─────────────────────────────────────────────────────────────────

export const offersApi = {
  list: (params: {
    q?: string;
    category?: string;
    city?: string;
    area?: string;
    merchant?: number | string;
    lat?: number;
    lng?: number;
    radius_km?: number;
    limit?: number;
    offset?: number;
  }) =>
    djangoFetch<{ count: number; results: PublicOffer[] }>(apiUrl(`/offers/${query(params)}`), {
      headers: optionalAuth(),
    }),

  categories: () => djangoFetch<OfferCategory[]>(apiUrl("/offers/categories/")),

  areas: () => djangoFetch<OfferArea[]>(apiUrl("/offers/areas/")),

  detail: (id: number | string, linkToken?: string) =>
    djangoFetch<PublicOffer>(apiUrl(`/offers/${id}/${query({ t: linkToken })}`), {
      headers: optionalAuth(),
    }),

  claim: (id: number | string, linkToken?: string) =>
    djangoFetch<OfferClaim>(apiUrl(`/offers/${id}/claim/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(linkToken ? { t: linkToken } : {}),
    }),

  mine: (tab: "available" | "used" | "expired" = "available", merchantId?: number | string) =>
    djangoFetch<OfferClaim[]>(apiUrl(`/offers/mine/${query({ tab, merchant_id: merchantId })}`), {
      headers: authHeaders(),
    }),

  myClaim: (claimId: number | string) =>
    djangoFetch<OfferClaim>(apiUrl(`/offers/mine/${claimId}/`), { headers: authHeaders() }),

  previewClaim: (
    claimId: number | string,
    items: CartLine[],
    opts: {
      fulfillment_type?: string;
      reward_choice?: { menu_item_id: number; selections?: unknown[] };
    } = {},
  ) =>
    djangoFetch<OfferEvaluation>(apiUrl(`/offers/mine/${claimId}/preview/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ items, ...opts }),
    }),
};

// ── Merchant ─────────────────────────────────────────────────────────────────

export const merchantOffersApi = {
  list: (includeArchived = false) =>
    djangoFetch<Campaign[]>(
      apiUrl(`/offers/merchant/campaigns/${includeArchived ? "?include_archived=1" : ""}`),
      { headers: authHeaders() },
    ),

  get: (id: number) =>
    djangoFetch<Campaign>(apiUrl(`/offers/merchant/campaigns/${id}/`), { headers: authHeaders() }),

  create: (input: CampaignInput) =>
    djangoFetch<Campaign>(apiUrl("/offers/merchant/campaigns/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    }),

  update: (id: number, input: CampaignInput) =>
    djangoFetch<Campaign>(apiUrl(`/offers/merchant/campaigns/${id}/`), {
      method: "PATCH",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    }),

  remove: (id: number) =>
    djangoFetch<void>(apiUrl(`/offers/merchant/campaigns/${id}/`), {
      method: "DELETE",
      headers: authHeaders(),
    }),

  action: (
    id: number,
    action: "publish" | "pause" | "resume" | "end" | "archive" | "duplicate",
    body: Record<string, unknown> = {},
  ) =>
    djangoFetch<Campaign>(apiUrl(`/offers/merchant/campaigns/${id}/${action}/`), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(body),
    }),

  stats: (id: number, days = 30) =>
    djangoFetch<CampaignStats>(apiUrl(`/offers/merchant/campaigns/${id}/stats/?days=${days}`), {
      headers: authHeaders(),
    }),
};

// ── POS ──────────────────────────────────────────────────────────────────────

export const posOffersApi = {
  lookup: (
    code: string,
    opts: { items?: CartLine[]; order_id?: string; fulfillment_type?: string } = {},
  ) =>
    djangoFetch<PosOfferLookup>(apiUrl("/offers/pos/lookup/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ code, ...opts }),
    }),

  apply: (input: {
    order_id: string;
    code: string;
    worker_id: string;
    reward_choice?: { menu_item_id: number; selections?: unknown[] };
  }) =>
    djangoFetch<{ order_id: string; discount_amount: string; pricing: unknown }>(
      apiUrl("/offers/pos/apply/"),
      {
        method: "POST",
        headers: authHeaders(true),
        body: JSON.stringify(input),
      },
    ),

  remove: (input: { order_id: string; worker_id: string }) =>
    djangoFetch<{ order_id: string; note: string }>(apiUrl("/offers/pos/remove/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    }),

  redeemInStore: (input: {
    code: string;
    worker_id: string;
    idempotency_key: string;
    bill_amount?: string;
  }) =>
    djangoFetch<{ redemption_id: number; discount_amount: string | null }>(
      apiUrl("/offers/pos/redeem-in-store/"),
      { method: "POST", headers: authHeaders(true), body: JSON.stringify(input) },
    ),
};

export interface CounterRedemption {
  redemption_id: number;
  discount_amount: string | null;
  bill_amount: string | null;
  claim: PosOfferLookup;
}

// ── Merchant: confirm at the counter without a POS ──────────────────────────

export const counterRedeemApi = {
  lookup: (code: string) =>
    djangoFetch<PosOfferLookup>(apiUrl("/offers/merchant/redeem/lookup/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ code }),
    }),

  confirm: (input: { code: string; idempotency_key: string; bill_amount?: string }) =>
    djangoFetch<CounterRedemption>(apiUrl("/offers/merchant/redeem/confirm/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(input),
    }),

  pinStatus: () =>
    djangoFetch<{ enabled: boolean; updated_at: string | null }>(
      apiUrl("/offers/merchant/redemption-pin/"),
      {
        headers: authHeaders(),
      },
    ),

  setPin: (pin: string) =>
    djangoFetch<{ enabled: boolean; updated_at: string | null }>(
      apiUrl("/offers/merchant/redemption-pin/"),
      {
        method: "PUT",
        headers: authHeaders(true),
        body: JSON.stringify({ pin }),
      },
    ),

  clearPin: () =>
    djangoFetch<{ enabled: boolean; updated_at: string | null }>(
      apiUrl("/offers/merchant/redemption-pin/"),
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    ),
};

/** Customer side: staff type the store PIN on the customer's phone. */
export function redeemWithStorePin(
  claimId: number,
  input: { pin: string; idempotency_key: string; bill_amount?: string },
) {
  return djangoFetch<{
    redemption_id: number;
    confirmed_at: string;
    discount_amount: string | null;
    claim: OfferClaim;
  }>(apiUrl(`/offers/mine/${claimId}/redeem-with-pin/`), {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(input),
  });
}

/** A customer-facing sentence for why an offer can't be used right now. */
export function offerReasonText(
  reason: OfferReason | null | undefined,
  currencySymbol = "Rs",
): string {
  if (!reason) return "";
  switch (reason.code) {
    case "MINIMUM_ORDER_NOT_MET":
      return `Add ${currencySymbol} ${reason.shortfall} more to use this offer.`;
    case "REWARD_ITEM_REQUIRED":
      return "Choose your free item to use this offer.";
    case "QUALIFYING_ITEMS_REQUIRED": {
      const missing = Math.max(Number(reason.required ?? 1) - Number(reason.current ?? 0), 1);
      return `Add ${missing} more qualifying item${missing > 1 ? "s" : ""} to use this offer.`;
    }
    case "NO_ELIGIBLE_ITEMS":
      return "Nothing in your order qualifies for this offer.";
    default:
      return reason.message || "This offer can't be used on this order.";
  }
}
