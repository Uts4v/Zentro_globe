// routes/notifications.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requireAuth } from "@/lib/auth-guard";
import { notificationApi, type Notification } from "@/lib/api";
import {
  Bell,
  ShoppingBag,
  Target,
  Gift,
  Stamp,
  Sparkles,
  CheckCheck,
  Trash2,
  Loader2,
} from "lucide-react";
import type { ComponentType } from "react";

export const Route = createFileRoute("/notifications")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Notifications · Zentro" }] }),
  component: NotificationsPage,
});

const TYPE_ICON: Record<string, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  new_order: ShoppingBag,
  order_update: ShoppingBag,
  order_status: ShoppingBag,
  mission_completed: Target,
  reward_redeemed: Gift,
  redemption_confirmed: Gift,
  punch_card_completed: Stamp,
  punch_card: Stamp,
  special_offer: Sparkles,
  generic: Bell,
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NotificationsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery<Notification[]>({
    queryKey: ["notifications", "list"],
    queryFn: notificationApi.list,
    staleTime: 30_000,
    retry: false,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const clearAll = useMutation({
    mutationFn: () => notificationApi.clearAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unreadCount = data?.filter((n) => !n.is_read).length ?? 0;

  return (
    <div className="mx-auto max-w-[480px] px-5 pb-28 pt-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Inbox</p>
          <h1 className="font-display mt-1 text-4xl text-foreground">Notifications</h1>
          <p className="mt-1 text-xs text-muted-foreground">Last 7 days</p>
        </div>
        <div className="flex flex-col items-end gap-2 pt-1">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-mist disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </button>
          )}
          {(data?.length ?? 0) > 0 && (
            <button
              onClick={() => clearAll.mutate()}
              disabled={clearAll.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900 disabled:opacity-50"
            >
              {clearAll.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* States */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-3xl bg-mist" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-3xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-6 text-sm text-red-700 dark:text-red-300">
          Unable to load notifications.{" "}
          <button onClick={() => refetch()} className="underline">
            Retry
          </button>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
          <p className="mt-4 text-sm font-medium text-foreground">All quiet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Orders, missions, and rewards will show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((n) => {
            const Icon = TYPE_ICON[n.notification_type] ?? Bell;
            return (
              <div
                key={n.id}
                className={`rounded-3xl border px-4 py-4 transition-all ${
                  n.is_read ? "border-border bg-background" : "border-ember/20 bg-ember/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
                      n.is_read ? "bg-mist text-muted-foreground" : "gradient-ember text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-foreground">{n.title}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {formatWhen(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                      {n.message}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {n.merchant_name && (
                        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {n.merchant_name}
                        </span>
                      )}
                      {n.context_url && (
                        <a
                          href={n.context_url}
                          className="text-xs font-medium text-ember underline-offset-2 hover:underline"
                        >
                          View →
                        </a>
                      )}
                      {!n.is_read && (
                        <button
                          onClick={() => markRead.mutate(n.id)}
                          disabled={markRead.isPending}
                          className="ml-auto rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-mist disabled:opacity-50"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
