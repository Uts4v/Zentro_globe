// src/lib/api/finance.ts
// Merchant Accounts: cash, online payments, bank, supplier payments, salaries.
// Money is always a decimal string from the server; never do float maths on it
// beyond display.
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

export type EntryKind =
  | "expense"
  | "supplier_payment"
  | "salary_payment"
  | "other_income"
  | "bank_deposit"
  | "bank_withdrawal";

export type EntryMethod = "cash" | "bank_transfer" | "online" | "cheque" | "other";

export interface Period {
  from: string;
  to: string;
}

export interface MoneyEntry {
  id: number;
  kind: EntryKind;
  kind_label: string;
  label: string;
  amount: string;
  payment_method: EntryMethod;
  payment_method_label: string;
  date: string;
  category: string;
  reference: string;
  note: string;
  supplier_id: number | null;
  supplier_name: string;
  receiving_id: number | null;
  salary_id: number | null;
  worker_name: string;
  created_by: string;
  created_at: string;
  is_void: boolean;
  voided_by: string;
  void_reason: string;
}

export interface FinanceSummary {
  date_from: string;
  date_to: string;
  currency_symbol: string;
  sales: {
    total: string;
    cash: string;
    online: string;
    on_account: string;
    payments: number;
    orders: number;
    by_method: { key: string; label: string; amount: string }[];
  };
  money_out: {
    refunds: string;
    expenses: string;
    pos_payouts: string;
    supplier_payments: string;
    salaries: string;
    total: string;
  };
  other_income: string;
  discounts: string;
  free_items_value: string;
  free_items_count: number;
  tax_collected: string;
  net: string;
  bank_deposits: string;
  bank_withdrawals: string;
  balances: { cash: string; bank: string; total: string };
  owed: { suppliers: string; salaries: string };
  daily: { date: string; sales: number; out: number }[];
}

export interface BookRow {
  date: string;
  label: string;
  detail: string;
  money_in: string;
  money_out: string;
  source: "sales" | "refund" | "pos_cash" | "entry";
  entry_id: number | null;
}

export interface Book {
  account: "cash" | "bank";
  date_from: string;
  date_to: string;
  opening_balance: string;
  money_in: string;
  money_out: string;
  closing_balance: string;
  current_balance: string;
  rows: BookRow[];
}

export interface OnlinePayments {
  received: string;
  refunded: string;
  net: string;
  by_method: { key: string; label: string; received: string; refunded: string; count: number }[];
  rows: {
    id: string;
    datetime: string;
    method: string;
    method_label: string;
    amount: string;
    is_refund: boolean;
    reference: string;
    order_id: number | null;
    worker: string;
  }[];
  total_rows: number;
  truncated: boolean;
}

export interface SupplierRow {
  id: number;
  name: string;
  phone: string;
  payment_terms: string;
  purchases: number;
  purchase_amount: string;
  amount_paid: string;
  outstanding: string;
  last_purchase: string | null;
  last_payment: string | null;
}

export interface SupplierDetail {
  id: number;
  name: string;
  phone: string;
  payment_terms: string;
  purchase_amount: string;
  amount_paid: string;
  outstanding: string;
  purchases: {
    id: number;
    receipt_number: string;
    reference: string;
    date: string;
    amount: string;
    paid: string;
    outstanding: string;
  }[];
  payments: MoneyEntry[];
}

export interface Salary {
  id: number;
  worker_id: string | null;
  worker_name: string;
  period: string;
  period_label: string;
  amount: string;
  paid: string;
  outstanding: string;
  status: "unpaid" | "partial" | "paid";
  note: string;
  created_by: string;
  payments?: MoneyEntry[];
  last_payment_date?: string | null;
  last_payment_method?: string;
}

export interface FinanceSettings {
  opening_cash: string;
  opening_bank: string;
  opening_date: string | null;
  expense_categories: { key: string; label: string }[];
  payment_methods: { key: EntryMethod; label: string }[];
  can_manage: boolean;
}

export interface NewEntry {
  kind: EntryKind;
  amount: string;
  date?: string;
  payment_method?: EntryMethod;
  category?: string;
  reference?: string;
  note?: string;
  supplier_id?: number;
  receiving_id?: number;
  salary_id?: number;
  /** Stops a double tap or a retry recording the money twice. */
  client_key: string;
}

const qs = (p: Period, extra: Record<string, string> = {}) =>
  new URLSearchParams({ from: p.from, to: p.to, ...extra }).toString();

const get = <T>(path: string) => djangoFetch<T>(apiUrl(path), { headers: authHeaders() });
const send = <T>(path: string, method: string, body?: unknown) =>
  djangoFetch<T>(apiUrl(path), {
    method,
    headers: authHeaders(true),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const financeApi = {
  summary: (p: Period) => get<FinanceSummary>(`/finance/summary/?${qs(p)}`),
  cash: (p: Period) => get<Book>(`/finance/cash/?${qs(p)}`),
  bank: (p: Period) => get<Book>(`/finance/bank/?${qs(p)}`),
  online: (p: Period) => get<OnlinePayments>(`/finance/online/?${qs(p)}`),
  settings: () => get<FinanceSettings>("/finance/settings/"),
  saveSettings: (body: Partial<Pick<FinanceSettings, "opening_cash" | "opening_bank" | "opening_date">>) =>
    send<FinanceSettings>("/finance/settings/", "PUT", body),
  entries: (p: Period, kind: string, includeVoid = false) =>
    get<{ total: string; rows: MoneyEntry[]; truncated: boolean }>(
      `/finance/entries/?${qs(p, { kind, ...(includeVoid ? { include_void: "1" } : {}) })}`,
    ),
  createEntry: (body: NewEntry) => send<MoneyEntry>("/finance/entries/", "POST", body),
  voidEntry: (id: number, reason: string) =>
    send<MoneyEntry>(`/finance/entries/${id}/void/`, "POST", { reason }),
  suppliers: () =>
    get<{ rows: SupplierRow[]; purchase_amount: string; amount_paid: string; outstanding: string }>(
      "/finance/suppliers/",
    ),
  supplier: (id: number) => get<SupplierDetail>(`/finance/suppliers/${id}/`),
  salaries: (month?: string) =>
    get<{ rows: Salary[]; amount: string; paid: string; outstanding: string }>(
      `/finance/salaries/${month ? `?month=${month}` : ""}`,
    ),
  salaryStaff: () =>
    get<{ id: string; name: string; is_active: boolean; last_salary: string | null }[]>(
      "/finance/salaries/staff/",
    ),
  createSalary: (body: { worker_id: string; period: string; amount: string; note?: string }) =>
    send<Salary>("/finance/salaries/", "POST", body),
  updateSalary: (id: number, body: { amount?: string; note?: string }) =>
    send<Salary>(`/finance/salaries/${id}/`, "PATCH", body),
  deleteSalary: (id: number) => send<void>(`/finance/salaries/${id}/`, "DELETE"),
};
