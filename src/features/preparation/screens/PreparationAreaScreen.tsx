// src/features/preparation/screens/PreparationAreaScreen.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { usePosStore } from "@/features/pos/store";
import { playOrderChime } from "@/lib/audio";
import {
  useAreaOrders,
  usePreparationAreas,
  usePreparationAction,
} from "../hooks";
import type { PreparationOrder } from "../types";

interface Props {
  areaId: number;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function getElapsedClass(seconds: number): string {
  if (seconds > 600) return "text-red-600 font-bold"; // >10 min
  if (seconds > 300) return "text-orange-500 font-semibold"; // >5 min
  return "text-gray-500";
}

function OrderCard({
  order,
  areaId,
  onAction,
  isPending,
}: {
  order: PreparationOrder;
  areaId: number;
  onAction: (action: "start" | "ready" | "cancel", orderId: number) => void;
  isPending: boolean;
}) {
  const statusColor = {
    pending: "border-l-4 border-yellow-400",
    preparing: "border-l-4 border-blue-500",
    ready: "border-l-4 border-green-500",
    cancelled: "border-l-4 border-red-400 opacity-50",
  };

  return (
    <div
      className={`bg-white rounded-lg shadow-sm p-4 ${statusColor[order.area_status] ?? ""} ${
        order.area_status === "ready" ? "bg-green-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-lg font-bold">
            Order {order.order_number}
          </div>
          <div className="text-sm text-gray-600">
            {order.table_name
              ? order.table_name
              : order.fulfillment_type === "pickup"
              ? "Pickup"
              : "Dine-in"}
            {order.customer_name && (
              <span className="ml-2 text-gray-400">· {order.customer_name}</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm ${getElapsedClass(order.elapsed_seconds)}`}>
            {formatElapsed(order.elapsed_seconds)}
          </div>
          {order.payment_status !== "paid" && order.payment_status !== "unpaid" && (
            <div className="text-xs text-orange-500">{order.payment_status}</div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1 mb-3">
        {order.items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center justify-between py-1 ${
              item.preparation_status === "ready"
                ? "line-through text-gray-400"
                : item.preparation_status === "preparing"
                ? "text-blue-700"
                : ""
            }`}
          >
            <span className="text-sm">
              <span className="font-semibold">{item.quantity}×</span> {item.name}
            </span>
            <span className="text-xs text-gray-400">
              {item.preparation_status === "preparing"
                ? "Prep..."
                : item.preparation_status === "ready"
                ? "✓"
                : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="text-xs text-gray-500 italic mb-3 bg-yellow-50 p-2 rounded">
          {order.notes}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {order.area_status === "pending" && (
          <>
            <button
              onClick={() => onAction("start", order.id)}
              disabled={isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              Start Preparing
            </button>
            <button
              onClick={() => onAction("cancel", order.id)}
              disabled={isPending}
              className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
            >
              ✕
            </button>
          </>
        )}
        {order.area_status === "preparing" && (
          <>
            <button
              onClick={() => onAction("ready", order.id)}
              disabled={isPending}
              className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              Mark Ready
            </button>
            <button
              onClick={() => onAction("cancel", order.id)}
              disabled={isPending}
              className="px-3 py-2 border border-red-300 text-red-600 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
            >
              ✕
            </button>
          </>
        )}
        {order.area_status === "ready" && (
          <div className="flex-1 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium text-center">
            Ready ✓
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreparationAreaScreen({ areaId }: Props) {
  const worker = usePosStore((s) => s.currentWorker);
  const { data: areas = [] } = usePreparationAreas();
  const [viewStatus, setViewStatus] = useState<"active" | "ready" | "all">("active");

  const { data, isLoading, refetch } = useAreaOrders(areaId, viewStatus);
  const actionMutation = usePreparationAction();

  const knownOrderIds = useRef(new Set<number>());
  const prevOrderCount = useRef(0);

  // Sound on new orders
  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.orders.map((o) => o.id));
    const newOrders = data.orders.filter(
      (o) => !knownOrderIds.current.has(o.id)
    );

    if (knownOrderIds.current.size > 0 && newOrders.length > 0) {
      playOrderChime();
    }

    knownOrderIds.current = currentIds;
    prevOrderCount.current = data.orders.length;
  }, [data]);

  // WebSocket connection
  useEffect(() => {
    const wsBase =
      (import.meta.env.VITE_WS_URL as string | undefined) ||
      "ws://127.0.0.1:8000";
    const merchant = usePosStore.getState().merchant;
    if (!merchant) return;

    const ws = new WebSocket(
      `${wsBase}/ws/preparation/${merchant.id}/${areaId}/`
    );

    ws.onmessage = () => {
      refetch();
    };

    ws.onerror = () => {
      // Fall back to polling (already configured in useAreaOrders)
    };

    return () => ws.close();
  }, [areaId, refetch]);

  const handleAction = useCallback(
    (action: "start" | "ready" | "cancel", orderId: number) => {
      actionMutation.mutate({
        areaId,
        action,
        orderId,
        workerId: worker?.id,
      });
    },
    [actionMutation, areaId, worker?.id]
  );

  const areaName = areas.find((a) => a.id === areaId)?.name ?? "Preparation";
  const orders = data?.orders ?? [];
  const activeCount = data?.active_count ?? 0;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wide">
              {areaName}
            </h1>
            <div className="text-sm text-gray-500">
              {activeCount} active order{activeCount !== 1 ? "s" : ""}
              {worker && <span className="ml-2">· {worker.display_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-gray-400">Online</span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 mt-3">
          {(["active", "ready", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setViewStatus(tab)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                viewStatus === tab
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {tab === "active" ? "Active" : tab === "ready" ? "Ready" : "All"}
              {tab === "active" && activeCount > 0 && (
                <span className="ml-1 bg-white text-gray-900 text-xs px-1.5 rounded-full">
                  {activeCount}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 rounded-full text-sm text-gray-500 hover:bg-gray-100"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading && orders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            Loading orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">✨</div>
            <div className="text-lg font-medium text-gray-500">
              {areaName} is clear
            </div>
            <div className="text-sm text-gray-400 mt-1">
              New orders will appear here automatically.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                areaId={areaId}
                onAction={handleAction}
                isPending={actionMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
