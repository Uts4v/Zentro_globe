// src/lib/api/inventory.ts
// Zentro Inventory & Stock Management — /api/inventory/*
import { apiUrl } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import { staffSession } from "@/lib/staff-session";

// ── Types (mirror backend serializers) ────────────────────────────────────────

export type InventoryStatus = "HEALTHY" | "LOW" | "CRITICAL" | "OUT" | "OVERSTOCK";
export type ItemType = "INGREDIENT" | "PREPARED" | "DIRECT_SALE" | "SUPPLY";
export type InventoryRole = "owner" | "admin" | "manager" | "kitchen" | "bar" | "staff" | "cashier";

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

export interface ItemLocationStock {
  location: number;
  location_name: string;
  on_hand: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  item_type: ItemType;
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
  /** null when the viewer may not see costs */
  stock_value: string | null;
  avg_cost: string | null;
  balance_count: number;
  menu_links: InventoryMenuLink[];
  locations: ItemLocationStock[];
  location_quantity: string | null;
}

export interface PageMeta {
  count: number;
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: number | null;
  previous: number | null;
}

export interface Paged<T> extends PageMeta {
  results: T[];
  [key: string]: unknown;
}

export interface ItemPage extends Paged<InventoryItem> {
  status_counts?: Record<"ALL" | InventoryStatus, number>;
}

export interface InventoryMovement {
  id: number;
  movement_type: string;
  item: string;
  item_id: number;
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
  approved_by_name: string;
  reversal_of: number | null;
  is_reversed: boolean;
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
  reason_label: string;
  custom_reason: string;
  note: string;
  per_unit_cost: string | null;
  performed_by_name: string;
  created_at: string;
  new_stock?: string;
}

export type AdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED";

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
  status: AdjustmentStatus;
  approved: boolean;
  approved_by_name: string;
  performed_by_name: string;
  created_at: string;
  new_stock?: string;
}

export interface ReceivingLine {
  id: number;
  inventory_item: number;
  item_name: string;
  purchase_unit_label: string;
  quantity_purchased: string;
  base_quantity: string;
  unit_code: string;
  unit_cost: string | null;
  line_total: string | null;
}

export interface DeliveryResultLine {
  item_id: number;
  item_name: string;
  added: string;
  unit: string;
  location_name: string;
  new_stock: string;
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
  total_value: string | null;
  received_by_name: string;
  received_at: string;
  created_at: string;
  lines: ReceivingLine[];
  results?: DeliveryResultLine[];
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
  results?: {
    item_name: string;
    quantity: string;
    unit: string;
    from_stock: string;
    to_stock: string;
  }[];
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

export type CountStatus = "DRAFT" | "IN_PROGRESS" | "SUBMITTED" | "APPROVED" | "CANCELLED";

export interface StockCountSummary {
  id: number;
  name: string;
  count_type: string;
  location: number | null;
  location_name: string;
  status: CountStatus;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  started_by_name: string;
  submitted_by_name: string;
  note: string;
  created_at: string;
  line_count: number;
  counted_count: number;
  difference_count: number;
}

export interface StockCount extends Omit<StockCountSummary, "difference_count"> {
  approved_by_name: string;
  lines: CountLine[];
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
  unit_cost: string | null;
  received_quantity: string;
  line_total: string | null;
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
  total_amount: string | null;
  created_by_name: string;
  created_at: string;
  lines: PurchaseOrderLine[];
}

export interface AttentionItem {
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
}

export interface InventoryOverview {
  inventory_value: string | null;
  total_items: number;
  low_stock_count: number;
  very_low_count: number;
  out_of_stock_count: number;
  overstock_count: number;
  attention_total: number;
  counts_due: number;
  open_purchase_orders: number;
  counts_waiting_review: number;
  corrections_waiting: number;
  needs_attention: AttentionItem[];
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
  counts_due_list: { item: string; category: string; due: string; label: string }[];
}

export interface InventoryRoot {
  is_configured: boolean;
  item_count: number;
  role: InventoryRole;
  staff: { id: string; name: string; role: string } | null;
  staff_mode_available: boolean;
  business_name: string;
  permissions: Record<string, boolean>;
  count_approval_required: boolean;
  adjustment_approval_required: boolean;
  prevent_negative_stock: boolean;
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

export interface StaffWorker {
  id: string;
  name: string;
  role: string;
  inventory_role: InventoryRole;
}

export interface ReportColumn {
  key: string;
  label: string;
  numeric: boolean;
}

export interface ReportPage extends PageMeta {
  report: string;
  title: string;
  columns: ReportColumn[];
  results: Record<string, string>[];
  summary: Record<string, string | number>;
  include_cost: boolean;
}

export type ImportMode = "NEW_ITEMS" | "UPDATE_ITEMS" | "STOCK_COUNT";
export type ImportRowStatus = "ready" | "warning" | "error" | "skip";

export interface ImportMessage {
  level: "error" | "warning";
  text: string;
  field: string;
}

export interface ImportRow {
  row: number;
  name: string;
  status: ImportRowStatus;
  action: "create" | "update" | "count" | "skip";
  messages: ImportMessage[];
  match: { id: number; name: string; by: string } | null;
  values: Record<string, string | number>;
  confidence: "high" | "medium" | "low";
  original_text: string;
  needs_review: boolean;
  confirmed: boolean;
  importable: boolean;
  choices?: ("update" | "create")[];
  decision: string;
  raw: Record<string, string>;
  fix: Record<string, string>;
}

export interface ImportOutcome {
  row: number;
  name: string;
  outcome: "imported" | "skipped" | "failed";
  message: string;
}

export interface ImportSummary {
  rows: number;
  ready: number;
  warnings: number;
  errors: number;
  skipped: number;
  importable: number;
  needs_review: number;
  high_confidence: number;
  unreadable: number;
  result?: {
    imported: number;
    skipped: number;
    failed: number;
    opening: number;
    created: number;
    updated: number;
  };
}

export interface ImportSession {
  id: number;
  file_name: string;
  file_type: "CSV" | "PDF";
  import_mode: ImportMode;
  status: "VALIDATING" | "READY" | "IMPORTING" | "COMPLETED" | "FAILED" | "CANCELLED";
  extraction_method: string;
  created_at: string;
  completed_at: string | null;
  summary: ImportSummary;
  rows_total: number;
  rows_imported: number;
  rows_skipped: number;
  rows_failed: number;
  location: number | null;
  stock_count: number | null;
  error: string;
  uploaded_by: string;
  duplicate_of: { id: number; file_name: string; completed_at: string } | null;
  rows?: (ImportRow | ImportOutcome)[];
}

export interface ImportDecision {
  action?: "skip" | "update" | "create" | "";
  confirm?: boolean;
  fix?: Record<string, string>;
}

/** Error thrown by inventory calls; keeps the server's machine code and extras. */
export class InventoryApiError extends Error {
  status: number;
  code?: string;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = typeof data.code === "string" ? data.code : undefined;
    this.data = data;
  }
}

// ── Staff mode ────────────────────────────────────────────────────────────────

export { staffSession };

function headers(json = false): Record<string, string> {
  // authHeaders already carries the staff-mode header when an employee is acting.
  return { ...(authHeaders(json) as Record<string, string>) };
}

function flattenErrors(data: Record<string, unknown>): string {
  const direct = data.detail ?? data.error;
  if (typeof direct === "string") return direct;
  const skip = new Set(["code", "duplicate_of", "previous_import", "quantity", "unit"]);
  const parts: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") {
      parts.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(collect);
    } else if (v && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(collect);
    }
  };
  Object.entries(data)
    .filter(([k]) => !skip.has(k))
    .forEach(([, v]) => collect(v));
  return parts.join(" ") || "Something went wrong. Please try again.";
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(apiUrl(path), {
    cache: "no-store",
    ...rest,
    headers: {
      ...headers(json !== undefined),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = flattenErrors(data);
    if (res.status === 403 && /staff session has ended/i.test(message)) staffSession.set(null);
    throw new InventoryApiError(message, res.status, data);
  }
  return data as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null> = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Download a server-generated file (CSV/PDF) with auth headers. */
export async function downloadInventoryFile(
  path: string,
  params: Record<string, string | number | undefined> = {},
  fallbackName = "zentro-inventory",
) {
  const res = await fetch(apiUrl(path + qs(params)), { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new InventoryApiError(flattenErrors(data), res.status, data);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = match?.[1] || fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type Params = Record<string, string | number | boolean | undefined | null>;

// ── Client ────────────────────────────────────────────────────────────────────

export const inventoryApi = {
  root: () => call<InventoryRoot>("/inventory/"),
  overview: () => call<InventoryOverview>("/inventory/overview/"),

  // Staff mode
  staffWorkers: () => call<StaffWorker[]>("/inventory/staff/workers/"),
  startStaffSession: (worker_id: string, pin: string) =>
    call<{ token: string; staff: { id: string; name: string; role: string }; role: InventoryRole }>(
      "/inventory/staff/session/",
      { method: "POST", json: { worker_id, pin } },
    ),
  endStaffSession: (payload: { password?: string; worker_id?: string; pin?: string }) =>
    call<{ ok: boolean }>("/inventory/staff/session/end/", { method: "POST", json: payload }),

  // Items
  items: (params: Params = {}) => call<ItemPage>(`/inventory/items/${qs(params)}`),
  itemDetail: (id: number) => call<InventoryItem>(`/inventory/items/${id}/`),
  createItem: (payload: Record<string, unknown>) =>
    call<InventoryItem>("/inventory/items/", { method: "POST", json: payload }),
  patchItem: (id: number, payload: Record<string, unknown>) =>
    call<InventoryItem>(`/inventory/items/${id}/`, { method: "PATCH", json: payload }),
  deleteItem: (id: number, clearStock = false) =>
    call<{ ok: boolean; result: "deleted" | "archived" }>(
      `/inventory/items/${id}/${clearStock ? "?clear_stock=1" : ""}`,
      { method: "DELETE" },
    ),
  itemMovements: (id: number, params: Params = {}) =>
    call<Paged<InventoryMovement>>(`/inventory/items/${id}/movements/${qs(params)}`),

  // History
  movements: (params: Params = {}) =>
    call<Paged<InventoryMovement>>(`/inventory/movements/${qs(params)}`),
  reverseMovement: (id: number) =>
    call<InventoryMovement>(`/inventory/movements/${id}/reversal/`, { method: "POST" }),

  // Waste / fixes
  waste: (params: Params = {}) => call<Paged<WasteRecord>>(`/inventory/waste/${qs(params)}`),
  recordWaste: (payload: Record<string, unknown>) =>
    call<WasteRecord>("/inventory/waste/", { method: "POST", json: payload }),
  adjustments: (params: Params = {}) =>
    call<Paged<Adjustment>>(`/inventory/adjustments/${qs(params)}`),
  createAdjustment: (payload: Record<string, unknown>) =>
    call<Adjustment>("/inventory/adjustments/", { method: "POST", json: payload }),
  decideAdjustment: (id: number, decision: "approve" | "reject") =>
    call<Adjustment>(`/inventory/adjustments/${id}/${decision}/`, { method: "POST" }),

  // Deliveries
  receiving: (params: Params = {}) => call<Paged<Receiving>>(`/inventory/receiving/${qs(params)}`),
  createReceiving: (payload: Record<string, unknown>) =>
    call<Receiving>("/inventory/receiving/", { method: "POST", json: payload }),

  // Moves
  transfers: (params: Params = {}) => call<Paged<Transfer>>(`/inventory/transfers/${qs(params)}`),
  createTransfer: (payload: Record<string, unknown>) =>
    call<Transfer>("/inventory/transfers/", { method: "POST", json: payload }),
  completeTransfer: (id: number, idempotencyKey?: string) =>
    call<Transfer>(`/inventory/transfers/${id}/complete/`, {
      method: "POST",
      json: { idempotency_key: idempotencyKey },
    }),
  cancelTransfer: (id: number) =>
    call<Transfer>(`/inventory/transfers/${id}/cancel/`, { method: "POST" }),

  // Counts
  counts: (params: Params = {}) =>
    call<Paged<StockCountSummary>>(`/inventory/counts/${qs(params)}`),
  countDetail: (id: number) => call<StockCount>(`/inventory/counts/${id}/`),
  createCount: (payload: Record<string, unknown>) =>
    call<StockCount>("/inventory/counts/", { method: "POST", json: payload }),
  upsertCountLine: (id: number, payload: { line_id: number; physical_quantity: string | null }) =>
    call<CountLine>(`/inventory/counts/${id}/lines/`, { method: "POST", json: payload }),
  submitCount: (id: number) =>
    call<StockCount>(`/inventory/counts/${id}/submit/`, { method: "POST" }),
  approveCount: (id: number) =>
    call<StockCount>(`/inventory/counts/${id}/approve/`, { method: "POST" }),
  cancelCount: (id: number) =>
    call<StockCountSummary>(`/inventory/counts/${id}/cancel/`, { method: "POST" }),

  // Reference data
  categories: () => call<InventoryCategory[]>("/inventory/categories/"),
  createCategory: (name: string) =>
    call<InventoryCategory>("/inventory/categories/", { method: "POST", json: { name } }),
  patchCategory: (id: number, payload: Partial<InventoryCategory>) =>
    call<InventoryCategory>(`/inventory/categories/${id}/`, { method: "PATCH", json: payload }),
  deleteCategory: (id: number) =>
    call<{ ok: boolean; result: string }>(`/inventory/categories/${id}/`, { method: "DELETE" }),
  locations: () => call<InventoryLocation[]>("/inventory/locations/"),
  createLocation: (name: string) =>
    call<InventoryLocation>("/inventory/locations/", { method: "POST", json: { name } }),
  patchLocation: (id: number, payload: Partial<InventoryLocation>) =>
    call<InventoryLocation>(`/inventory/locations/${id}/`, { method: "PATCH", json: payload }),
  deleteLocation: (id: number) =>
    call<{ ok: boolean; result: string }>(`/inventory/locations/${id}/`, { method: "DELETE" }),
  units: () => call<InventoryUnit[]>("/inventory/units/"),

  // Suppliers & supplier orders
  suppliers: (activeOnly = true) =>
    call<Supplier[]>(`/inventory/suppliers/?active=${activeOnly ? 1 : 0}`),
  createSupplier: (payload: Record<string, unknown>) =>
    call<Supplier>("/inventory/suppliers/", { method: "POST", json: payload }),
  patchSupplier: (id: number, payload: Record<string, unknown>) =>
    call<Supplier>(`/inventory/suppliers/${id}/`, { method: "PATCH", json: payload }),
  archiveSupplier: (id: number) =>
    call<{ ok: boolean }>(`/inventory/suppliers/${id}/`, { method: "DELETE" }),
  mapSupplierItem: (id: number, payload: Record<string, unknown>) =>
    call<Supplier>(`/inventory/suppliers/${id}/mappings/`, { method: "POST", json: payload }),
  purchaseOrders: (params: Params = {}) =>
    call<Paged<PurchaseOrder>>(`/inventory/purchase-orders/${qs(params)}`),
  createPurchaseOrder: (payload: Record<string, unknown>) =>
    call<PurchaseOrder>("/inventory/purchase-orders/", { method: "POST", json: payload }),
  receivePurchaseOrder: (id: number, payload: Record<string, unknown>) =>
    call<PurchaseOrder>(`/inventory/purchase-orders/${id}/receive/`, {
      method: "POST",
      json: payload,
    }),
  cancelPurchaseOrder: (id: number) =>
    call<PurchaseOrder>(`/inventory/purchase-orders/${id}/`, {
      method: "PATCH",
      json: { status: "CANCELLED" },
    }),

  // Reports & exports
  report: (report: string, params: Params = {}) =>
    call<ReportPage>(`/inventory/reports/${qs({ report, ...params })}`),
  download: (
    report: string,
    format: "csv" | "pdf",
    params: Record<string, string | number | undefined> = {},
  ) =>
    downloadInventoryFile(`/inventory/exports/${report}.${format}`, params, `${report}.${format}`),

  // Import
  importTemplate: (kind: "items" | "count", example = false) =>
    downloadInventoryFile(
      "/inventory/import/template/",
      { kind, example: example ? 1 : undefined },
      "zentro_inventory_template.csv",
    ),
  importSessions: () => call<{ results: ImportSession[] }>("/inventory/import/"),
  startImport: (file: File, mode: ImportMode, location?: number | null) => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    if (location) form.append("location", String(location));
    return call<ImportSession>("/inventory/import/", { method: "POST", body: form });
  },
  importSession: (id: number) => call<ImportSession>(`/inventory/import/${id}/`),
  reviewImport: (id: number, decisions: Record<string, ImportDecision>) =>
    call<ImportSession>(`/inventory/import/${id}/review/`, { method: "POST", json: { decisions } }),
  commitImport: (id: number, allowDuplicate = false) =>
    call<ImportSession>(`/inventory/import/${id}/commit/`, {
      method: "POST",
      json: { allow_duplicate: allowDuplicate },
    }),
  cancelImport: (id: number) =>
    call<{ ok: boolean }>(`/inventory/import/${id}/`, { method: "DELETE" }),
  importReport: (id: number) =>
    downloadInventoryFile(`/inventory/import/${id}/report.csv`, {}, `import-${id}.csv`),

  // Audit & settings
  audit: (params: Params = {}) => call<Paged<AuditLogEntry>>(`/inventory/audit/${qs(params)}`),
  settings: () => call<InventorySettings>("/inventory/settings/"),
  patchSettings: (payload: Partial<InventorySettings>) =>
    call<InventorySettings>("/inventory/settings/", { method: "PATCH", json: payload }),
};
