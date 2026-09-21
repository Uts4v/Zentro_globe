import { useState, useEffect, useCallback, useRef } from "react";
import { posNotifications, posMarkNotificationRead, PosNotification } from "../api";
import { Check, ChevronRight, RefreshCw, Volume2 } from "lucide-react";

export default function WaiterCallPanel() {
  const [notifications, setNotifications] = useState<PosNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearingId, setClearingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const fetchWaiterCalls = useCallback(async () => {
    setLoading(true);
    try {
      const data = await posNotifications();
      setNotifications(
        data.filter(
          (notification) =>
            notification.notification_type === "waiter_call" && !notification.is_read,
        ),
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWaiterCalls();
    const interval = setInterval(fetchWaiterCalls, 5000);
    return () => clearInterval(interval);
  }, [fetchWaiterCalls]);

  async function handleClear(notification: PosNotification) {
    setClearingId(notification.id);
    try {
      await posMarkNotificationRead(notification.id);
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch {
      // keep the card so the user can retry
    } finally {
      setClearingId(null);
    }
  }

  if (notifications.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <div className="relative">
            <Volume2 className="h-5 w-5 text-amber-600" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
              {notifications.length}
            </span>
          </div>
          <h3 className="text-sm font-bold text-foreground">Waiter Calls</h3>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              collapsed ? "" : "rotate-90"
            }`}
          />
        </button>
        <button
          onClick={fetchWaiterCalls}
          disabled={loading}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-amber-100"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2 max-h-[26vh] overflow-y-auto">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-foreground">{notification.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{notification.message}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {notification.created_at
                    ? new Date(notification.created_at).toLocaleString()
                    : ""}
                </p>
              </div>
              <button
                onClick={() => handleClear(notification)}
                disabled={clearingId === notification.id}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                Clear
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
