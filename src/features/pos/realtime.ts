import { DJANGO_BASE } from "@/lib/django-api-base";

import { posWsToken } from "./api";

export interface PosOrderChangedData {
  merchant_id?: number;
  order_id?: number;
  order_uuid?: string;
  status?: string;
  table_id?: number | null;
  version?: number | null;
  action?: "created" | "updated" | "deleted" | string;
}

export interface PosRealtimeEvent {
  event: string;
  data: PosOrderChangedData;
}

type PosRealtimeListener = (event: PosRealtimeEvent) => void;

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

const listeners = new Set<PosRealtimeListener>();

let merchantId: number | null = null;
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let connecting = false;
let running = false;
let windowListenersAttached = false;

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (!running || reconnectTimer !== null) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
  retryAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

function parseEnvelope(raw: string): PosRealtimeEvent | null {
  try {
    const parsed = JSON.parse(raw) as {
      event?: unknown;
      data?: unknown;
    };
    if (typeof parsed.event !== "string") return null;
    return {
      event: parsed.event,
      data:
        parsed.data && typeof parsed.data === "object" ? (parsed.data as PosOrderChangedData) : {},
    };
  } catch {
    return null;
  }
}

function websocketUrl(token: string): string {
  if (merchantId === null) throw new Error("POS realtime merchant missing");
  const base = new URL(DJANGO_BASE, window.location.href);
  const url = new URL(`/ws/pos/${merchantId}/`, base);
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

async function connect(): Promise<void> {
  if (!running || merchantId === null || connecting || socket) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  connecting = true;
  try {
    const { token } = await posWsToken();
    if (!running || merchantId === null) return;

    const ws = new WebSocket(websocketUrl(token));
    socket = ws;

    ws.onopen = () => {
      retryAttempt = 0;
    };

    ws.onmessage = (message) => {
      const event = parseEnvelope(String(message.data));
      if (!event) return;
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          continue;
        }
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
    };
  } catch {
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

function handleOnline(): void {
  if (!running) return;
  retryAttempt = 0;
  clearReconnectTimer();
  void connect();
}

function handleOffline(): void {
  clearReconnectTimer();
  const ws = socket;
  socket = null;
  ws?.close();
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") {
    retryAttempt = 0;
    clearReconnectTimer();
    void connect();
  }
}

function attachWindowListeners(): void {
  if (windowListenersAttached || typeof window === "undefined") return;
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  document.addEventListener("visibilitychange", handleVisibility);
  windowListenersAttached = true;
}

function detachWindowListeners(): void {
  if (!windowListenersAttached || typeof window === "undefined") return;
  window.removeEventListener("online", handleOnline);
  window.removeEventListener("offline", handleOffline);
  document.removeEventListener("visibilitychange", handleVisibility);
  windowListenersAttached = false;
}

export function startPosRealtime(id: number): void {
  if (running && merchantId === id) return;
  if (running) stopPosRealtime();

  merchantId = id;
  running = true;
  retryAttempt = 0;
  attachWindowListeners();
  void connect();
}

export function stopPosRealtime(): void {
  running = false;
  merchantId = null;
  clearReconnectTimer();
  detachWindowListeners();

  const ws = socket;
  socket = null;
  ws?.close();
}

export function subscribePosRealtime(listener: PosRealtimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
