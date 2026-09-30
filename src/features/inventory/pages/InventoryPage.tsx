// src/features/inventory/pages/InventoryPage.tsx
// Task-based Inventory. Navigation shows only what the acting role may use;
// the backend enforces the same rules on every request.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  ClipboardCheck,
  FileUp,
  History,
  LayoutDashboard,
  Package,
  Settings,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorBlock, ListSkeleton, errorMessage } from "@/features/inventory/components/bits";
import { StaffBanner, StartStaffModeDialog } from "@/features/inventory/components/StaffMode";
import { copy } from "@/features/inventory/copy";
import {
  InventoryProvider,
  P,
  useRootQuery,
  type NavParams,
  type View,
} from "@/features/inventory/context";
import { HomeScreen } from "@/features/inventory/screens/HomeScreen";
import { StockScreen } from "@/features/inventory/screens/StockScreen";
import { CountScreen } from "@/features/inventory/screens/CountScreen";
import { ActionsScreen } from "@/features/inventory/screens/ActionsScreen";
import { DeliveryScreen } from "@/features/inventory/screens/DeliveryScreen";
import {
  FixScreen,
  MoveScreen,
  WasteScreen,
} from "@/features/inventory/screens/StockChangeScreens";
import { HistoryScreen } from "@/features/inventory/screens/HistoryScreen";
import { ReportsScreen } from "@/features/inventory/screens/ReportsScreen";
import { ImportExportScreen } from "@/features/inventory/screens/ImportExportScreen";
import { SettingsScreen } from "@/features/inventory/screens/SettingsScreen";
import { SuppliersTab } from "@/features/inventory/screens/SuppliersScreen";

const VIEWS: View[] = [
  "home",
  "stock",
  "count",
  "actions",
  "delivery",
  "move",
  "waste",
  "fix",
  "suppliers",
  "reports",
  "history",
  "io",
  "settings",
];

// Which permission each screen needs (mirrors the backend).
const VIEW_PERM: Record<View, string | string[]> = {
  home: P.VIEW,
  stock: P.VIEW,
  count: P.COUNT,
  actions: [P.RECEIVE, P.TRANSFER, P.RECORD_WASTE, P.ADJUST],
  delivery: P.RECEIVE,
  move: P.TRANSFER,
  waste: P.RECORD_WASTE,
  fix: P.ADJUST,
  suppliers: [P.MANAGE_SUPPLIERS, P.PURCHASE],
  reports: P.VIEW_REPORTS,
  history: P.VIEW_REPORTS,
  io: [P.IMPORT, P.VIEW_REPORTS],
  settings: [P.MANAGE_SETTINGS],
};

const NAV: { view: View; label: string; icon: LucideIcon; covers?: View[] }[] = [
  { view: "home", label: copy.nav.overview, icon: LayoutDashboard },
  { view: "stock", label: copy.nav.stock, icon: Package },
  { view: "count", label: copy.nav.count, icon: ClipboardCheck },
  {
    view: "actions",
    label: copy.nav.actions,
    icon: ArrowLeftRight,
    covers: ["delivery", "move", "waste", "fix"],
  },
  { view: "suppliers", label: copy.nav.suppliers, icon: Building2 },
  { view: "reports", label: copy.nav.reports, icon: BarChart3 },
  { view: "history", label: copy.nav.history, icon: History },
  { view: "io", label: copy.nav.importExport, icon: FileUp },
  { view: "settings", label: copy.nav.settings, icon: Settings },
];

type Search = { view?: string } & { [K in keyof NavParams]?: NavParams[K] | string };

function toNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function InventoryPage() {
  const { merchantProfile } = useAuth();
  const sym = merchantProfile?.currency_symbol || "Rs";
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const rootQuery = useRootQuery();
  const [staffOpen, setStaffOpen] = useState(false);

  const view: View = VIEWS.includes(search.view as View) ? (search.view as View) : "home";
  const params: NavParams = {
    item: toNumber(search.item),
    count: toNumber(search.count),
    location: toNumber(search.location),
    import: toNumber(search.import),
    report: typeof search.report === "string" ? search.report : undefined,
  };

  const go = useCallback(
    (next: View, nextParams: NavParams = {}) => {
      navigate({
        to: "/merchant/inventory",
        search: (next === "home" ? {} : { view: next, ...nextParams }) as never,
      });
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    },
    [navigate],
  );

  const root = rootQuery.data;
  const can = (perm: string | string[]) =>
    Boolean(root) && (Array.isArray(perm) ? perm : [perm]).some((p) => root!.permissions[p]);

  // A screen the role may not use (e.g. after switching to staff) → home.
  useEffect(() => {
    if (root && !can(VIEW_PERM[view])) go("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, view]);

  if (rootQuery.isLoading) return <ListSkeleton rows={5} />;
  if (rootQuery.isError || !root) {
    return (
      <ErrorBlock
        message={errorMessage(rootQuery.error, copy.errors.load)}
        onRetry={() => rootQuery.refetch()}
      />
    );
  }

  const nav = NAV.filter((n) => can(VIEW_PERM[n.view]));
  const active = NAV.find((n) => n.view === view || n.covers?.includes(view))?.view ?? "home";

  return (
    <InventoryProvider root={root} sym={sym} view={view} params={params} go={go}>
      <div className="space-y-6 pb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{root.business_name}</p>
            <h1 className="font-display text-3xl font-semibold text-foreground sm:text-4xl">
              {copy.nav.title}
            </h1>
          </div>
          {!root.staff && root.staff_mode_available && (
            <Button variant="outline" className="h-11" onClick={() => setStaffOpen(true)}>
              <UserRound className="h-4 w-4" aria-hidden="true" /> {copy.staff.start}
            </Button>
          )}
        </div>

        {root.staff && <StaffBanner name={root.staff.name} />}

        <nav aria-label={copy.nav.title} className="-mx-1 overflow-x-auto px-1">
          <ul className="flex min-w-max gap-1.5 rounded-2xl border border-border bg-card p-1.5">
            {nav.map((n) => {
              const isActive = n.view === active;
              return (
                <li key={n.view}>
                  <button
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => go(n.view)}
                    className={cn(
                      "flex h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-primary text-primary-foreground shadow"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <n.icon className="h-4 w-4" aria-hidden="true" />
                    {n.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div>
          {view === "home" && <HomeScreen />}
          {view === "stock" && <StockScreen key={`stock-${params.item ?? ""}`} />}
          {view === "count" && <CountScreen key={`count-${params.count ?? "start"}`} />}
          {view === "actions" && <ActionsScreen />}
          {view === "delivery" && <DeliveryScreen key={`delivery-${params.item ?? ""}`} />}
          {view === "move" && <MoveScreen key={`move-${params.item ?? ""}`} />}
          {view === "waste" && <WasteScreen key={`waste-${params.item ?? ""}`} />}
          {view === "fix" && <FixScreen key={`fix-${params.item ?? ""}`} />}
          {view === "suppliers" && (
            <SuppliersTab
              sym={sym}
              canCost={root.permissions[P.VIEW_COST]}
              onBack={() => go("home")}
            />
          )}
          {view === "reports" && <ReportsScreen />}
          {view === "history" && <HistoryScreen key={`history-${params.item ?? ""}`} />}
          {view === "io" && <ImportExportScreen key={`io-${params.import ?? ""}`} />}
          {view === "settings" && <SettingsScreen />}
        </div>
      </div>
      <StartStaffModeDialog open={staffOpen} onOpenChange={setStaffOpen} />
    </InventoryProvider>
  );
}
