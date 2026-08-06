// src/features/preparation/hooks.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { preparationKeys } from "./query-keys";
import * as prepApi from "./api";
import type { PreparationSettings } from "./types";

// ── Settings ─────────────────────────────────────────────────────────────────

export function usePreparationSettings() {
  return useQuery({
    queryKey: preparationKeys.settings(),
    queryFn: prepApi.getPreparationSettings,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useUpdatePreparationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.updatePreparationSettings,
    onSuccess: (data) => {
      qc.setQueryData<PreparationSettings>(preparationKeys.settings(), (old) =>
        old ? { ...old, preparation_routing_enabled: data.preparation_routing_enabled } : old,
      );
    },
  });
}

// ── Areas ────────────────────────────────────────────────────────────────────

export function usePreparationAreas() {
  return useQuery({
    queryKey: preparationKeys.areas(),
    queryFn: prepApi.listPreparationAreas,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.createPreparationArea,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.areas() });
    },
  });
}

export function useUpdateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: Parameters<typeof prepApi.updatePreparationArea>[1];
    }) => prepApi.updatePreparationArea(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.areas() });
    },
  });
}

export function useDeleteArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.deletePreparationArea,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.areas() });
    },
  });
}

export function useSetupCafePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.setupCafePreset,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.areas() });
    },
  });
}

// ── Area Orders (KDS) ───────────────────────────────────────────────────────

export function useAreaOrders(
  areaId: number | null,
  status?: "active" | "ready" | "all",
  workerId?: string,
) {
  return useQuery({
    queryKey: preparationKeys.areaOrders(areaId ?? 0, `${status ?? "active"}:${workerId ?? ""}`),
    queryFn: () => prepApi.getAreaOrders(areaId!, status, workerId),
    enabled: Boolean(areaId),
    refetchInterval: 12_000,
    staleTime: 5_000,
  });
}

export function usePreparationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      areaId,
      action,
      orderId,
      workerId,
      staffShiftId,
    }: {
      areaId: number;
      action: "start" | "ready" | "cancel";
      orderId: number;
      workerId?: string;
      staffShiftId?: string;
    }) =>
      prepApi.preparationAction(areaId, action, {
        order_id: orderId,
        worker_id: workerId,
        staff_shift_id: staffShiftId,
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: preparationKeys.areaOrders(variables.areaId),
      });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (_error, variables) => {
      qc.invalidateQueries({
        queryKey: preparationKeys.areaOrders(variables.areaId),
      });
    },
  });
}

// ── Bulk Assign ──────────────────────────────────────────────────────────────

export function useBulkAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.bulkAssignMenuItems,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.menuItems() });
    },
  });
}

// ── Menu Items ───────────────────────────────────────────────────────────────

export function useMerchantMenuItems() {
  return useQuery({
    queryKey: preparationKeys.menuItems(),
    queryFn: prepApi.getMerchantMenuItems,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useUpdateMenuItemPreparation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      data,
    }: {
      itemId: number;
      data: { preparation_area: number | null; requires_preparation: boolean };
    }) => prepApi.updateMenuItemPreparation(itemId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.menuItems() });
      qc.invalidateQueries({ queryKey: preparationKeys.settings() });
    },
  });
}

// ── Staff Assignment ─────────────────────────────────────────────────────────

export function useStaffAreas(workerId: string | null) {
  return useQuery({
    queryKey: preparationKeys.staffAreas(workerId ?? ""),
    queryFn: () => prepApi.getStaffPreparationAreas(workerId!),
    enabled: Boolean(workerId),
  });
}

export function useSetStaffAreas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workerId, areaIds }: { workerId: string; areaIds: number[] }) =>
      prepApi.setStaffPreparationAreas(workerId, areaIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.all });
    },
  });
}

// ── Staff Shift (KDS clock-in/out) ───────────────────────────────────────────

export function useActiveStaffShift(workerId: string | null) {
  return useQuery({
    queryKey: preparationKeys.staffShift(workerId ?? ""),
    queryFn: () => prepApi.getActiveStaffShift(workerId!),
    enabled: Boolean(workerId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useOpenStaffShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: prepApi.openStaffShift,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.all });
    },
  });
}

export function useCloseStaffShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shiftId, workerId }: { shiftId: string; workerId: string }) =>
      prepApi.closeStaffShift(shiftId, workerId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: preparationKeys.all });
    },
  });
}

export function useListStaffShifts(status: "active" | "closed" = "active") {
  return useQuery({
    queryKey: preparationKeys.staffShifts(status),
    queryFn: () => prepApi.listStaffShifts(status),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
