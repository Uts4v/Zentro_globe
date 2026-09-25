// src/lib/api/inventory.ts
// Zentro Inventory & Stock Management — /api/inventory/*
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";

// ── Types (mirrors backend serializers) ───────────────────────────────────────

export type InventoryStatus = "HEALTHY" | "LOW" | "CRITICAL" | "OUT" | "OVERSTOCK";

export interface InventoryUnit {
  id: number;
  code: string;
  name: string;
  kind: "WEIGHT" | "VOLUME" | "COUNT";
  factor_to_base: string;
  is_base: boolean;
}

export interface InventoryCategory {
  id: number;
  name: string;
  display_order: number;
  is_default: boolean;
  is_active: boolean;
  item_count: number;
}

export interface InventoryLocation {
  id: number;
  name: string;
  display_order: number;
  is_default: boolean;
  is_active: boolean;
}

/** Selling one unit of the menu item consumes `quantity_per_unit` base units (dine-in). */
export interface InventoryMenuLink {
  id: number;
  menu_item: number;
  menu_item_name: string;
  quantity_per_unit: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  item_type: "INGREDIENT" | "PREPARED" | "DIRECT_SALE" | "SUPPLY";
  category: number;
  category_name: string;
  default_location: number | null;
  location_name: string;
  base_unit: number;
  base_unit_code: string;
  preferred_display_unit: number | null;
  display_unit_code: string;
  purchase_unit_label: string;
  purchase_unit_conversion: string | null;
  sku: string;
  barcode: string;
  description: string;
  active: boolean;
  archived: boolean;
  par_level: string | null;
  reorder_point: string | null;
  critical_level: string | null;
  primary_supplier: number | null;
  supplier_name: string;
  count_schedule: number | null;
  last_count_at: string | null;
  next_count_due: string | null;
  last_received_at: string | null;
  current_stock: string;
  total_stock: string;
  status: InventoryStatus;
  suggested_order: string;
  stock_value: string;
  avg_cost: string | null;
  balance_count: number;
  menu_links: InventoryMenuLink[];
}

export interface Paged<T> {
  results: T[];
  count: number;
  [key: string]: unknown;
}

export interface InventoryMovement {
  id: number;
  movement_type: string;
  item: string;
  location_name: string;
  quantity_change: string;
  unit_code: string;
  source_type: string;
  source_id: string;
  reason: string;
  note: string;
  balance_before: string;
  balance_after: string;
  unit_cost: string | null;
  performed_by_name: string;
  created_at: string;
}

export interface WasteRecord {
  id: number;
  inventory_item: number;
  item_name: string;
  location: number | null;
  location_name: string;
  quantity: string;
  unit_code: string;
  reason: string;
  custom_reason: string;
  note: string;
  per_unit_cost: string | null;
  performed_by_name: string;
  created_at: string;
}

export interface Adjustment {
  id: number;
  inventory_item: number;
  item_name: string;
  location: number | null;
  location_name: string;
  quantity_delta: string;
  unit_code: string;
  reason: string;
  note: string;
  approved: boolean;
  performed_by_name: string;
  created_at: string;
}

export interface ReceivingLine {
  id: number;
  inventory_item: number;
  item_name: string;
  purchase_unit_label: string;
  quantity_purchased: string;
  base_quantity: string;
  unit_cost: string | null;
  line_total: string;
}

export interface Receiving {
  id: number;
  receipt_number: string;
  supplier: number | null;
  supplier_name: string;
  purchase_order: number | null;
  location: number | null;
  location_name: string;
  reference: string;
  note: string;
  total_value: string;
  received_by_name: string;
  received_at: string;
  created_at: string;
  lines: ReceivingLine[];
}

export interface TransferLine {
  id: number;
  inventory_item: number;
  item_name: string;
  quantity: string;
}

export interface Transfer {
  id: number;
  from_location: number | null;
  from_name: string;
  to_location: number | null;
  to_name: string;
  status: string;
  note: string;
  created_by_name: string;
  completed_at: string | null;
  created_at: string;
  lines: TransferLine[];
}

export interface CountLine {
  id: number;
  inventory_item: number;
  item_name: string;
  location: number | null;
  location_name: string;
  book_quantity: string;
  physical_quantity: string | null;
  difference: string | null;
  previous_count_at: string | null;
  note: string;
  unit_code: string;
}

export interface StockCount {
  id: number;
  name: string;
  count_type: string;
  location: number | null;
  location_name: string;
  status: string;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  started_by_name: string;
  submitted_by_name: string;
  approved_by_name: string;
  note: string;
  created_at: string;
  lines: CountLine[];
  line_count: number;
  counted_count: number;
}

export interface SupplierItemMapping {
  id: number;
  inventory_item: number;
  item_name: string;
  supplier_sku: string;
  purchase_unit_label: string;
  purchase_unit_conversion: string | null;
  latest_unit_cost: string | null;
  preferred: boolean;
  minimum_quantity: string | null;
  lead_time_days: number | null;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  lead_time_days: number | null;
  minimum_order: string | null;
  payment_terms: string;
  notes: string;
  is_active: boolean;
  archived: boolean;
  item_mappings: SupplierItemMapping[];
}

export interface PurchaseOrderLine {
  id: number;
  inventory_item: number;
  item_name: string;
  purchase_unit_label: string;
  purchase_unit_conversion: string | null;
  quantity: string;
  unit_cost: string;
  received_quantity: string;
  line_total: string;
  remaining: string;
}

export interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier: number;
  supplier_name: string;
  status: string;
  delivery_location: number;
  delivery_location_name: string;
  expected_date: string | null;
  notes: string;
  total_amount: string;
  created_by_name: string;
  created_at: string;
  lines: PurchaseOrderLine[];
}

export interface InventoryOverview {
  inventory_value: string;
  low_stock_count: number;
  out_of_stock_count: number;
  overstock_count: number;
  counts_due: number;
  open_purchase_orders: number;
  needs_attention: {
    id: number;
    name: string;
    category: string;
    location: string;
    available: string;
    unit: string;
    status: InventoryStatus;
    par: string | null;
    reorder_point: string | null;
    next_count_due: string | null;
    suggested_order: string;
  }[];
  recent_movements: {
    id: number;
    movement_type: string;
    quantity_change: string;
    item: string;
    location: string;
    reason: string;
    performed_by: string;
    created_at: string;
  }[];
  counts_due_list: {
    item: string;
    category: string;
    due: string;
    label: string;
  }[];
}

export interface InventoryRoot {
  is_configured: boolean;
  item_count: number;
  count_approval_required: boolean;
  permissions: Record<string, boolean>;
}

export interface InventorySettings {
  require_count_approval: boolean;
  require_adjustment_approval: boolean;
  prevent_negative_stock: boolean;
}

export interface AuditLogEntry {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  user_name: string;
  created_at: string;
}

export interface CountSchedule {
  id: number;
  name: string;
  scope_type: string;
  item: number | null;
  category: number | null;
  location: number | null;
  frequency_type: string;
  frequency_days: number | null;
  next_due_at: string | null;
  last_run_at: string | null;
  enabled: boolean;
  scope_label: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

function headers(json = false): HeadersInit {
  return authHeaders(json);
}

export const inventoryApi = {
  root: () => djangoFetch<InventoryRoot>(apiUrl("/inventory/"), { headers: headers() }),

  overview: () =>
    djangoFetch<InventoryOverview>(apiUrl("/inventory/overview/"), { headers: headers() }),

  items: (params: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<InventoryItem>>(apiUrl(`/inventory/items/${suffix}`), {
      headers: headers(),
    });
  },

  itemDetail: (id: number) =>
    djangoFetch<InventoryItem>(apiUrl(`/inventory/items/${id}/`), { headers: headers() }),

  createItem: (payload: Record<string, unknown>) =>
    djangoFetch<InventoryItem>(apiUrl("/inventory/items/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  patchItem: (id: number, payload: Record<string, unknown>) =>
    djangoFetch<InventoryItem>(apiUrl(`/inventory/items/${id}/`), {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  archiveItem: (id: number) =>
    djangoFetch<{ ok: boolean }>(apiUrl(`/inventory/items/${id}/archive/`), {
      method: "POST",
      headers: headers(),
    }),

  itemMovements: (id: number, params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<InventoryMovement>>(
      apiUrl(`/inventory/items/${id}/movements/${suffix}`),
      { headers: headers() },
    );
  },

  movements: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<InventoryMovement>>(apiUrl(`/inventory/movements/${suffix}`), {
      headers: headers(),
    });
  },

  reverseMovement: (id: number) =>
    djangoFetch<InventoryMovement>(apiUrl(`/inventory/movements/${id}/reversal/`), {
      method: "POST",
      headers: headers(),
    }),

  waste: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<WasteRecord>>(apiUrl(`/inventory/waste/${suffix}`), {
      headers: headers(),
    });
  },

  recordWaste: (payload: Record<string, unknown>) =>
    djangoFetch<WasteRecord>(apiUrl("/inventory/waste/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  adjustments: () =>
    djangoFetch<Paged<Adjustment>>(apiUrl("/inventory/adjustments/"), { headers: headers() }),

  createAdjustment: (payload: Record<string, unknown>) =>
    djangoFetch<Adjustment>(apiUrl("/inventory/adjustments/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  receiving: () =>
    djangoFetch<Paged<Receiving>>(apiUrl("/inventory/receiving/"), { headers: headers() }),

  receivingDetail: (id: number) =>
    djangoFetch<Receiving>(apiUrl(`/inventory/receiving/${id}/`), { headers: headers() }),

  createReceiving: (payload: Record<string, unknown>) =>
    djangoFetch<Receiving>(apiUrl("/inventory/receiving/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  transfers: () =>
    djangoFetch<Paged<Transfer>>(apiUrl("/inventory/transfers/"), { headers: headers() }),

  createTransfer: (payload: Record<string, unknown>) =>
    djangoFetch<Transfer>(apiUrl("/inventory/transfers/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  completeTransfer: (id: number, idempotencyKey?: string) =>
    djangoFetch<Transfer>(apiUrl(`/inventory/transfers/${id}/complete/`), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ idempotency_key: idempotencyKey ?? undefined }),
    }),

  cancelTransfer: (id: number) =>
    djangoFetch<Transfer>(apiUrl(`/inventory/transfers/${id}/cancel/`), {
      method: "POST",
      headers: headers(),
    }),

  counts: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<StockCount>>(apiUrl(`/inventory/counts/${suffix}`), {
      headers: headers(),
    });
  },

  countDetail: (id: number) =>
    djangoFetch<StockCount>(apiUrl(`/inventory/counts/${id}/`), { headers: headers() }),

  createCount: (payload: Record<string, unknown>) =>
    djangoFetch<StockCount>(apiUrl("/inventory/counts/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  upsertCountLine: (id: number, payload: Record<string, unknown>) =>
    djangoFetch<CountLine>(apiUrl(`/inventory/counts/${id}/lines/`), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  submitCount: (id: number) =>
    djangoFetch<StockCount>(apiUrl(`/inventory/counts/${id}/submit/`), {
      method: "POST",
      headers: headers(),
    }),

  approveCount: (id: number) =>
    djangoFetch<StockCount>(apiUrl(`/inventory/counts/${id}/approve/`), {
      method: "POST",
      headers: headers(),
    }),

  cancelCount: (id: number) =>
    djangoFetch<StockCount>(apiUrl(`/inventory/counts/${id}/cancel/`), {
      method: "POST",
      headers: headers(),
    }),

  categories: () =>
    djangoFetch<InventoryCategory[]>(apiUrl("/inventory/categories/"), { headers: headers() }),

  locations: () =>
    djangoFetch<InventoryLocation[]>(apiUrl("/inventory/locations/"), { headers: headers() }),

  units: () => djangoFetch<InventoryUnit[]>(apiUrl("/inventory/units/"), { headers: headers() }),

  schedules: () =>
    djangoFetch<CountSchedule[]>(apiUrl("/inventory/schedules/"), { headers: headers() }),

  createSchedule: (payload: Record<string, unknown>) =>
    djangoFetch<CountSchedule>(apiUrl("/inventory/schedules/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  suppliers: (activeOnly = true) =>
    djangoFetch<Supplier[]>(apiUrl(`/inventory/suppliers/?active=${activeOnly ? 1 : 0}`), {
      headers: headers(),
    }),

  createSupplier: (payload: Record<string, unknown>) =>
    djangoFetch<Supplier>(apiUrl("/inventory/suppliers/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  patchSupplier: (id: number, payload: Record<string, unknown>) =>
    djangoFetch<Supplier>(apiUrl(`/inventory/suppliers/${id}/`), {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  archiveSupplier: (id: number) =>
    djangoFetch<{ ok: boolean }>(apiUrl(`/inventory/suppliers/${id}/`), {
      method: "DELETE",
      headers: headers(),
    }),

  mapSupplierItem: (id: number, payload: Record<string, unknown>) =>
    djangoFetch<Supplier>(apiUrl(`/inventory/suppliers/${id}/mappings/`), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  purchaseOrders: (params: Record<string, string | undefined> = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v) qs.set(k, v);
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return djangoFetch<Paged<PurchaseOrder>>(apiUrl(`/inventory/purchase-orders/${suffix}`), {
      headers: headers(),
    });
  },

  createPurchaseOrder: (payload: Record<string, unknown>) =>
    djangoFetch<PurchaseOrder>(apiUrl("/inventory/purchase-orders/"), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  receivePurchaseOrder: (id: number, payload: Record<string, unknown>) =>
    djangoFetch<PurchaseOrder>(apiUrl(`/inventory/purchase-orders/${id}/receive/`), {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),

  cancelPurchaseOrder: (id: number) =>
    djangoFetch<PurchaseOrder>(apiUrl(`/inventory/purchase-orders/${id}/`), {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify({ status: "CANCELLED" }),
    }),

  report: (report: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams({ report, ...params });
    return djangoFetch<Record<string, unknown>>(apiUrl(`/inventory/reports/?${qs.toString()}`), {
      headers: headers(),
    });
  },

  audit: () =>
    djangoFetch<Paged<AuditLogEntry>>(apiUrl("/inventory/audit/"), { headers: headers() }),

  settings: () =>
    djangoFetch<InventorySettings>(apiUrl("/inventory/settings/"), { headers: headers() }),

  patchSettings: (payload: Partial<InventorySettings>) =>
    djangoFetch<InventorySettings>(apiUrl("/inventory/settings/"), {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify(payload),
    }),
};
