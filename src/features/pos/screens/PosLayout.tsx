import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { usePosStore } from "../store";
import WorkerPinPad from "./WorkerPinPad";
import ShiftOpenScreen from "./ShiftOpenScreen";
import ShiftCloseScreen from "./ShiftCloseScreen";
import SyncStatusBar from "./SyncStatusBar";
import PendingOfflineKOTs from "./PendingOfflineKOTs";
import NotificationBell from "./NotificationBell";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import { useBackgroundSync, useOnlineStatus } from "../offline/hooks";
import { isPosPathOfflineSafe, POS_NAV_SECTIONS } from "../offline/permissions";
import { fetchLiveBootstrap, loadPosBootstrap, POS_REFRESH_EVENT } from "../offline/loader";
import { ClearCacheNavButton } from "@/components/ClearCacheControl";
import { hasStaffPermission, staffSession } from "@/lib/staff-session";
import {
  Bell,
  LogOut,
  Wifi,
  WifiOff,
  Wallet,
  Loader2,
  Menu,
  ShieldAlert,
  UserCheck,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";

const NEEDS_CONNECTION = "Needs a connection — not available offline";

export function hasRoutePermission(path: string): boolean {
  if (path.startsWith("/pos/reports")) return hasStaffPermission("reports.view");
  if (path.startsWith("/pos/staff") || path.startsWith("/pos/schedule"))
    return hasStaffPermission("staff.manage");
  if (path.startsWith("/pos/settings")) return hasStaffPermission("settings.manage");
  if (path.startsWith("/pos/orders")) return hasStaffPermission("orders.view");
  if (path.startsWith("/pos/accounts")) return hasStaffPermission("payments.take");
  if (path.startsWith("/pos/cash-movements")) return hasStaffPermission("shifts.close");
  if (path.startsWith("/merchant")) {
    const session = staffSession.get();
    return !session || session.role === "Admin" || session.role === "Owner";
  }
  if (path === "/pos" || path === "/pos/")
    return hasStaffPermission("pos.access") && hasStaffPermission("orders.create");
  return true;
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  badge,
  onClick,
  disabled,
  disabledReason,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const shell = `flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm ${
    disabled
      ? "cursor-not-allowed text-muted-foreground/40"
      : active
        ? "bg-ember-soft font-semibold text-ember transition-colors"
        : "font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  }`;

  const badgeNode =
    badge !== undefined && badge > 0 ? (
      <span className="ml-auto rounded-full bg-ember px-2 py-0.5 text-xs font-bold text-white">
        {badge}
      </span>
    ) : null;

  // A disabled entry is a plain element, not a link: a keyboard user must not
  // be able to tab into it and press Enter onto a screen that cannot load.
  if (disabled) {
    return (
      <span aria-disabled="true" title={disabledReason || NEEDS_CONNECTION} className={shell}>
        <Icon className="h-4 w-4" />
        <span>{label}</span>
        {badgeNode}
      </span>
    );
  }

  return (
    <Link to={to as any} onClick={onClick} className={shell}>
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badgeNode}
    </Link>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="px-4 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * The sidebar, rendered from the shared nav config with permission filtering so
 * the desktop and mobile drawers can never disagree about what exists or what works offline.
 */
function PosNav({
  isOnline,
  cartCount,
  activePath,
  onNavigate,
}: {
  isOnline: boolean;
  cartCount: number;
  activePath: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {POS_NAV_SECTIONS.map((section) => {
        const visibleItems = section.items.filter((item) => hasRoutePermission(item.to));
        if (visibleItems.length === 0) return null;

        return (
          <NavSection key={section.title} title={section.title}>
            {visibleItems.map((item) => {
              const active = activePath === item.to || activePath === `${item.to}/`;
              return (
                <NavItem
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={item.icon}
                  badge={item.to === "/pos" ? cartCount : item.badge}
                  active={active}
                  onClick={onNavigate}
                  disabled={!isOnline && !isPosPathOfflineSafe(item.to)}
                  disabledReason="Needs an internet connection. Available again once the POS is back online."
                />
              );
            })}
          </NavSection>
        );
      })}
    </>
  );
}

/** The bell is fed by the server, so offline it is shown but cannot be opened. */
function PosNotifications({ offline }: { offline: boolean }) {
  if (!offline) return <NotificationBell />;
  return (
    <span
      aria-disabled="true"
      title={NEEDS_CONNECTION}
      className="cursor-not-allowed rounded-xl p-2 text-muted-foreground/40"
    >
      <Bell className="h-5 w-5" />
    </span>
  );
}

/** Shown in place of a screen that cannot work without the server. */
function OfflineUnavailable() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <WifiOff className="mx-auto h-10 w-10 text-amber-500" />
        <h2 className="mt-3 text-lg font-bold text-foreground">Not available offline</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This screen needs the server. While offline you can still take orders, print KOTs and
          bills, and work on your orders — it opens again as soon as the connection is back.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            to="/pos"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-ink px-5 text-sm font-bold text-white hover:opacity-90"
          >
            Take an order
          </Link>
          <Link
            to="/pos/orders"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border px-5 text-sm font-bold text-foreground hover:bg-muted"
          >
            View orders
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function PosLayout() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const routerState = useRouterState();
  const merchant = usePosStore((s) => s.merchant);
  const device = usePosStore((s) => s.device);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const activeShift = usePosStore((s) => s.activeShift);
  const cart = usePosStore((s) => s.cart);
  const setCurrentWorker = usePosStore((s) => s.setCurrentWorker);
  const setActiveShift = usePosStore((s) => s.setActiveShift);
  const resetPos = usePosStore((s) => s.reset);
  const [showShiftClose, setShowShiftClose] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const workers = usePosStore((s) => s.workers);
  const bootstrap = usePosStore((s) => s.bootstrap);
  const isOnline = useOnlineStatus();

  // Initialize POS, then keep it current. A terminal left open all day must
  // show a dish added in the merchant dashboard an hour ago, not the menu as it
  // was when the till was switched on.
  useEffect(() => {
    if (merchant && device) {
      setInitializing(false);
      return;
    }

    async function init() {
      setInitializing(true);
      setInitError(null);
      try {
        const loaded = await loadPosBootstrap();
        const opts = loaded.source === "saved" ? { savedAt: loaded.savedAt! } : undefined;
        bootstrap(loaded.data, opts);
      } catch (err: unknown) {
        setInitError(err instanceof Error ? err.message : "Failed to initialize POS");
      } finally {
        setInitializing(false);
      }
    }

    init();
    // Mount-only on purpose. `merchant` and `device` are read solely to skip a
    // second bootstrap when the store is already hydrated; listing them would
    // re-run this and re-place every POS screen on each hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start background sync
  useBackgroundSync();

  const savedDataFrom = usePosStore((s) => s.savedDataFrom);
  const offlineCacheUnavailable = usePosStore((s) => s.offlineCacheUnavailable);
  const [refreshing, setRefreshing] = useState(false);
  const lastSyncedAt = usePosStore((s) => s.lastSyncedAt);

  /**
   * Pull live POS data and replace whatever is on screen.
   *
   * Runs on a timer and whenever the tab comes back to the front, because a
   * terminal is often left open and simply brought forward — with the old
   * design the saved copy was only ever replaced when the till had *already*
   * gone offline, so a menu change made during a normal online session never
   * reached the grid at all.
   */
  const refreshFromServer = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchLiveBootstrap();
      bootstrap(data);
    } catch {
      // still unreachable — keep whatever is on screen and the banner
    } finally {
      setRefreshing(false);
    }
  }, [bootstrap]);

  /**
   * Keep the grid current: every 60s, on reconnect, and whenever the terminal
   * is brought back to the front.
   */
  useEffect(() => {
    let inFlight = false;
    const guarded = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await refreshFromServer();
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      if (navigator.onLine) guarded();
    }, 60000);
    const onOnline = () => guarded();
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) guarded();
    };
    // The menu grid's own refresh button. Named rather than a callback prop so
    // the grid stays a plain store consumer and cannot be wired up twice.
    const onManualRefresh = () => guarded();
    window.addEventListener("online", onOnline);
    window.addEventListener(POS_REFRESH_EVENT, onManualRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(POS_REFRESH_EVENT, onManualRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshFromServer]);

  // Only /pos and /pos/orders work with no connection. A cashier who was on
  // Reports when the connection dropped is moved back to the order screen
  // rather than left staring at an empty list that cannot reload.
  useEffect(() => {
    if (isOnline) return;
    if (isPosPathOfflineSafe(routerState.location.pathname)) return;
    navigate({ to: "/pos", replace: true });
  }, [isOnline, routerState.location.pathname, navigate]);

  async function handleSignOut() {
    staffSession.set(null);
    setCurrentWorker(null);
    // A shared till must not leave the next cashier with this one's menu,
    // tables and staff — and no device can be signed in to POS with none of
    // them being reachable.
    resetPos();
    await signOut();
    navigate({ to: "/auth/merchant" as any, replace: true });
  }

  function handleSwitchStaff() {
    staffSession.set(null);
    setCurrentWorker(null);
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ── Loading: initializing POS device ──
  if (initializing) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-ink" />
          <p className="mt-3 text-sm text-muted-foreground">Initializing POS...</p>
        </div>
      </div>
    );
  }

  // ── Init error ──
  if (initError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
          <h2 className="mt-3 text-lg font-bold text-foreground">POS Error</h2>
          <p className="mt-2 text-sm text-muted-foreground">{initError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-ink px-6 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Step 1: No worker logged in → show PIN pad ──
  if (!currentWorker) {
    // Escape hatch for fresh installs: allow the merchant (JWT) into
    // Staff Management while zero workers exist, so the first worker
    // can be created instead of deadlocking on an empty PIN pad.
    const pathname = routerState.location.pathname;
    if (workers.length === 0 && pathname === "/pos/staff") {
      return <Outlet />;
    }
    return <WorkerPinPad onLoggedIn={(worker) => setCurrentWorker(worker)} />;
  }

  // ── Determine which page the user is on ──
  const pathname = routerState.location.pathname;
  const isOrderPage = pathname === "/pos" || pathname === "/pos/";
  const isOrdersPage = pathname === "/pos/orders" || pathname === "/pos/orders/";
  const isShiftRequiredPage = isOrderPage;
  const offline = !isOnline;
  // Offline, only the two screens that work from this device stay open.
  const blockedOffline = offline && !isOrderPage && !isOrdersPage;

  // ── Step 2b: Closing shift ──
  if (showShiftClose) {
    return (
      <ShiftCloseScreen
        onShiftClosed={() => {
          setActiveShift(null);
          setCurrentWorker(null);
          setShowShiftClose(false);
        }}
        onCancel={() => setShowShiftClose(false)}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-background lg:flex">
        {/* Logo + notification */}
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center text-foreground"
              aria-label="Zentro home"
            >
              <ZentroLogo className="h-6 w-auto" title="" />
            </Link>
            <span className="rounded-md bg-ember-soft px-1.5 py-0.5 text-xs font-bold uppercase text-ember">
              POS
            </span>
          </div>
          <PosNotifications offline={offline} />
        </div>

        {/* User / staff info */}
        <div className="border-y border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
              {(currentWorker?.display_name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {currentWorker?.display_name ?? "Staff"}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {currentWorker?.role_name || currentWorker?.role || "Staff"}
                </span>
                {currentWorker?.staff_code && (
                  <span className="font-mono text-[10px]">#{currentWorker.staff_code}</span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSwitchStaff}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted active:scale-[0.98]"
            title="Switch Staff / Lock Terminal"
          >
            <UserCheck className="h-3.5 w-3.5 text-primary" />
            <span>Switch Staff</span>
          </button>
          {/* Shift status */}
          {activeShift ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2 text-xs font-medium text-green-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              Shift active — {activeShift.total_orders} orders
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              No active shift
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pt-2 pb-4">
          <PosNav isOnline={isOnline} cartCount={cartCount} activePath={pathname} />
        </nav>

        {/* Footer */}
        <div className="space-y-2 border-t border-border px-3 py-4">
          <div className="px-1">
            <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Theme
            </p>
            <ThemeToggle />
          </div>
          <div className="px-1">
            <SyncStatusBar />
          </div>
          <div className="px-1">
            <PendingOfflineKOTs />
          </div>
          {/* Close / Open shift */}
          {activeShift ? (
            <button
              onClick={() => setShowShiftClose(true)}
              disabled={!isOnline}
              title={
                isOnline
                  ? undefined
                  : "Closing a shift needs an internet connection. Close it once you are back online."
              }
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
            >
              <Wallet className="h-4 w-4" />
              <span>Close Shift</span>
            </button>
          ) : (
            <button
              onClick={() => navigate({ to: "/pos" })}
              disabled={!isOnline}
              title={isOnline ? undefined : "Opening a shift needs an internet connection."}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-green-600 hover:bg-green-50 disabled:cursor-not-allowed disabled:text-muted-foreground/40 disabled:hover:bg-transparent"
            >
              <Wallet className="h-4 w-4" />
              <span>Open Shift</span>
            </button>
          )}
          {/* Connection state */}
          <div className="space-y-1 px-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {isOnline ? (
                <>
                  <Wifi className="h-3.5 w-3.5 text-green-500" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-amber-600">Offline</span>
                </>
              )}
              <button
                type="button"
                onClick={() => refreshFromServer()}
                disabled={!isOnline || refreshing}
                title={
                  isOnline
                    ? "Fetch the latest menu, tables and staff from the server"
                    : "Needs an internet connection"
                }
                className="ml-auto inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            {savedDataFrom ? (
              <p className="text-amber-700">Menu saved {savedLabel(savedDataFrom)}</p>
            ) : lastSyncedAt ? (
              <p>Menu updated {savedLabel(lastSyncedAt)}</p>
            ) : null}
            {offlineCacheUnavailable && (
              <p className="text-rose-600">
                No offline copy saved — no menu if the connection drops.
              </p>
            )}
          </div>
          <button
            onClick={handleSignOut}
            disabled={offline}
            title={offline ? NEEDS_CONNECTION : undefined}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 lg:hidden">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="rounded-xl p-2 text-muted-foreground hover:bg-muted"
            aria-label="Open POS navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            to="/"
            className="inline-flex items-center text-foreground"
            aria-label="Zentro home"
          >
            <ZentroLogo className="h-6 w-auto" title="" />
          </Link>
          <span className="rounded-md bg-ink/10 px-1.5 py-0.5 text-xs font-bold uppercase text-ink">
            POS
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PosNotifications offline={offline} />
            <ThemeCycleButton />
            {isOnline ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-500" />
            )}
            {activeShift && (
              <button
                onClick={() => setShowShiftClose(true)}
                disabled={!isOnline}
                title={isOnline ? undefined : "Closing a shift needs an internet connection."}
                className="hidden rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
              >
                CLOSE SHIFT
              </button>
            )}
            {!activeShift && (
              <button
                onClick={() => navigate({ to: "/pos" })}
                disabled={!isOnline}
                title={isOnline ? undefined : "Opening a shift needs an internet connection."}
                className="hidden rounded-lg bg-green-100 px-2 py-1 text-xs font-bold text-green-700 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
              >
                OPEN SHIFT
              </button>
            )}
            {currentWorker && (
              <button
                type="button"
                onClick={handleSwitchStaff}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                title="Switch Staff / Lock Terminal"
              >
                <div className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10px] font-medium text-white">
                  {currentWorker.display_name.charAt(0).toUpperCase()}
                </div>
                <span className="hidden sm:inline">{currentWorker.display_name}</span>
                <UserCheck className="h-3.5 w-3.5 text-primary" />
              </button>
            )}
          </div>
        </header>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/40"
              aria-label="Close POS navigation"
            />
            <aside className="relative flex h-full w-[min(20rem,85vw)] flex-col bg-background shadow-2xl">
              <div className="flex items-center justify-between border-b border-border px-4 py-4">
                <div className="flex items-center gap-2">
                  <ZentroLogo className="h-6 w-auto" title="" />
                  <span className="rounded-md bg-ember-soft px-1.5 py-0.5 text-xs font-bold uppercase text-ember">
                    POS
                  </span>
                </div>
                <PosNotifications offline={offline} />
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto px-3 pt-2 pb-4">
                <PosNav
                  isOnline={isOnline}
                  cartCount={cartCount}
                  activePath={pathname}
                  onNavigate={() => setMobileNavOpen(false)}
                />
              </nav>
              <div className="space-y-2 border-t border-border p-3">
                <SyncStatusBar />
                <PendingOfflineKOTs />
                <button
                  onClick={handleSignOut}
                  disabled={offline}
                  title={offline ? NEEDS_CONNECTION : undefined}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
                <ClearCacheNavButton
                  disabled={!isOnline}
                  disabledReason="Needs an internet connection to clear cache safely"
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                />
              </div>
            </aside>
          </div>
        )}

        {/* Offline notice */}
        {!isOnline && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <strong>Offline.</strong> Order, Orders, KOT printing, bills and sync are still
              available — everything else needs a connection.
            </span>
          </div>
        )}

        {savedDataFrom && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <span>
              <strong>Can&apos;t reach the server.</strong> Showing data saved on this device
              {savedLabel(savedDataFrom)}. New tables, menu changes and customer orders may be
              missing. Orders you take are saved here and sent when the connection is back.
            </span>
            <button
              type="button"
              onClick={() => refreshFromServer()}
              disabled={refreshing}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-amber-300 bg-white px-3 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              {refreshing ? "Trying…" : "Try again"}
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {blockedOffline ? (
            <OfflineUnavailable />
          ) : !hasRoutePermission(pathname) ? (
            <div className="flex h-full items-center justify-center p-6">
              <div className="max-w-md text-center">
                <ShieldAlert className="mx-auto mb-3 h-12 w-12 text-amber-500" />
                <h2 className="text-xl font-bold text-foreground">Access Restricted</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Your staff account ({currentWorker?.display_name}) does not have permission to
                  access this section. Please contact your administrator.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <Link
                    to="/pos"
                    className="inline-flex min-h-[44px] items-center rounded-xl bg-ink px-5 text-sm font-bold text-white hover:opacity-90"
                  >
                    Back to Terminal
                  </Link>
                </div>
              </div>
            </div>
          ) : isShiftRequiredPage && !activeShift ? (
            /* If on order page and no active shift, show shift open screen */
            <div className="flex h-full items-center justify-center">
              <ShiftOpenScreen onShiftOpened={(shift) => setActiveShift(shift)} />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

/** " at 2:35 PM" / " on Oct 1, 2:35 PM" — when the saved data was last updated. */
function savedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return "";
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? ` at ${time}`
    : ` on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${time}`;
}
