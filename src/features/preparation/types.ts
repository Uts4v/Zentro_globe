// src/features/preparation/types.ts

export type PreparationStatus = "pending" | "preparing" | "ready" | "cancelled";

export interface PreparationArea {
  id: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface PreparationOrderItem {
  id: number;
  name: string;
  quantity: number;
  price: string;
  subtotal: string;
  notes: string;
  preparation_status: PreparationStatus;
  preparation_started_at: string | null;
  preparation_ready_at: string | null;
  started_by: string | null;
  ready_by: string | null;
}

export interface PreparationOrder {
  id: number;
  uuid: string;
  order_number: string;
  order_type: string;
  fulfillment_type: string;
  table_name: string;
  table_number: number | null;
  customer_name: string | null;
  status: string;
  payment_status: string;
  notes: string;
  area_status: PreparationStatus | "pending";
  items: PreparationOrderItem[];
  created_at: string;
  elapsed_seconds: number;
}

export interface PreparationAreaOrdersResponse {
  area: {
    id: number;
    name: string;
    color: string;
  };
  orders: PreparationOrder[];
  active_count: number;
}

export interface PreparationSettings {
  preparation_routing_enabled: boolean;
  areas: PreparationArea[];
  stats: {
    total_menu_items: number;
    assigned_items: number;
    unassigned_items: number;
  };
}

export interface StaffAreaAssignment {
  area_id: number;
  area_name: string;
}

// ── Staff Shifts (KDS clock-in/out) ─────────────────────────────────────────

export type StaffShiftStatus = "active" | "closed";

export interface StaffShiftArea {
  preparation_area_id: number;
  area_name: string;
}

export interface StaffShift {
  id: string;
  worker: string;
  worker_name: string;
  worker_role: string;
  status: StaffShiftStatus;
  areas: StaffShiftArea[];
  area_ids: number[];
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  opened_from_device_id: string;
}

export interface ActiveStaffShiftResponse {
  shift: StaffShift | null;
}

// Extended MenuItem to include preparation fields
export interface MenuItemWithPreparation {
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
  preparation_area: number | null;
  preparation_area_name?: string;
  requires_preparation: boolean;
  created_at: string;
  updated_at: string;
}
