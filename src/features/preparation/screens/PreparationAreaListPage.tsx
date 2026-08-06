// src/features/preparation/screens/PreparationAreaListPage.tsx
import { useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePosStore } from "@/features/pos/store";
import { usePreparationSettings, usePreparationAreas, useStaffAreas } from "../hooks";

const ALL_ACCESS_ROLES = ["manager", "admin"];

export default function PreparationAreaListPage() {
  const navigate = useNavigate();
  const worker = usePosStore((s) => s.currentWorker);

  const { data: settings, isLoading } = usePreparationSettings();
  const { data: areas = [] } = usePreparationAreas();
  const { data: assignments = [] } = useStaffAreas(
    worker && !ALL_ACCESS_ROLES.includes(worker.role) ? worker.id : null,
  );

  const activeAreas = useMemo(() => areas.filter((a) => a.is_active), [areas]);

  // Managers/admins see all areas; everyone else only their assigned areas.
  const accessibleAreas = useMemo(() => {
    if (!worker) return [];
    if (ALL_ACCESS_ROLES.includes(worker.role)) return activeAreas;
    const assignedIds = new Set(assignments.map((a) => a.area_id));
    return activeAreas.filter((a) => assignedIds.has(a.id));
  }, [worker, activeAreas, assignments]);

  useEffect(() => {
    if (isLoading || !worker) return;
    if (settings?.preparation_routing_enabled && accessibleAreas.length === 1) {
      navigate({
        to: "/pos/preparation/$areaId",
        params: { areaId: String(accessibleAreas[0].id) },
        replace: true,
      });
    }
  }, [isLoading, settings, accessibleAreas, worker, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!worker) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-4xl">🔒</div>
        <div className="text-lg font-medium text-gray-600">
          Sign in with your PIN to open the preparation screen
        </div>
      </div>
    );
  }

  if (!settings?.preparation_routing_enabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-4xl">⚙️</div>
        <div className="text-lg font-medium text-gray-600">Preparation routing is not enabled</div>
        <div className="text-sm text-gray-400">
          Ask your manager to enable preparation areas in Settings.
        </div>
      </div>
    );
  }

  if (activeAreas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-4xl">📋</div>
        <div className="text-lg font-medium text-gray-600">No preparation areas configured</div>
        <div className="text-sm text-gray-400">Ask your manager to set up preparation areas.</div>
      </div>
    );
  }

  if (accessibleAreas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-4xl">🚫</div>
        <div className="text-lg font-medium text-gray-600">
          You don&apos;t have access to any preparation area
        </div>
        <div className="text-sm text-gray-400">
          Ask your manager to assign you to a Kitchen or Bar screen.
        </div>
      </div>
    );
  }

  if (accessibleAreas.length === 1) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-2xl font-bold mb-1 text-center">Choose Preparation Area</h1>
      <p className="text-sm text-gray-400 text-center mb-6">
        Working as {worker.display_name} ({worker.role})
      </p>

      <div className="space-y-3">
        {accessibleAreas.map((area) => (
          <button
            key={area.id}
            onClick={() =>
              navigate({
                to: "/pos/preparation/$areaId",
                params: { areaId: String(area.id) },
              })
            }
            className="w-full p-6 bg-white border-2 rounded-xl text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
          >
            <div className="text-lg font-semibold">{area.name}</div>
            {area.is_default && <div className="text-xs text-blue-600 mt-1">Default area</div>}
          </button>
        ))}
      </div>

      {ALL_ACCESS_ROLES.includes(worker.role) ? (
        <div className="mt-6 text-center">
          <button
            onClick={() => navigate({ to: "/pos/orders" })}
            className="text-sm text-gray-500 hover:underline"
          >
            Back to all orders
          </button>
        </div>
      ) : null}
    </div>
  );
}
