import { apiUrl, djangoFetch, tokenStore } from "@/lib/django-api-base";

const headers = () => ({
  Authorization: `Bearer ${tokenStore.getAccess()}`,
  "Content-Type": "application/json",
});

// ── Health ────────────────────────────────────────────────────────────────────
export const posHealth = () =>
  djangoFetch<{ status: string; server_time: string }>(apiUrl("/pos/health/"), {
    headers: headers(),
  });

// ── Auth ──────────────────────────────────────────────────────────────────────
export const posLogin = (email: string, password: string) =>
  djangoFetch<{
    access: string;
    refresh: string;
    merchant: {
      id: number;
      business_name: string;
      slug: string;
      logo_url: string;
      pos_enabled: boolean;
      offline_pos_enabled: boolean;
      shift_management_enabled: boolean;
      discounts_enabled: boolean;
      credit_accounts_enabled: boolean;
      receipt_printing_enabled: boolean;
    };
  }>(apiUrl("/pos/auth/login/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

export const posAuthorizeDevice = (
  name: string,
  platform?: string,
  userAgent?: string,
  existingToken?: string,
) =>
  djangoFetch<{ device: PosDevice; device_token: string }>(apiUrl("/pos/auth/device/authorize/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name,
      platform: platform || "",
      user_agent: userAgent || "",
      device_token: existingToken || "",
    }),
  });

export const posBootstrap = (deviceId: string) =>
  djangoFetch<PosBootstrapResponse>(apiUrl("/pos/auth/bootstrap/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ device_id: deviceId }),
  });

export const posDeviceBootstrap = (deviceId: string, deviceToken: string) =>
  djangoFetch<PosBootstrapResponse>(apiUrl("/pos/auth/device-bootstrap/"), {
    method: "GET",
    headers: {
      "X-Pos-Device-Id": deviceId,
      "X-Pos-Device-Token": deviceToken,
      "Content-Type": "application/json",
    },
  });

// ── Device ────────────────────────────────────────────────────────────────────
export const posVerifyDevice = (deviceId: string, deviceToken: string) =>
  djangoFetch<{ device: PosDevice }>(apiUrl("/pos/device/verify/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ device_id: deviceId, device_token: deviceToken }),
  });

// ── Workers ───────────────────────────────────────────────────────────────────
export const posListWorkers = () =>
  djangoFetch<ShiftWorker[]>(apiUrl("/pos/workers/"), {
    headers: headers(),
  });

export const posCreateWorker = (data: {
  display_name: string;
  pin: string;
  role?: string;
  can_apply_discount?: boolean;
  can_process_refund?: boolean;
  can_close_shift?: boolean;
  can_view_reports?: boolean;
}) =>
  djangoFetch<ShiftWorker>(apiUrl("/pos/workers/create/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posUpdateWorker = (
  workerId: string,
  data: Partial<{
    display_name: string;
    role: string;
    is_active: boolean;
    can_apply_discount: boolean;
    can_process_refund: boolean;
    can_close_shift: boolean;
    can_view_reports: boolean;
  }>,
) =>
  djangoFetch<ShiftWorker>(apiUrl(`/pos/workers/${workerId}/update/`), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posWorkerLogin = (workerId: string, pin: string) => {
  const deviceId = localStorage.getItem("pos_device_id") || "";
  const deviceToken = localStorage.getItem("pos_device_token") || "";
  return djangoFetch<{ worker: ShiftWorker; message: string }>(apiUrl("/pos/worker/login/"), {
    method: "POST",
    headers: {
      "X-Pos-Device-Id": deviceId,
      "X-Pos-Device-Token": deviceToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ worker_id: workerId, pin }),
  });
};

export const posWorkerLogout = (workerId: string) => {
  const deviceId = localStorage.getItem("pos_device_id") || "";
  const deviceToken = localStorage.getItem("pos_device_token") || "";
  return djangoFetch<{ message: string }>(apiUrl("/pos/worker/logout/"), {
    method: "POST",
    headers: {
      "X-Pos-Device-Id": deviceId,
      "X-Pos-Device-Token": deviceToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ worker_id: workerId }),
  });
};

// ── Shifts ────────────────────────────────────────────────────────────────────
export const posGetActiveShift = (deviceId: string) =>
  djangoFetch<{ shift: CashShift | null }>(apiUrl(`/pos/shift/active/?device_id=${deviceId}`), {
    headers: headers(),
  });

export const posGetLastClosedShift = (deviceId: string) =>
  djangoFetch<{ shift: CashShift | null }>(
    apiUrl(`/pos/shift/last-closed/?device_id=${deviceId}`),
    { headers: headers() },
  );

export const posOpenShift = (deviceId: string, workerId: string, openingCash: number) =>
  djangoFetch<CashShift>(apiUrl("/pos/shift/open/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      device_id: deviceId,
      worker_id: workerId,
      opening_cash: openingCash,
    }),
  });

export const posCloseShift = (shiftId: string, workerId: string, closingCash: number) =>
  djangoFetch<CashShift>(apiUrl("/pos/shift/close/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      shift_id: shiftId,
      worker_id: workerId,
      closing_cash: closingCash,
    }),
  });

export interface ShiftSummary {
  total_sales: string;
  total_cash_sales: string;
  total_card_sales: string;
  total_other_sales: string;
  total_orders: number;
  opening_cash: string;
  cash_payouts: string;
  cash_payins: string;
}

export const posShiftSummary = (shiftId: string) =>
  djangoFetch<ShiftSummary>(apiUrl(`/pos/shift/summary/?shift_id=${shiftId}`), {
    headers: headers(),
  });

// ── Orders ────────────────────────────────────────────────────────────────────
export const posCreateOrder = (data: PosCreateOrderPayload) =>
  djangoFetch<PosOrder>(apiUrl("/pos/order/create/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posListOrders = (shiftId?: string) =>
  djangoFetch<PosOrder[]>(apiUrl(`/pos/orders/${shiftId ? `?shift_id=${shiftId}` : ""}`), {
    headers: headers(),
  });

export const posUpdateOrderStatus = (
  orderId: string,
  status: string,
  workerId?: string,
  deviceId?: string,
) =>
  djangoFetch<PosOrder>(apiUrl("/pos/order/status/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      order_id: orderId,
      status,
      worker_id: workerId,
      device_id: deviceId,
    }),
  });

export const posAddItemsToOrder = (
  orderId: number,
  items: { menu_item_id: number; quantity: number }[],
) =>
  djangoFetch<any>(apiUrl(`/orders/${orderId}/add-items/`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ items }),
  });

export const posAssignCustomerToOrder = (orderId: string, customerId: string) =>
  djangoFetch<{ message: string; points_earned: number }>(apiUrl("/pos/order/assign-customer/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ order_id: orderId, customer_id: customerId }),
  });

// ── Payments ──────────────────────────────────────────────────────────────────
export const posCreatePayment = (data: PosCreatePaymentPayload) =>
  djangoFetch<PosPayment>(apiUrl("/pos/payment/create/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posCreateSplitPayment = (data: PosSplitPaymentPayload) =>
  djangoFetch<{
    payments: PosPayment[];
    total_paid: string;
    remaining: string;
    order_payment_status: string;
  }>(apiUrl("/pos/payment/split/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Discounts ─────────────────────────────────────────────────────────────────
export const posApplyDiscount = (data: PosApplyDiscountPayload) =>
  djangoFetch<PosDiscount>(apiUrl("/pos/discount/apply/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Debit Accounts (Prepaid / Wallet) ────────────────────────────────────────
export const posListDebitAccounts = () =>
  djangoFetch<DebitAccount[]>(apiUrl("/pos/debit/accounts/"), {
    headers: headers(),
  });

export const posCreateDebitAccount = (data: PosCreateDebitAccountPayload) =>
  djangoFetch<DebitAccount>(apiUrl("/pos/debit/accounts/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posDebitTopup = (data: PosDebitTopupPayload) =>
  djangoFetch<DebitTransaction>(apiUrl("/pos/debit/topup/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posDebitPurchase = (data: PosDebitPurchasePayload) =>
  djangoFetch<DebitTransaction>(apiUrl("/pos/debit/purchase/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posDebitAdjustment = (data: PosDebitAdjustmentPayload) =>
  djangoFetch<DebitTransaction>(apiUrl("/pos/debit/adjustment/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Receipt ───────────────────────────────────────────────────────────────────
export const posReceiptData = (orderId: string) =>
  djangoFetch<PosReceiptData>(apiUrl(`/pos/receipt/${orderId}/`), {
    headers: headers(),
  });

// ── Settings ──────────────────────────────────────────────────────────────────
export const posGetSettings = () =>
  djangoFetch<PosSettings>(apiUrl("/pos/settings/"), {
    headers: headers(),
  });

export const posUpdateSettings = (data: Partial<PosSettings>) =>
  djangoFetch<PosSettings>(apiUrl("/pos/settings/update/"), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Menu snapshot ─────────────────────────────────────────────────────────────
export const posMenuSnapshot = () =>
  djangoFetch<PosMenuSnapshot>(apiUrl("/pos/menu/snapshot/"), {
    headers: headers(),
  });

// ── Z-Report (End of Day) ────────────────────────────────────────────────────
export const posZReport = (params?: { shift_id?: string; date?: string }) => {
  const qs = new URLSearchParams();
  if (params?.shift_id) qs.set("shift_id", params.shift_id);
  if (params?.date) qs.set("date", params.date);
  const query = qs.toString();
  return djangoFetch<PosZReportData>(apiUrl(`/pos/z-report/${query ? `?${query}` : ""}`), {
    headers: headers(),
  });
};

// ── Credit Accounts ─────────────────────────────────────────────────────────
export const posListCreditAccounts = () =>
  djangoFetch<CreditAccount[]>(apiUrl("/pos/credit/accounts/"), {
    headers: headers(),
  });

export const posCreateCreditAccount = (data: PosCreateCreditAccountPayload) =>
  djangoFetch<CreditAccount>(apiUrl("/pos/credit/accounts/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posCreditSale = (data: PosCreditSalePayload) =>
  djangoFetch<CreditTransaction>(apiUrl("/pos/credit/sale/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posCreditRepayment = (data: PosCreditRepaymentPayload) =>
  djangoFetch<CreditTransaction>(apiUrl("/pos/credit/repayment/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Staff Daily Report ──────────────────────────────────────────────────────
export const posStaffDailyReport = (params?: { date?: string; worker_id?: string }) => {
  const qs = new URLSearchParams();
  if (params?.date) qs.set("date", params.date);
  if (params?.worker_id) qs.set("worker_id", params.worker_id);
  const query = qs.toString();
  return djangoFetch<PosStaffDailyReportData>(
    apiUrl(`/pos/staff-report/${query ? `?${query}` : ""}`),
    { headers: headers() },
  );
};

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PosDevice {
  id: string;
  name: string;
  platform: string;
  user_agent: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftWorker {
  id: string;
  display_name: string;
  role: string;
  is_active: boolean;
  can_apply_discount: boolean;
  can_process_refund: boolean;
  can_close_shift: boolean;
  can_view_reports: boolean;
}

export interface CashShift {
  id: string;
  device: string;
  opened_by: string;
  opened_by_name: string;
  closed_by: string | null;
  closed_by_name: string | null;
  opening_cash: string;
  expected_cash: string;
  closing_cash: string | null;
  cash_difference: string | null;
  total_sales: string;
  total_cash_sales: string;
  total_card_sales: string;
  total_other_sales: string;
  total_orders: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  sync_status: string;
  version: number;
}

export interface PosOrder {
  id: number;
  uuid: string;
  customer: number | null;
  customer_name: string | null;
  merchant: number;
  merchant_id: number;
  merchant_name: string;
  status: string;
  order_type: string;
  source: string;
  fulfillment_type: string;
  subtotal: string;
  discount_type: string;
  discount_value: string;
  discount_amount: string;
  tax_amount: string;
  tax_breakdown: Array<{ name: string; rate: number; amount: number }>;
  service_charge: string;
  total_amount: string;
  points_earned: number;
  payment_status: string;
  payment_method: string;
  notes: string;
  items: Array<{
    id: number;
    menu_item: number | null;
    name: string;
    price: string;
    quantity: number;
    subtotal: string;
  }>;
  cancellation_reason: string;
  cancelled_by: string;
  table_id: number | null;
  table_name_snapshot: string;
  table_number_snapshot: number | null;
  processed_by_worker: string | null;
  worker_name: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PosPayment {
  id: string;
  order: string;
  shift: string | null;
  worker: string;
  worker_name: string | null;
  device: string;
  payment_method: string;
  amount: string;
  status: string;
  external_reference: string;
  change_amount: string;
  client_mutation_id: string;
  client_created_at: string;
  created_at: string;
  sync_status: string;
}

export interface PosDiscount {
  id: string;
  order: string;
  worker: string;
  worker_name: string | null;
  discount_type: string;
  discount_value: string;
  discount_amount: string;
  reason: string;
  authorized_by: string | null;
  authorized_by_name: string | null;
  created_at: string;
}

export interface PosReceiptData {
  type: "bill" | "receipt";
  order_id: number;
  order_uuid: string;
  order_number: string;
  kot_number: number | null;
  status: string;
  source: string;
  created_at: string | null;
  client_created_at: string | null;
  merchant: {
    id: number;
    name: string;
    address: string;
    phone: string;
    logo_url: string;
  };
  table: { name: string; number: number } | null;
  fulfillment_type: string;
  customer_name: string | null;
  worker_name: string | null;
  items: Array<{
    name: string;
    price: string;
    quantity: number;
    subtotal: string;
  }>;
  subtotal: string;
  discounts: Array<{
    type: string;
    value: string;
    amount: string;
    reason: string;
    authorized_by: string | null;
  }>;
  discount_amount: string;
  tax_amount: string;
  tax_breakdown: Array<{ name: string; rate: number; amount: number }>;
  service_charge: string;
  total_amount: string;
  payments: Array<{
    method: string;
    amount: string;
    status: string;
    external_reference: string;
    change_amount: string;
    created_at: string | null;
  }>;
  total_paid: string;
  change: string;
  payment_status: string;
  payment_method: string;
  is_offline_receipt: boolean;
  sync_status: string;
}

// Safe tax-rate helper: never return NaN for missing/empty/invalid values.
// Uses tax_components when available, falls back to legacy tax_rate_percent.
export function getTaxRate(settings?: PosSettings | null): number {
  if (!settings) return 0;

  // Prefer tax_components if present
  if (settings.tax_components && settings.tax_components.length > 0) {
    return settings.tax_components.reduce((sum, c) => {
      const rate = Number.parseFloat(String(c.rate)) || 0;
      return sum + (rate > 0 ? rate / 100 : 0);
    }, 0);
  }

  // Fallback to legacy field
  const raw = Number.parseFloat(settings?.tax_rate_percent ?? "");
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw / 100;
}

export interface TaxComponent {
  name: string;
  rate: number;
}

export interface PosSettings {
  pos_enabled: boolean;
  offline_pos_enabled: boolean;
  credit_accounts_enabled: boolean;
  debit_accounts_enabled: boolean;
  discounts_enabled: boolean;
  shift_management_enabled: boolean;
  receipt_printing_enabled: boolean;
  max_worker_discount_percent: string;
  manager_approval_threshold: string;
  offline_discounts_allowed: boolean;
  offline_credit_allowed: boolean;
  tax_enabled: boolean;
  tax_rate_percent: string;
  currency_code: string;
  currency_symbol: string;
  tax_components: TaxComponent[];
}

export interface PosMenuSnapshot {
  merchant_id: number;
  merchant_name: string;
  snapshot_at: string;
  total_items: number;
  categories: Record<
    string,
    Array<{
      id: number;
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
    }>
  >;
}

export interface PosBootstrapResponse {
  merchant: {
    id: number;
    business_name: string;
    slug: string;
    logo_url: string;
  };
  device: PosDevice;
  workers: ShiftWorker[];
  menu: PosMenuSnapshot;
  tables: Array<{
    id: number;
    name: string;
    table_number: number;
    public_token: string;
  }>;
  active_shift: CashShift | null;
  pos_settings: PosSettings;
  recent_orders: PosOrder[];
  incoming_orders: PosOrder[];
}

export interface PosCreateOrderPayload {
  merchant_id: number;
  items: Array<{
    menu_item_id: number;
    quantity: number;
  }>;
  notes?: string;
  fulfillment_type?: string;
  table_id?: number | null;
  customer_id?: number | null;
  order_type?: string;
  source?: string;
  shift_id?: string;
  worker_id?: string;
  device_id?: string;
  client_mutation_id?: string;
}

export interface PosCreatePaymentPayload {
  order_id: string;
  shift_id: string;
  worker_id: string;
  device_id: string;
  payment_method: string;
  amount: number;
  external_reference?: string;
  change_amount?: number;
  debit_account_id?: string;
  client_mutation_id: string;
}

export interface PosSplitPaymentPayload {
  order_id: string;
  shift_id: string;
  worker_id: string;
  device_id: string;
  payments: Array<{
    payment_method: string;
    amount: number;
    external_reference?: string;
  }>;
  change_amount?: number;
}

export interface PosApplyDiscountPayload {
  order_id: string;
  worker_id: string;
  discount_type: "fixed" | "percentage";
  discount_value: number;
  reason?: string;
  authorized_by_worker_id?: string;
  source?: string;
}

// ── Debit (Prepaid / Wallet) ─────────────────────────────────────────────────

export interface DebitAccount {
  id: string;
  customer: number | null;
  contact_name: string;
  contact_phone: string;
  balance: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DebitTransaction {
  id: string;
  account: string;
  order: string | null;
  worker: string;
  transaction_type: "topup" | "purchase" | "refund" | "adjustment";
  amount: string;
  balance_before: string;
  balance_after: string;
  note: string;
  created_at: string;
  sync_status: string;
}

export interface PosDebitTopupPayload {
  account_id: string;
  worker_id: string;
  device_id: string;
  amount: number;
  client_mutation_id: string;
  note?: string;
}

export interface PosDebitPurchasePayload {
  account_id: string;
  order_id: string;
  worker_id: string;
  device_id: string;
  shift_id?: string;
  amount: number;
  client_mutation_id: string;
  note?: string;
}

export interface PosDebitAdjustmentPayload {
  account_id: string;
  worker_id: string;
  amount: number;
  client_mutation_id: string;
  note?: string;
}

export interface PosCreateDebitAccountPayload {
  contact_name: string;
  contact_phone: string;
  initial_balance?: number;
}

// ── Credit Accounts ─────────────────────────────────────────────────────────

export interface CreditAccount {
  id: string;
  customer: number | null;
  contact_name: string;
  contact_phone: string;
  credit_limit: string;
  current_balance: string;
  available_credit: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  account: string;
  order: string | null;
  worker: string | null;
  transaction_type: "sale" | "repayment" | "adjustment";
  amount: string;
  balance_before: string;
  balance_after: string;
  note: string;
  created_at: string;
}

export interface PosCreditSalePayload {
  account_id: string;
  order_id: string;
  worker_id: string;
  amount: number;
  note?: string;
}

export interface PosCreditRepaymentPayload {
  account_id: string;
  worker_id: string;
  amount: number;
  payment_method?: string;
  note?: string;
}

export interface PosCreateCreditAccountPayload {
  contact_name: string;
  contact_phone: string;
  credit_limit: number;
}

// ── Staff Daily Report ──────────────────────────────────────────────────────

export interface PosStaffDailyReportData {
  date: string;
  staff: Array<{
    worker_id: string;
    worker_name: string;
    order_count: number;
    payment_count: number;
    total_revenue: string;
    cash_amount: string;
    card_amount: string;
    credit_amount: string;
    other_amount: string;
    total_discount: string;
    items_sold: number;
  }>;
  totals: {
    total_revenue: string;
    total_orders: number;
    total_payments: number;
    total_items_sold: number;
    total_discount: string;
  };
}

// ── Z-Report ─────────────────────────────────────────────────────────────────

export interface PosZReportData {
  report_label: string;
  generated_at: string;
  merchant: {
    name: string;
    address: string;
    phone: string;
    logo_url: string;
  };
  shifts: Array<{
    id: string;
    opened_by: string;
    closed_by: string | null;
    opening_cash: string;
    closing_cash: string | null;
    expected_cash: string;
    cash_difference: string | null;
    total_cash_sales: string;
    total_card_sales: string;
    total_other_sales: string;
    total_sales: string;
    total_orders: number;
    status: string;
    opened_at: string | null;
    closed_at: string | null;
  }>;
  total_orders: number;
  total_revenue: string;
  total_discount_amount: string;
  total_tax: string;
  total_service_charge: string;
  total_payments: string;
  total_change_given: string;
  payment_methods: Array<{
    method: string;
    count: number;
    amount: string;
    change: string;
  }>;
  order_status_breakdown: Array<{
    status: string;
    count: number;
  }>;
  fulfillment_breakdown: Array<{
    type: string;
    count: number;
  }>;
  top_selling_items: Array<{
    name: string;
    quantity_sold: number;
    revenue: string;
  }>;
  discounts_applied: number;
  total_discounts_value: string;
  cash_summary: {
    total_cash_in: string;
    total_cash_out_change: string;
    total_expected_cash: string;
    total_actual_cash: string;
    total_difference: string;
    total_payouts: string;
    total_payins: string;
  };
  credit_summary: {
    sales: string;
    repayments: string;
  };
  debit_summary: {
    purchases: string;
    topups: string;
  };
  refund_total: string;
  refund_count: number;
  staff_breakdown: Array<{
    worker_id: string;
    worker_name: string;
    order_count: number;
    payment_count: number;
    total_revenue: string;
    total_change: string;
    cash_amount: string;
    card_amount: string;
    other_amount: string;
  }>;
}

// ── Customer Search (Phase 26) ─────────────────────────────────────────────

export const posSearchCustomers = (query: string, signal?: AbortSignal) =>
  djangoFetch<PosCustomer[]>(apiUrl(`/pos/customers/search/?q=${encodeURIComponent(query)}`), {
    headers: headers(),
    signal,
  });

export interface PosCreateCustomerPayload {
  full_name: string;
  phone?: string;
  email?: string;
}

export const posCreateCustomer = (data: PosCreateCustomerPayload) =>
  djangoFetch<PosCustomer>(apiUrl("/pos/customers/create/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export interface PosCustomer {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  transfer_code: string;
  membership_number: string;
  loyalty_points: number;
  tier: string;
  total_orders: number;
}

// ── Refund (Phase 27) ──────────────────────────────────────────────────────

export const posProcessRefund = (data: PosRefundPayload) =>
  djangoFetch<{
    message: string;
    refund_payment_id: string;
    refund_amount: string;
    order_status: string;
  }>(apiUrl("/pos/refund/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export interface PosRefundPayload {
  order_id: string;
  worker_id: string;
  reason: string;
  amount?: number;
  refund_method?: string;
}

// ── Conflict Resolution (Phase 30) ─────────────────────────────────────────

export const posListConflicts = () =>
  djangoFetch<PosConflicts>(apiUrl("/pos/conflicts/"), {
    headers: headers(),
  });

export const posResolveConflict = (data: PosResolveConflictPayload) =>
  djangoFetch<{ message: string }>(apiUrl("/pos/conflicts/resolve/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posClearMutations = (mutationIds?: number[]) =>
  djangoFetch<{ message: string; count: number }>(apiUrl("/pos/conflicts/clear-mutations/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(mutationIds ? { mutation_ids: mutationIds } : {}),
  });

export interface PosConflicts {
  orders: Array<{
    id: number;
    uuid: string;
    status: string;
    total_amount: string;
    version: number;
    sync_status: string;
    created_at: string | null;
  }>;
  payments: Array<{
    id: string;
    order: string;
    payment_method: string;
    amount: string;
    status: string;
    sync_status: string;
    created_at: string | null;
  }>;
  mutations: Array<{
    id: number;
    client_mutation_id: string;
    entity_type: string;
    operation: string;
    server_object_id: string | null;
    processed_at: string | null;
  }>;
}

export interface PosResolveConflictPayload {
  entity_type: "order" | "payment";
  entity_id: string;
  resolution: "keep_server" | "keep_client" | "merge";
  client_data?: Record<string, any>;
}

// ── Table QR (Phase 28) — Public ───────────────────────────────────────────

export const posTableMenu = (token: string) =>
  djangoFetch<PosTableMenu>(apiUrl(`/pos/table/${token}/menu/`), {});

export const posTableOrder = (
  token: string,
  data: {
    items: Array<{ menu_item_id: number; quantity: number }>;
    notes?: string;
    customer_name?: string;
  },
) =>
  djangoFetch<{ message: string; order_id: number; table: string; total: string }>(
    apiUrl(`/pos/table/${token}/order/`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

export interface PosTableMenu {
  table: { id: number; name: string; table_number: number };
  merchant: { name: string; logo_url: string };
  categories: Record<
    string,
    Array<{
      id: number;
      name: string;
      description: string;
      price: string;
      image_url: string;
      category: string;
      emoji: string;
      is_featured: boolean;
    }>
  >;
}

// ── Notifications (Phase 31) ──────────────────────────────────────────────

export const posNotifications = () =>
  djangoFetch<PosNotification[]>(apiUrl("/pos/notifications/"), {
    headers: headers(),
  });

export const posMarkNotificationRead = (id: number) =>
  djangoFetch<{ message: string }>(apiUrl(`/pos/notifications/${id}/read/`), {
    method: "POST",
    headers: headers(),
  });

export interface PosNotification {
  id: number;
  title: string;
  message: string;
  notification_type: string;
  is_read: boolean;
  created_at: string | null;
}

// ── Staff Scheduling (Phase 31+) ──────────────────────────────────────────

export const posListSchedules = (week?: string) =>
  djangoFetch<PosStaffSchedule[]>(apiUrl(`/pos/schedules/${week ? `?week=${week}` : ""}`), {
    headers: headers(),
  });

export const posCreateSchedule = (data: PosCreateSchedulePayload) =>
  djangoFetch<PosStaffSchedule>(apiUrl("/pos/schedules/create/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posDeleteSchedule = (id: number) =>
  djangoFetch<{ message: string }>(apiUrl(`/pos/schedules/${id}/delete/`), {
    method: "DELETE",
    headers: headers(),
  });

// ── Cash Movements (Pay-in / Pay-out / Cash Drop) ──────────────────────────

export const posCreateCashMovement = (data: PosCashMovementPayload) =>
  djangoFetch<PosCashMovement>(apiUrl("/pos/cash/movement/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const posListCashMovements = (shiftId?: string) =>
  djangoFetch<PosCashMovement[]>(
    apiUrl(`/pos/cash/movements/${shiftId ? `?shift_id=${shiftId}` : ""}`),
    { headers: headers() },
  );

export interface PosStaffSchedule {
  id: number;
  worker_id: string;
  worker_name: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role: string;
  status: string;
  notes: string;
}

export interface PosCreateSchedulePayload {
  worker_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  role?: string;
  notes?: string;
}

// ── Cash Movements ─────────────────────────────────────────────────────────

export interface PosCashMovement {
  id: string;
  shift: string;
  worker: string;
  worker_name: string | null;
  movement_type: "payout" | "payin" | "cashdrop";
  amount: string;
  reason: string;
  created_at: string;
}

export interface PosCashMovementPayload {
  shift_id: string;
  worker_id: string;
  movement_type: "payout" | "payin" | "cashdrop";
  amount: number;
  reason?: string;
}
