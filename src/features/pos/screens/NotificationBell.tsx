import { useEffect, useState, useRef } from "react";
import { posNotifications, posMarkNotificationRead, PosNotification } from "../api";
import { Bell, X, Check } from "lucide-react";
import { playWaiterCallChime } from "@/lib/audio";

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<PosNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const knownNotificationIds = useRef<Set<number> | null>(null);
  const hiddenNotificationIds = useRef<Set<number>>(new Set());

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function loadNotifications() {
    try {
      const data = (await posNotifications()).filter(
        (notification) => !hiddenNotificationIds.current.has(notification.id),
      );
      const knownIds = knownNotificationIds.current;
      if (knownIds) {
        const waiterCall = data.find(
          (notification) =>
            notification.notification_type === "waiter_call" &&
            !notification.is_read &&
            !knownIds.has(notification.id),
        );
        if (waiterCall) {
          playWaiterCallChime();
        }
      }
      knownNotificationIds.current = new Set(data.map((notification) => notification.id));
      setNotifications(data);
    } catch {
      // ignore
    }
  }

  async function markRead(id: number) {
    try {
      await posMarkNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch {
      // ignore
    }
  }

  async function clearNotifications() {
    if (unreadCount === 0) return;
    setClearing(true);
    setClearError(null);
    try {
      await Promise.all(
        notifications
          .filter((notification) => !notification.is_read)
          .map((notification) => posMarkNotificationRead(notification.id)),
      );
      notifications.forEach((notification) => hiddenNotificationIds.current.add(notification.id));
      knownNotificationIds.current = new Set();
      setNotifications([]);
    } catch {
      setClearError("Could not clear notifications. Please try again.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`relative rounded-xl p-2 transition-colors ${
          unreadCount > 0
            ? "bg-amber-100 text-amber-700 ring-2 ring-amber-300 animate-pulse"
            : "text-muted-foreground hover:bg-muted"
        }`}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-bold text-foreground">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={clearNotifications}
                  disabled={clearing}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  {clearing ? "Clearing..." : "Clear all"}
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                aria-label="Close notifications"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {clearError && (
              <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
                {clearError}
              </p>
            )}
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No notifications</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 border-b border-border px-4 py-3 last:border-0 ${
                    n.is_read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{n.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                    </p>
                  </div>
                  {!n.is_read && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="shrink-0 rounded-lg p-1 text-green-600 hover:bg-green-50"
                      title="Mark as read"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
