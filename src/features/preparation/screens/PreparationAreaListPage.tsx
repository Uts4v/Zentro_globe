// src/features/preparation/screens/PreparationAreaListPage.tsx
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePosStore } from "@/features/pos/store";
import { usePreparationSettings, usePreparationAreas } from "../hooks";

export default function PreparationAreaListPage() {
  const navigate = useNavigate();
  const worker = usePosStore((s) => s.currentWorker);

  const { data: settings, isLoading } = usePreparationSettings();
  const { data: areas = [] } = usePreparationAreas();

  const activeAreas = areas.filter((a) => a.is_active);

  useEffect(() => {
    if (!isLoading && settings?.preparation_routing_enabled && activeAreas.length === 1) {
      navigate({
        to: "/pos/preparation/$areaId",
        params: { areaId: String(activeAreas[0].id) },
        replace: true,
      });
    }
  }, [isLoading, settings, activeAreas, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!settings?.preparation_routing_enabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="text-4xl">⚙️</div>
        <div className="text-lg font-medium text-gray-600">
          Preparation routing is not enabled
        </div>
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
        <div className="text-lg font-medium text-gray-600">
          No preparation areas configured
        </div>
        <div className="text-sm text-gray-400">
          Ask your manager to set up preparation areas.
        </div>
      </div>
    );
  }

  if (activeAreas.length === 1) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Redirecting...</div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6 text-center">
        Choose Preparation Area
      </h1>

      <div className="space-y-3">
        {activeAreas.map((area) => (
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
            {area.is_default && (
              <div className="text-xs text-blue-600 mt-1">Default area</div>
            )}
          </button>
        ))}
      </div>

      {worker?.role === "manager" || worker?.role === "admin" ? (
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
