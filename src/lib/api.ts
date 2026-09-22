// ── Legacy barrel for `@/lib/api` ────────────────────────────────────────────
// Kept so existing `import ... from "@/lib/api"` resolves to a single file.
// Server/client API surface now lives in `./api/*` (index, types, menu,
// orders, merchants, specials, etc.). This file re-exports it all.
export * from "./api/index";
export * from "./api/types";

// ── Merchant customers (bonus endpoint) ──────────────────────────────────────
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export interface MerchantCustomer {
  membership_id: number;
  membership_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  points_balance: number;
  lifetime_points: number;
  tier: string;
  order_count: number;
  total_spent: number;
  joined_at: string;
  status: string;
  last_active_at: string | null;
}

export const merchantCustomersApi = {
  list: async (): Promise<MerchantCustomer[]> => {
    return djangoFetch<MerchantCustomer[]>(apiUrl("/loyalty/merchant/customers/"), {
      headers: authHeaders(),
    });
  },
};
