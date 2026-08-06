// src/features/preparation/query-keys.ts

export const preparationKeys = {
  all: ["preparation"] as const,
  settings: () => [...preparationKeys.all, "settings"] as const,
  areas: () => [...preparationKeys.all, "areas"] as const,
  areaOrders: (areaId: number, status?: string) =>
    [...preparationKeys.all, "area-orders", areaId, status ?? "active"] as const,
  menuItems: () => [...preparationKeys.all, "menu-items"] as const,
  staffAreas: (workerId: string) => [...preparationKeys.all, "staff-areas", workerId] as const,
  staffShift: (workerId: string) => [...preparationKeys.all, "staff-shift", workerId] as const,
  staffShifts: (status?: string) =>
    [...preparationKeys.all, "staff-shifts", status ?? "active"] as const,
};
