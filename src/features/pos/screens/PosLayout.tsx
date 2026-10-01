import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { usePosStore, loadSavedBootstrap, isConnectionError } from "../store";
import WorkerPinPad from "./WorkerPinPad";
import ShiftOpenScreen from "./ShiftOpenScreen";
import ShiftCloseScreen from "./ShiftCloseScreen";
import SyncStatusBar from "./SyncStatusBar";
import PendingOfflineKOTs from "./PendingOfflineKOTs";
import NotificationBell from "./NotificationBell";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import { useBackgroundSync, useOnlineStatus } from "../offline/hooks";
import { OFFLINE_POS_ROUTES, warmPosOfflineCache } from "../offline/warm-cache";
import { checkConnectivity } from "@/lib/connectivity";
import {
  Bell,
  ShoppingCart,
  Clock,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  Wallet,
  CreditCard,
  BarChart3,
  AlertTriangle,
  Calendar,
  Users,
  Loader2,
  LayoutDashboard,
  HandCoins,
  Menu,
} from "lucide-react";
import { posListWorkers, posAuthorizeDevice, posBootstrap, posDeviceBootstrap } from "../api";
import { useState, useEffect, useCallback } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";

const NEEDS_CONNECTION = "Needs a connection — not available offline";

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  badge,
  onClick,
  disabled,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        title={NEEDS_CONNECTION}
        className="flex cursor-not-allowed items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground/40"
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <Link
      to={to as any}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-colors ${
        active
          ? "bg-ember-soft font-semibold text-ember"
          : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-ember px-2 py-0.5 text-xs font-bold text-white">
          {badge}
        </span>
      )}
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
 * The POS menu. Offline, only taking orders and looking at them can work
 * without the server, so every other screen is shown but cannot be opened.
 */
function PosNav({
  offline,
  isOrderPage,
  isOrdersPage,
  cartCount,
  onNavigate,
}: {
  offline: boolean;
  isOrderPage: boolean;
  isOrdersPage: boolean;
  cartCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 pt-2 pb-4">
      <NavSection title="Operations">
        <NavItem
          to="/pos"
          label="Order"
          icon={ShoppingCart}
          badge={cartCount}
          active={isOrderPage}
          onClick={onNavigate}
        />
        <NavItem
          to="/pos/orders"
          label="Orders"
          icon={Clock}
          active={isOrdersPage}
          onClick={onNavigate}
        />
        <NavItem
          to="/pos/preparation"
          label="Preparation"
          icon={AlertTriangle}
          onClick={onNavigate}
          disabled={offline}
        />
        <NavItem
          to="/pos/conflicts"
          label="Conflicts"
          icon={AlertTriangle}
          onClick={onNavigate}
          disabled={offline}
        />
      </NavSection>
      <NavSection title="Money">
        <NavItem
          to="/pos/accounts"
          label="Accounts"
          icon={CreditCard}
          onClick={onNavigate}
          disabled={offline}
        />
        <NavItem
          to="/pos/cash-movements"
          label="Cash In/Out"
          icon={HandCoins}
          onClick={onNavigate}
          disabled={offline}
        />
        <NavItem
          to="/pos/reports"
          label="Reports"
          icon={BarChart3}
          onClick={onNavigate}
          disabled={offline}
        />
      </NavSection>
      <NavSection title="Team">
        <NavItem
          to="/pos/schedule"
          label="Schedule"
          icon={Calendar}
          onClick={onNavigate}
          disabled={offline}
        />
        <NavItem
          to="/pos/staff"
          label="Staff"
          icon={Users}
          onClick={onNavigate}
          disabled={offline}
        />
      </NavSection>
      <NavSection title="Manage">
        <NavItem
          to="/merchant"
          label="Dashboard"
          icon={LayoutDashboard}
          onClick={onNavigate}
          disabled={offline}
        />
        <NavItem
          to="/pos/settings"
          label="Settings"
          icon={Settings}
          onClick={onNavigate}
          disabled={offline}
        />
      </NavSection>
    </nav>
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
  const router = useRouter();
  const routerState = useRouterState();
  const merchant = usePosStore((s) => s.merchant);
  const device = usePosStore((s) => s.device);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const activeShift = usePosStore((s) => s.activeShift);
  const cart = usePosStore((s) => s.cart);
  const setCurrentWorker = usePosStore((s) => s.setCurrentWorker);
  const setActiveShift = usePosStore((s) => s.setActiveShift);
  const isOnline = useOnlineStatus();
  const [showShiftClose, setShowShiftClose] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const workers = usePosStore((s) => s.workers);
  const setWorkers = usePosStore((s) => s.setWorkers);
  const setMerchantStore = usePosStore((s) => s.setMerchant);
  const setDevice = usePosStore((s) => s.setDevice);
  const bootstrap = usePosStore((s) => s.bootstrap);

  // Initialize POS: try device-token auth first, then fall back to JWT flow
  useEffect(() => {
    if (merchant && device) {
      setInitializing(false);
      return;
    }

    async function init() {
      try {
        setInitializing(true);
        setInitError(null);

        // Step 1: Try device-token bootstrap (no JWT needed — survives refresh)
        const deviceId = localStorage.getItem("pos_device_id");
        const deviceToken = localStorage.getItem("pos_device_token");

        // The copy saved on this device is used ONLY when the server cannot be
        // reached, and the POS then says so (see the banner below). A server
        // error is never hidden behind saved data.
        const saved = loadSavedBootstrap();
        const showSaved = () => {
          if (!saved) return false;
          bootstrap(saved.data, { savedAt: saved.savedAt });
          setInitializing(false);
          return true;
        };
        if (!navigator.onLine && showSaved()) return;

        if (deviceId && deviceToken) {
          try {
            const resp = await posDeviceBootstrap(deviceId, deviceToken);
            bootstrap(resp);
            setInitializing(false);
            return;
          } catch (err: unknown) {
            if (isConnectionError(err) && showSaved()) return;
            // The server answered (e.g. the device token is stale) — try the
            // signed-in account instead.
            try {
              const resp = await posBootstrap(deviceId);
              bootstrap(resp);
              setInitializing(false);
              return;
            } catch (jwtErr: unknown) {
              if (isConnectionError(jwtErr) && showSaved()) return;
              // Both failed with server responses — clear device and re-authorize
              localStorage.removeItem("pos_device_id");
              localStorage.removeItem("pos_device_token");
            }
          }
        }

        // Step 2: No device or device stale — authorize new one (requires JWT)
        const platform = navigator.userAgent.includes("Mobile") ? "mobile" : "desktop";
        const deviceName = `POS-${platform}-${Date.now()}`;
        const result = await posAuthorizeDevice(deviceName, platform, navigator.userAgent);

        localStorage.setItem("pos_device_id", result.device.id);
        localStorage.setItem("pos_device_token", result.device_token);
        setDevice(result.device, result.device_token);

        const resp = await posBootstrap(result.device.id);
        bootstrap(resp);
        setInitializing(false);
      } catch (err: any) {
        setInitError(err?.message || "Failed to initialize POS");
        setInitializing(false);
      }
    }

    init();
  }, []);

  // Start background sync
  useBackgroundSync();

  // While the connection is up, save what the offline screens need so the POS
  // can be reopened without one.
  useEffect(() => {
    if (initializing || !isOnline) return;
    warmPosOfflineCache(() =>
      Promise.all(OFFLINE_POS_ROUTES.map((to) => router.preloadRoute({ to }))),
    );
  }, [initializing, isOnline, router]);

  // Replace saved data with live data as soon as the server is reachable.
  const savedDataFrom = usePosStore((s) => s.savedDataFrom);
  const [refreshing, setRefreshing] = useState(false);
  const refreshFromServer = useCallback(async () => {
    const deviceId = localStorage.getItem("pos_device_id");
    if (!deviceId) return;
    setRefreshing(true);
    const deviceToken = localStorage.getItem("pos_device_token");
    try {
      let resp;
      try {
        if (!deviceToken) throw new Error("no device token");
        resp = await posDeviceBootstrap(deviceId, deviceToken);
      } catch {
        resp = await posBootstrap(deviceId);
      }
      bootstrap(resp);
    } catch {
      // still unreachable — keep the saved data and the banner
    } finally {
      setRefreshing(false);
    }
  }, [bootstrap]);

  useEffect(() => {
    if (!savedDataFrom || !isOnline) return;
    refreshFromServer();
    const timer = setInterval(refreshFromServer, 30000);
    return () => clearInterval(timer);
  }, [savedDataFrom, isOnline, refreshFromServer]);

  /** "Try again" on the offline banner: ask the server now, not on the next poll. */
  async function retryConnection() {
    setRefreshing(true);
    try {
      await checkConnectivity();
    } finally {
      setRefreshing(false);
    }
    if (savedDataFrom) await refreshFromServer();
  }

  async function handleSignOut() {
    setCurrentWorker(null);
    await signOut();
    navigate({ to: "/auth/merchant" as any, replace: true });
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
        onShiftClosed={(shift) => {
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
              <p className="truncate text-xs text-muted-foreground">
                {merchant?.business_name}
              </p>
            </div>
          </div>
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
        <PosNav
          offline={offline}
          isOrderPage={isOrderPage}
          isOrdersPage={isOrdersPage}
          cartCount={cartCount}
        />

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
              disabled={offline}
              title={offline ? NEEDS_CONNECTION : undefined}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-amber-600 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Wallet className="h-4 w-4" />
              <span>Close Shift</span>
            </button>
          ) : (
            <button
              onClick={() => navigate({ to: "/pos" })}
              disabled={offline}
              title={offline ? NEEDS_CONNECTION : undefined}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-green-600 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Wallet className="h-4 w-4" />
              <span>Open Shift</span>
            </button>
          )}
          {/* Online / offline */}
          <div className="flex items-center gap-2 px-4 text-xs text-muted-foreground">
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
          </div>
          {/* Signing out offline would lock the device out: signing back in
              needs the server, and so does sending the orders saved here. */}
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
                disabled={offline}
                title={offline ? NEEDS_CONNECTION : undefined}
                className="hidden rounded-lg bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
              >
                CLOSE SHIFT
              </button>
            )}
            {!activeShift && (
              <button
                onClick={() => navigate({ to: "/pos" })}
                disabled={offline}
                title={offline ? NEEDS_CONNECTION : undefined}
                className="hidden rounded-lg bg-green-100 px-2 py-1 text-xs font-bold text-green-700 disabled:cursor-not-allowed disabled:opacity-40 sm:block"
              >
                OPEN SHIFT
              </button>
            )}
            {currentWorker && (
              <div className="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-medium text-white">
                {currentWorker.display_name.charAt(0).toUpperCase()}
              </div>
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
              <PosNav
                offline={offline}
                isOrderPage={isOrderPage}
                isOrdersPage={isOrdersPage}
                cartCount={cartCount}
                onNavigate={() => setMobileNavOpen(false)}
              />
              <div className="space-y-2 border-t border-border p-3">
                {/* Sync and the offline tickets live in the sidebar on a wide
                    screen; a phone or tablet only has this drawer. */}
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
              </div>
            </aside>
          </div>
        )}

        {(offline || savedDataFrom) && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            <span>
              {offline ? (
                <>
                  <strong>Offline mode.</strong> Only Order and Orders are available. KOT and bill
                  printing still work.
                </>
              ) : (
                <strong>Can&apos;t reach the server.</strong>
              )}
              {savedDataFrom && (
                <>
                  {" "}
                  Showing data saved on this device{savedLabel(savedDataFrom)}. New tables, menu
                  changes and customer orders may be missing.
                </>
              )}{" "}
              Orders you take are saved here and sent when the connection is back.
            </span>
            <button
              type="button"
              onClick={retryConnection}
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
