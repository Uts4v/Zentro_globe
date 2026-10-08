// src/lib/api/team.ts
// Team: employees, roles & permissions, staff mode, and table areas.
import { apiUrl, djangoFetch } from "@/lib/django-api-base";
import { djangoHeaders as authHeaders } from "@/lib/auth";
import type { MerchantTable } from "./types";

export interface TableArea {
  id: number;
  name: string;
  display_order: number;
  is_active: boolean;
  table_count: number;
  tables: MerchantTable[];
}

export interface BulkTables {
  table_count: number;
  prefix: string;
  start_number: number;
  seats: number;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: { code: string; label: string; hint: string }[];
}

export interface StaffRole {
  id: number;
  name: string;
  description: string;
  is_system: boolean;
  is_admin: boolean;
  is_active: boolean;
  permissions: string[];
  permission_count: number;
  employee_count: number;
}

export interface Employee {
  id: string;
  display_name: string;
  staff_code?: string;
  phone?: string;
  email?: string;
  /** Plain PIN, returned by the team endpoints so the merchant page can show it. */
  pin?: string;
  role: string;
  is_active: boolean;
  is_deleted?: boolean;
  staff_role: number | null;
  role_name: string;
  permissions: string[];
  area_ids: number[];
}

export interface Access {
  mode: "admin" | "staff";
  worker: { id: string; name: string } | null;
  role: { id?: number; name: string; is_admin: boolean };
  permissions: string[];
  /** Dining areas the employee works in; null = all areas. */
  area_ids: number[] | null;
  staff_mode_available: boolean;
  business_name: string;
}

export interface StaffPickerWorker {
  id: string;
  name: string;
  staff_code?: string;
  role_name: string;
  can_unlock: boolean;
}

const get = <T>(path: string) => djangoFetch<T>(apiUrl(path), { headers: authHeaders() });
const send = <T>(path: string, method: string, body?: unknown) =>
  djangoFetch<T>(apiUrl(path), {
    method,
    headers: authHeaders(true),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const areaApi = {
  list: () => get<{ areas: TableArea[]; unassigned: MerchantTable[] }>("/merchants/table-areas/"),
  create: (name: string, bulk?: Partial<BulkTables>) =>
    send<TableArea>("/merchants/table-areas/", "POST", { name, ...bulk }),
  update: (id: number, patch: Partial<Pick<TableArea, "name" | "display_order" | "is_active">>) =>
    send<TableArea>(`/merchants/table-areas/${id}/`, "PATCH", patch),
  remove: (id: number) => send<void>(`/merchants/table-areas/${id}/`, "DELETE"),
  addTables: (id: number, bulk: BulkTables) =>
    send<MerchantTable[]>(`/merchants/table-areas/${id}/tables/`, "POST", bulk),
  reorder: (order: number[]) =>
    send<{ ok: boolean }>("/merchants/table-areas/reorder/", "POST", { order }),
};

export const teamApi = {
  me: () => get<Access>("/pos/staff/me/"),
  staffWorkers: () => get<StaffPickerWorker[]>("/pos/staff/workers/"),
  startStaffSession: (
    payloadOrWorkerId: string | { worker_id?: string; staff_code?: string; pin: string },
    pin?: string,
  ) => {
    const payload =
      typeof payloadOrWorkerId === "string"
        ? { worker_id: payloadOrWorkerId, pin: pin || "" }
        : payloadOrWorkerId;
    return send<Access & { token: string }>("/pos/staff/session/", "POST", payload);
  },
  endStaffSession: (payload: { password?: string; worker_id?: string; pin?: string }) =>
    send<{ ok: boolean }>("/pos/staff/session/end/", "POST", payload),

  roles: () => get<{ roles: StaffRole[]; permission_groups: PermissionGroup[] }>("/pos/roles/"),
  createRole: (payload: {
    name: string;
    description?: string;
    clone_from?: number;
    permissions?: string[];
  }) => send<StaffRole>("/pos/roles/", "POST", payload),
  updateRole: (
    id: number,
    payload: { name?: string; description?: string; permissions?: string[] },
  ) => send<StaffRole>(`/pos/roles/${id}/`, "PATCH", payload),
  deleteRole: (id: number) => send<void>(`/pos/roles/${id}/`, "DELETE"),

  employees: () => get<Employee[]>("/pos/workers/team/"),
  createEmployee: (payload: {
    display_name: string;
    pin: string;
    staff_code?: string;
    phone?: string;
    email?: string;
    staff_role?: number;
    area_ids?: number[];
    is_active?: boolean;
    permissions?: string[];
  }) => send<Employee>("/pos/workers/team/", "POST", payload),
  updateEmployee: (
    id: string,
    payload: Partial<{
      display_name: string;
      pin: string;
      staff_code: string;
      phone: string;
      email: string;
      staff_role: number;
      area_ids: number[];
      is_active: boolean;
      permissions: string[];
    }>,
  ) => send<Employee>(`/pos/workers/team/${id}/`, "PATCH", payload),
  deleteEmployee: (id: string) => send<void>(`/pos/workers/team/${id}/`, "DELETE"),
};
