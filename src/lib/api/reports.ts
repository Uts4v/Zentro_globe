import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export interface ReportDateParams {
  date_from?: string;
  date_to?: string;
}

export interface SalesReportParams extends ReportDateParams {
  payment_method?: string;
  category?: string;
  product?: string;
}

export interface ReportOverview {
  total_sales: number;
  net_sales: number;
  total_orders: number;
  total_customers: number;
  guest_orders: number;
  avg_order_value: number;
  total_tax: number;
  total_discount: number;
  total_subtotal: number;
}

export interface TaxSummary {
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  taxable_sales: number;
  nontaxable_sales: number;
  sales_with_tax: number;
  sales_excluding_tax: number;
  tax_collected: number;
  refund_tax: number;
  net_tax: number;
}

export interface PaymentBreakdownItem {
  method: string;
  count: number;
  amount: number;
  percentage: number;
  average?: number;
  refunds?: number;
  net?: number;
}

export interface SalesReportResponse {
  date_from: string;
  date_to: string;
  currency_code: string;
  currency_symbol: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  overview: ReportOverview;
  refunds: {
    count: number;
    amount: number;
    details: Array<{ method: string; count: number; amount: number }>;
  };
  cash_online: {
    cash: { count: number; amount: number; percentage: number };
    online: { count: number; amount: number; percentage: number };
  };
  payment_methods: PaymentBreakdownItem[];
  tax_summary: TaxSummary;
  daily_trend: Array<{
    date: string;
    revenue: number;
    orders: number;
    tax: number;
    discount: number;
  }>;
  top_items: Array<{
    name: string;
    quantity_sold: number;
    revenue: number;
    order_count: number;
  }>;
  categories: Array<{
    name: string;
    quantity_sold: number;
    revenue: number;
  }>;
}

export interface FiscalReportResponse {
  date_from: string;
  date_to: string;
  generated_at: string;
  merchant: {
    name: string;
    currency_code: string;
    currency_symbol: string;
  };
  fiscal_summary: {
    gross_sales: number;
    net_sales: number;
    sales_before_tax: number;
    taxable_sales: number;
    sales_including_tax: number;
    sales_excluding_tax: number;
    tax_collected: number;
    tax_label: string;
    tax_rate: number;
    tax_components: Array<{ name: string; rate: number }>;
    tax_enabled: boolean;
    discounts: number;
    discount_breakdown: Array<{ type: string; count: number; amount: number }>;
    service_charge: number;
    refunds: number;
    refund_tax: number;
    refund_count: number;
    cancelled_orders: number;
    cancelled_amount: number;
    total_transactions: number;
    total_orders: number;
    avg_order_value: number;
  };
  payment_breakdown: {
    cash: number;
    card: number;
    bank_qr: number;
    mobile_wallet: number;
    credit: number;
    debit: number;
    other: number;
    online_total: number;
    methods: PaymentBreakdownItem[];
  };
  cash_summary: {
    cash_sales: number;
    cash_refunds: number;
    net_cash: number;
    payins: number;
    payouts: number;
    cash_drops: number;
  };
  online_summary: {
    online_sales: number;
    online_refunds: number;
    net_online: number;
    card: number;
    bank_qr: number;
    mobile_wallet: number;
  };
  daily_trend: Array<{
    date: string;
    revenue: number;
    orders: number;
    tax: number;
    discount: number;
    subtotal: number;
  }>;
}

export interface PaymentAnalyticsResponse {
  date_from: string;
  date_to: string;
  currency_code: string;
  currency_symbol: string;
  overview: { total_sales: number; total_orders: number };
  cash: {
    count: number;
    amount: number;
    average: number;
    percentage: number;
    refunds: number;
    net: number;
  };
  online: {
    count: number;
    amount: number;
    average: number;
    percentage: number;
    refunds: number;
    net: number;
  };
  methods: PaymentBreakdownItem[];
}

export interface ItemAnalyticsResponse {
  date_from: string;
  date_to: string;
  currency_code: string;
  currency_symbol: string;
  total_items_sold: number;
  total_revenue: number;
  items: Array<{
    name: string;
    category: string;
    quantity_sold: number;
    revenue: number;
    order_count: number;
    payment_breakdown: Array<{ method: string; count: number; amount: number }>;
  }>;
  categories: Array<{
    name: string;
    quantity_sold: number;
    revenue: number;
    item_count: number;
  }>;
  available_categories: string[];
}

export interface EnhancedAnalyticsResponse {
  date_from: string;
  date_to: string;
  currency_code: string;
  currency_symbol: string;
  tax_enabled: boolean;
  tax_label: string;
  tax_rate: number;
  overview: {
    total_sales: number;
    net_sales: number;
    total_orders: number;
    total_customers: number;
    avg_order_value: number;
    total_tax: number;
    total_discount: number;
    cash_collected: number;
    online_collected: number;
    refunds: number;
    total_items_sold: number;
    cancelled_orders: number;
  };
  daily_trend: Array<{ date: string; revenue: number; orders: number }>;
  top_items: Array<{ name: string; quantity_sold: number; revenue: number }>;
  payment_methods: Array<{ method: string; count: number; revenue: number }>;
}

export interface ReportHistoryItem {
  id: number;
  report_name: string;
  report_type: string;
  date_from: string | null;
  date_to: string | null;
  format: string;
  generated_by: string | null;
  created_at: string;
}

function qs(params?: Record<string, any>): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

export const reportsApi = {
  sales: (params?: SalesReportParams) =>
    djangoFetch<SalesReportResponse>(
      apiUrl(`/pos/reports/sales/${qs(params)}`),
      { headers: authHeaders() }
    ),

  fiscal: (params?: ReportDateParams) =>
    djangoFetch<FiscalReportResponse>(
      apiUrl(`/pos/reports/fiscal/${qs(params)}`),
      { headers: authHeaders() }
    ),

  items: (params?: ReportDateParams & { payment_method?: string; category?: string }) =>
    djangoFetch<ItemAnalyticsResponse>(
      apiUrl(`/pos/reports/items/${qs(params)}`),
      { headers: authHeaders() }
    ),

  payments: (params?: ReportDateParams) =>
    djangoFetch<PaymentAnalyticsResponse>(
      apiUrl(`/pos/reports/payments/${qs(params)}`),
      { headers: authHeaders() }
    ),

  analytics: (params?: ReportDateParams) =>
    djangoFetch<EnhancedAnalyticsResponse>(
      apiUrl(`/pos/reports/analytics/${qs(params)}`),
      { headers: authHeaders() }
    ),

  history: () =>
    djangoFetch<ReportHistoryItem[]>(apiUrl("/pos/reports/history/"), {
      headers: authHeaders(),
    }),

  recordExport: (data: {
    report_name: string;
    report_type: string;
    date_from?: string;
    date_to?: string;
    format: string;
    filters?: Record<string, any>;
  }) =>
    djangoFetch<{ id: number; message: string }>(apiUrl("/pos/reports/record-export/"), {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify(data),
    }),

  exportCsv: async (params?: ReportDateParams & { type?: string }) => {
    const url = apiUrl(`/pos/reports/export/csv/${qs(params)}`);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || data?.error || `Export failed: ${res.status}`);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${params?.type || "report"}_${params?.date_from || ""}_${params?.date_to || ""}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  exportPdf: async (params?: ReportDateParams & { type?: string }) => {
    const url = apiUrl(`/pos/reports/export/pdf/${qs(params)}`);
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || data?.error || `Export failed: ${res.status}`);
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${params?.type || "report"}_${params?.date_from || ""}_${params?.date_to || ""}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};
