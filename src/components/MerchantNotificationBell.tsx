import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bell, X, Check, BellRing, CheckCheck } from "lucide-react";
import { notificationApi, type Notification } from "@/lib/api";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Merchant dashboard notification bell.
 * Shows every notification for the logged-in merchant (new orders, punches,
 * claims, transfers, waiter calls...) in an icon + dropdown popup, and toasts
 * new arrivals so nothing is missed.
 */
export default function MerchantNotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const navigate = useNavigate();

  function toggleOpen() {
    if (!open && panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect();
      const panelWidth = Math.min(384, window.innerWidth - 16);
      const panelHeight = Math.min(432, window.innerHeight - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - 8));
      const top = Math.min(rect.bottom + 8, window.innerHeight - panelHeight - 8);
      setPanelPos({ top, left });
    }
    setOpen((v) => !v);
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function loadNotifications() {
    try {
      const data = await notificationApi.list();
      const known = knownIds.current;
      if (known) {
        const fresh = data.filter((n) => !n.is_read && !known.has(n.id));
        if (fresh.length > 0) {
          fresh.forEach((n) => {
            toast.info(n.title, {
              description: n.message,
              duration: 6000,
            });
          });
        }
      }
      knownIds.current = new Set(data.map((n) => n.id));
      setNotifications(data);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function markRead(n: Notification) {
    try {
      await notificationApi.markRead(n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    } catch {
      // ignore
    }
  }

  async function markAllRead() {
    if (unreadCount === 0) return;
    setBusy(true);
    try {
      await notificationApi.markAllRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    } finally {
      setBusy(false);
    }
  }

  function openNotification(n: Notification) {
    if (!n.is_read) markRead(n);
    setOpen(false);
    if (n.context_url) {
      navigate({ to: n.context_url as any });
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggleOpen}
        className={`relative grid h-9 w-9 place-items-center rounded-xl transition-colors ${
          unreadCount > 0
            ? "bg-amber-100 text-amber-700 ring-2 ring-amber-300"
            : "text-muted-foreground hover:bg-muted"
        }`}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      >
        {unreadCount > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{ top: panelPos?.top ?? 0, left: panelPos?.left ?? 0 }}
          className="fixed z-50 w-96 max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-card shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-ember" />
              <h3 className="text-sm font-bold text-foreground">Notifications</h3>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {busy ? "Marking…" : "Mark all read"}
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

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openNotification(n)}
                  className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 ${
                    n.is_read ? "opacity-55" : "hover:bg-ember-soft/20"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${n.is_read ? "font-medium text-foreground" : "font-bold text-foreground"}`}
                    >
                      {n.title}
                    </p>
                    {n.message && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {n.message}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {n.created_at ? timeAgo(n.created_at) : ""}
                      {" · "}
                      <span className="capitalize">{n.notification_type.replaceAll("_", " ")}</span>
                    </p>
                  </div>
                  {!n.is_read && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(n);
                      }}
                      className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-green-50 hover:text-green-600"
                      title="Mark as read"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
