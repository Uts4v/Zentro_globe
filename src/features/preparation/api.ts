// src/features/preparation/api.ts
import { apiUrl, djangoFetch, tokenStore } from "@/lib/django-api-base";
import type {
  PreparationArea,
  PreparationAreaOrdersResponse,
  PreparationSettings,
  StaffAreaAssignment,
} from "./types";

const headers = () => ({
  Authorization: `Bearer ${tokenStore.getAccess()}`,
  "Content-Type": "application/json",
});

// ── Settings ─────────────────────────────────────────────────────────────────

export const getPreparationSettings = () =>
  djangoFetch<PreparationSettings>(apiUrl("/orders/preparation-settings/"), {
    headers: headers(),
  });

export const updatePreparationSettings = (data: {
  preparation_routing_enabled: boolean;
}) =>
  djangoFetch<{ preparation_routing_enabled: boolean }>(
    apiUrl("/orders/preparation-settings/"),
    {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(data),
    }
  );

// ── Areas ────────────────────────────────────────────────────────────────────

export const listPreparationAreas = () =>
  djangoFetch<PreparationArea[]>(apiUrl("/orders/preparation-areas/"), {
    headers: headers(),
  });

export const createPreparationArea = (data: {
  name: string;
  display_order?: number;
  color?: string;
}) =>
  djangoFetch<PreparationArea>(apiUrl("/orders/preparation-areas/"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const updatePreparationArea = (
  id: number,
  data: Partial<{
    name: string;
    is_default: boolean;
    is_active: boolean;
    display_order: number;
    color: string;
  }>
) =>
  djangoFetch<PreparationArea>(apiUrl(`/orders/preparation-areas/${id}/`), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(data),
  });

export const deletePreparationArea = (id: number) =>
  djangoFetch<{ message?: string; deactivated?: boolean }>(
    apiUrl(`/orders/preparation-areas/${id}/`),
    {
      method: "DELETE",
      headers: headers(),
    }
  );

export const setupCafePreset = () =>
  djangoFetch<PreparationArea[]>(
    apiUrl("/orders/preparation-areas/setup-cafe/"),
    {
      method: "POST",
      headers: headers(),
    }
  );

// ── Bulk Assign ──────────────────────────────────────────────────────────────

export const bulkAssignMenuItems = (data: {
  menu_item_ids: number[];
  preparation_area_id: number | null;
  requires_preparation: boolean;
}) =>
  djangoFetch<{ updated: number; area: string | null; requires_preparation: boolean }>(
    apiUrl("/orders/preparation-areas/bulk-assign/"),
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(data),
    }
  );

// ── Staff Assignment ─────────────────────────────────────────────────────────

export const getStaffPreparationAreas = (workerId: string) =>
  djangoFetch<StaffAreaAssignment[]>(
    apiUrl(`/orders/staff/${workerId}/preparation-areas/`),
    { headers: headers() }
  );

export const setStaffPreparationAreas = (
  workerId: string,
  areaIds: number[]
) =>
  djangoFetch<{ assigned: number }>(
    apiUrl(`/orders/staff/${workerId}/preparation-areas/`),
    {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ area_ids: areaIds }),
    }
  );

// ── Area Orders (KDS) ───────────────────────────────────────────────────────

export const getAreaOrders = (
  areaId: number,
  status?: "active" | "ready" | "all"
) => {
  const qs = status ? `?status=${status}` : "";
  return djangoFetch<PreparationAreaOrdersResponse>(
    apiUrl(`/orders/preparation-areas/${areaId}/orders/${qs}`),
    { headers: headers() }
  );
};

// ── Status Actions ───────────────────────────────────────────────────────────

export const preparationAction = (
  areaId: number,
  action: "start" | "ready" | "cancel",
  data: { order_id: number; worker_id?: string }
) =>
  djangoFetch<{
    order_id: number;
    area_id: number;
    action: string;
    status: string;
    items_updated: number;
  }>(apiUrl(`/orders/preparation-areas/${areaId}/action/${action}/`), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(data),
  });

// ── Menu Items (with preparation fields) ─────────────────────────────────────

export const getMerchantMenuItems = () =>
  djangoFetch<
    Array<{
      id: number;
      name: string;
      category: string;
      price: string;
      emoji: string;
      is_available: boolean;
      preparation_area: number | null;
      requires_preparation: boolean;
    }>
  >(apiUrl("/merchants/menu-items/my-items/"), {
    headers: headers(),
  });

export const updateMenuItemPreparation = (
  itemId: number,
  data: {
    preparation_area: number | null;
    requires_preparation: boolean;
  }
) =>
  djangoFetch<{ id: number }>(apiUrl(`/merchants/menu-items/${itemId}/`), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(data),
  });
