// src/features/preparation/screens/PreparationAreaScreen.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { usePosStore } from "@/features/pos/store";
import { playOrderChime } from "@/lib/audio";
import { getWsToken } from "@/lib/ws";
import {
  useAreaOrders,
  usePreparationAreas,
  usePreparationAction,
  useActiveStaffShift,
  useOpenStaffShift,
  useCloseStaffShift,
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
  if (seconds > 600) return "text-destructive font-bold"; // >10 min
  if (seconds > 300) return "text-destructive font-semibold"; // >5 min
  return "text-muted-foreground";
}

function formatShiftTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
      className={`bg-card rounded-2xl border border-border p-4 ${statusColor[order.area_status] ?? ""} ${
        order.area_status === "ready" ? "bg-success/10" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="numeric text-2xl font-bold tracking-tight">
            Order {order.order_number}
          </div>
          <div className="mt-0.5 text-base font-semibold text-foreground">
            {order.table_name
              ? order.table_name
              : order.fulfillment_type === "pickup"
                ? "Pickup"
                : "Dine-in"}
            {order.customer_name && (
              <span className="ml-2 font-medium text-muted-foreground">
                · {order.customer_name}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className={`numeric text-base ${getElapsedClass(order.elapsed_seconds)}`}>
            {formatElapsed(order.elapsed_seconds)}
          </div>
          {order.payment_status !== "paid" && order.payment_status !== "unpaid" && (
            <div className="text-[13px] font-semibold capitalize text-destructive">
              {order.payment_status}
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="space-y-1 mb-3">
<<<<<<< HEAD
        {order.items.map((item) => {
          const modifiers = item.modifiers ?? [];
          const instructions = item.special_instructions || item.notes;
          return (
            <div
              key={item.id}
              className={`py-1 ${
                item.preparation_status === "ready"
                  ? "line-through text-gray-400"
                  : item.preparation_status === "preparing"
                    ? "text-blue-700"
                    : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg">
                  <span className="font-bold">{item.quantity}×</span>{" "}
                  <span className="font-semibold">{item.name}</span>
                  {item.variant_name && (
                    <span className="ml-1 font-medium text-gray-500">
                      ({item.variant_name})
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-400">
                  {item.preparation_status === "preparing" ? (
                    item.started_by ? (
                      <span className="text-blue-500">Prep: {item.started_by}</span>
                    ) : (
                      "Prep..."
                    )
                  ) : item.preparation_status === "ready" ? (
                    item.ready_by ? (
                      <span className="text-green-600">✓ {item.ready_by}</span>
                    ) : (
                      "✓"
                    )
                  ) : (
                    ""
                  )}
                </span>
              </div>

              {/* Add-ons: the kitchen needs these, the price does not. */}
              {modifiers.length > 0 && (
                <ul className="ml-6 mt-0.5 space-y-0.5">
                  {modifiers.map((mod, idx) => (
                    <li key={`${item.id}-mod-${idx}`} className="text-sm text-gray-600">
                      + {mod.option_name}
                      {mod.group_name ? (
                        <span className="text-gray-400"> ({mod.group_name})</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
=======
        {order.items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center justify-between py-1 ${
              item.preparation_status === "ready"
                ? "line-through text-muted-foreground"
                : item.preparation_status === "preparing"
                  ? "text-blue-700"
                  : ""
            }`}
          >
            <span className="text-lg">
              <span className="font-bold">{item.quantity}×</span>{" "}
              <span className="font-semibold">{item.name}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {item.preparation_status === "preparing" ? (
                item.started_by ? (
                  <span className="text-blue-500">Prep: {item.started_by}</span>
                ) : (
                  "Prep..."
                )
              ) : item.preparation_status === "ready" ? (
                item.ready_by ? (
                  <span className="text-green-600">✓ {item.ready_by}</span>
                ) : (
                  "✓"
                )
              ) : (
                ""
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
              )}

              {instructions && (
                <p className="ml-6 mt-0.5 text-sm font-medium italic text-amber-700">
                  {instructions}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="text-xs text-muted-foreground italic mb-3 bg-warning/10 p-2 rounded">
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
              aria-label="Cancel item"
              className="flex h-10 w-10 items-center justify-center border border-destructive/40 text-destructive rounded-lg text-sm hover:bg-destructive/10 disabled:opacity-50"
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
              aria-label="Cancel item"
              className="flex h-10 w-10 items-center justify-center border border-destructive/40 text-destructive rounded-lg text-sm hover:bg-destructive/10 disabled:opacity-50"
            >
              ✕
            </button>
          </>
        )}
        {order.area_status === "ready" && (
          <div className="flex-1 h-10 flex items-center justify-center bg-success/15 text-success rounded-lg text-sm font-medium text-center">
            Ready ✓
          </div>
        )}
      </div>
    </div>
  );
}

export default function PreparationAreaScreen({ areaId }: Props) {
  const worker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const { data: areas = [] } = usePreparationAreas();
  const [viewStatus, setViewStatus] = useState<"active" | "ready" | "all">("active");

  const { data: activeShiftData } = useActiveStaffShift(worker?.id ?? null);
  const activeShift = activeShiftData?.shift ?? null;

  const { data, isLoading, refetch } = useAreaOrders(areaId, viewStatus, worker?.id);
  const actionMutation = usePreparationAction();
  const openShiftMutation = useOpenStaffShift();
  const closeShiftMutation = useCloseStaffShift();

  const knownOrderIds = useRef(new Set<number>());
  const prevOrderCount = useRef(0);

  // Sound on new orders
  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.orders.map((o) => o.id));
    const newOrders = data.orders.filter((o) => !knownOrderIds.current.has(o.id));

    if (knownOrderIds.current.size > 0 && newOrders.length > 0) {
      playOrderChime();
    }

    knownOrderIds.current = currentIds;
    prevOrderCount.current = data.orders.length;
  }, [data]);

  // WebSocket connection
  useEffect(() => {
    const wsBase = (import.meta.env.VITE_WS_URL as string | undefined) || "ws://127.0.0.1:8000";
    const merchant = usePosStore.getState().merchant;
    if (!merchant) return;

    let ws: WebSocket | undefined;
    let cancelled = false;

    getWsToken()
      .then((token) => {
        if (cancelled) return;
        ws = new WebSocket(`${wsBase}/ws/preparation/${merchant.id}/${areaId}/?token=${token}`);
        ws.onmessage = () => {
          refetch();
        };
        ws.onerror = () => {
          // Fall back to polling (already configured in useAreaOrders)
        };
      })
      .catch(() => {
        // Fall back to polling (already configured in useAreaOrders)
      });

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [areaId, refetch]);

  const handleOpenShift = useCallback(() => {
    if (!worker) return;
    openShiftMutation.mutate({
      worker_id: worker.id,
      area_ids: [areaId],
      device_id: device?.id ?? null,
    });
  }, [openShiftMutation, worker, areaId, device]);

  const handleCloseShift = useCallback(() => {
    if (!worker || !activeShift) return;
    closeShiftMutation.mutate({ shiftId: activeShift.id, workerId: worker.id });
  }, [closeShiftMutation, worker, activeShift]);

  const handleAction = useCallback(
    (action: "start" | "ready" | "cancel", orderId: number) => {
      actionMutation.mutate(
        {
          areaId,
          action,
          orderId,
          workerId: worker?.id,
          staffShiftId: activeShift?.id,
        },
        {
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : "Action failed. Please try again.");
          },
        },
      );
    },
    [actionMutation, areaId, worker?.id, activeShift?.id],
  );

  const areaName = areas.find((a) => a.id === areaId)?.name ?? "Preparation";
  const orders = data?.orders ?? [];
  const activeCount = data?.active_count ?? 0;

  // KDS staff must clock in before acting
  if (!activeShift && worker) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="w-full max-w-sm bg-card rounded-2xl border border-border p-6 text-center">
          <div className="text-4xl mb-3">🕐</div>
          <h2 className="text-lg font-bold text-foreground">Open your shift</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {worker.display_name}, you&apos;re about to cover{" "}
            <span className="font-semibold text-foreground">{areaName}</span>. Multiple staff can be
            on shift at the same time — Ramesh on Bar, Sita on Kitchen, etc.
          </p>
          <button
            onClick={handleOpenShift}
            disabled={openShiftMutation.isPending}
            className="mt-5 w-full py-3 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50"
          >
            {openShiftMutation.isPending ? "Opening..." : "Open Shift"}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">
            Opening a staff shift does not open a cash drawer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-wide">{areaName}</h1>
            <div className="numeric text-sm text-muted-foreground">
              {activeCount} active order{activeCount !== 1 ? "s" : ""}
              {worker && <span className="ml-2">· {worker.display_name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeShift && (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                Shift since {formatShiftTime(activeShift.opened_at)}
                <button
                  onClick={handleCloseShift}
                  disabled={closeShiftMutation.isPending}
                  className="ml-1 text-success underline hover:opacity-80 disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            )}
            {!activeShift && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
            <span className="text-xs text-muted-foreground">
              {activeShift ? "Online" : "No shift"}
            </span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 mt-3">
          {(["active", "ready", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setViewStatus(tab)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                viewStatus === tab
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-secondary"
              }`}
            >
              {tab === "active" ? "Active" : tab === "ready" ? "Ready" : "All"}
              {tab === "active" && activeCount > 0 && (
                <span className="numeric ml-1 bg-card text-foreground text-xs px-1.5 rounded-full">
                  {activeCount}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={() => refetch()}
            aria-label="Refresh list"
            className="flex h-10 min-w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading && orders.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">✨</div>
            <div className="text-lg font-medium text-foreground">{areaName} is clear</div>
            <div className="text-sm text-muted-foreground mt-1">
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
