import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { usePosStore } from "../store";
import WorkerPinPad from "./WorkerPinPad";
import ShiftOpenScreen from "./ShiftOpenScreen";
import ShiftCloseScreen from "./ShiftCloseScreen";
import SyncStatusBar from "./SyncStatusBar";
import NotificationBell from "./NotificationBell";
import { useBackgroundSync } from "../offline/hooks";
import {
  ShoppingCart,
  Clock,
  Settings,
  LogOut,
  Wifi,
  WifiOff,
  User,
  Wallet,
  CreditCard,
  BarChart3,
  AlertTriangle,
  Calendar,
  Users,
  Loader2,
  LayoutDashboard,
  HandCoins,
} from "lucide-react";
import { posListWorkers, posAuthorizeDevice, posBootstrap, posDeviceBootstrap } from "../api";
import { useState, useEffect } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";

function NavItem({
  to,
  label,
  icon: Icon,
  active,
  badge,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link
      to={to as any}
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-ink text-white"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto rounded-full bg-ember px-2 py-0.5 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
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
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showShiftClose, setShowShiftClose] = useState(false);
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

        if (deviceId && deviceToken) {
          try {
            const resp = await posDeviceBootstrap(deviceId, deviceToken);
            bootstrap(resp);
            setInitializing(false);
            return;
          } catch {
            // Device token may be stale — try JWT-based bootstrap as fallback
            try {
              const resp = await posBootstrap(deviceId);
              bootstrap(resp);
              setInitializing(false);
              return;
            } catch {
              // Both failed — clear device and re-authorize
              localStorage.removeItem("pos_device_id");
              localStorage.removeItem("pos_device_token");
            }
          }
        }

        // Step 2: No device or device stale — authorize new one (requires JWT)
        const platform = navigator.userAgent.includes("Mobile") ? "mobile" : "desktop";
        const deviceName = `POS-${platform}-${Date.now()}`;
        const result = await posAuthorizeDevice(
          deviceName,
          platform,
          navigator.userAgent,
        );

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

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

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
    return (
      <WorkerPinPad
        onLoggedIn={(worker) => setCurrentWorker(worker)}
      />
    );
  }

  // ── Determine which page the user is on ──
  const pathname = routerState.location.pathname;
  const isOrderPage = pathname === "/pos" || pathname === "/pos/";
  const isShiftRequiredPage = isOrderPage;

  // ── Step 2b: Closing shift ──
  if (showShiftClose) {
    return (
      <ShiftCloseScreen
        onShiftClosed={(shift) => {
          setActiveShift(null);
          setCurrentWorker(null);
          setShowShiftClose(false);
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-background lg:flex">
        {/* Logo */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="font-display text-xl text-foreground">
              zentro<span className="text-ember">.</span>
            </Link>
            <span className="ml-1 rounded-md bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink">
              POS
            </span>
          </div>
          <NotificationBell />
        </div>

        {/* Merchant + worker info */}
        <div className="border-b border-border px-5 py-3">
          {merchant && (
            <p className="truncate text-xs font-medium text-foreground">
              {merchant.business_name}
            </p>
          )}
          {currentWorker && (
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="h-3 w-3" />
              {currentWorker.display_name}
            </p>
          )}
          {/* Shift badge */}
          {activeShift && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700">
              <Wallet className="h-3 w-3" />
              Shift active — {activeShift.total_orders} orders
            </div>
          )}
          {!activeShift && (
            <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
              <Wallet className="h-3 w-3" />
              No active shift
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          <NavItem to="/pos" label="Order" icon={ShoppingCart} badge={cartCount} />
          <NavItem to="/pos/orders" label="Orders" icon={Clock} />
          <NavItem to="/pos/preparation" label="Preparation" icon={AlertTriangle} />
          <NavItem to="/pos/accounts" label="Accounts" icon={CreditCard} />
          <NavItem to="/pos/cash-movements" label="Cash In/Out" icon={HandCoins} />
          <NavItem to="/pos/reports" label="Reports" icon={BarChart3} />
          <NavItem to="/pos/conflicts" label="Conflicts" icon={AlertTriangle} />
          <NavItem to="/pos/schedule" label="Schedule" icon={Calendar} />
          <NavItem to="/pos/staff" label="Staff" icon={Users} />
          <NavItem to="/merchant" label="Dashboard" icon={LayoutDashboard} />
          <NavItem to="/pos/settings" label="Settings" icon={Settings} />
        </nav>

        {/* Footer */}
        <div className="border-t border-border px-3 py-3 space-y-2">
          {/* Sync status */}
          <div className="px-1">
            <SyncStatusBar />
          </div>
          {/* Theme toggle */}
          <div className="px-1 py-1">
            <ThemeToggle />
          </div>
          {/* Close shift button */}
          {activeShift && (
            <button
              onClick={() => setShowShiftClose(true)}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-amber-600 hover:bg-amber-50"
            >
              <Wallet className="h-4 w-4" />
              <span>Close Shift</span>
            </button>
          )}
          {/* Open shift button */}
          {!activeShift && (
            <button
              onClick={() => navigate({ to: "/pos" })}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-green-600 hover:bg-green-50"
            >
              <Wallet className="h-4 w-4" />
              <span>Open Shift</span>
            </button>
          )}
          {/* Online/Offline indicator */}
          <div className="flex items-center gap-2 px-3 text-xs text-muted-foreground">
            {isOnline ? (
              <>
                <Wifi className="h-3 w-3 text-green-500" />
                <span>Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 text-amber-500" />
                <span className="text-amber-600">Offline</span>
              </>
            )}
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-3 lg:hidden">
          <Link to="/" className="font-display text-xl text-foreground">
            zentro<span className="text-ember">.</span>
          </Link>
          <span className="rounded-md bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink">
            POS
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeCycleButton />
            {isOnline ? (
              <Wifi className="h-4 w-4 text-green-500" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-500" />
            )}
            {activeShift && (
              <button
                onClick={() => setShowShiftClose(true)}
                className="rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700"
              >
                CLOSE SHIFT
              </button>
            )}
            {!activeShift && (
              <button
                onClick={() => navigate({ to: "/pos" })}
                className="rounded-lg bg-green-100 px-2 py-1 text-[10px] font-bold text-green-700"
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {/* If on order page and no active shift, show shift open screen */}
          {isShiftRequiredPage && !activeShift ? (
            <div className="flex h-full items-center justify-center">
              <ShiftOpenScreen
                onShiftOpened={(shift) => setActiveShift(shift)}
              />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
