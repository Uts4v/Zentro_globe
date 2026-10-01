// src/routes/merchant.tsx
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import {
  LayoutDashboard,
  TicketPercent,
  ScanLine,
  ShoppingBag,
  UtensilsCrossed,
  Trophy,
  BarChart3,
  Store,
  Menu,
  Sparkles,
  QrCode,
  Monitor,
  LogOut,
  ChefHat,
  Bot,
  Users,
  FileText,
  Settings,
  FileType,
  Package,
  UsersRound,
} from "lucide-react";
import { NoAccess, useAccess, type Perm } from "@/features/team/access";
import { StaffBanner, StartStaffModeButton } from "@/features/team/StaffMode";
import { MerchantNav } from "@/components/merchant-nav";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";
import { ChatWidget } from "@/features/ai/components/ChatWidget";
import MerchantNotificationBell from "@/components/MerchantNotificationBell";

export const Route = createFileRoute("/merchant")({
  beforeLoad: async ({ context, location }) => {
    await requireMerchant();
    const { auth } = context;

    if (!auth) return;

    if (auth.merchantProfile && !auth.merchantProfile.onboarding_complete) {
      if (location.pathname !== "/merchant/onboarding") {
        throw redirect({ to: "/merchant/onboarding" });
      }
    }
  },
  component: MerchantLayout,
});

// `perm` is what an employee's role needs to see the page (any one of them).
// The owner (Admin) sees everything; the server enforces the same rules.
const INVENTORY_PERMS = [
  "inventory.view",
  "inventory.count",
  "inventory.receive",
  "inventory.transfer",
  "inventory.waste",
  "inventory.adjust",
  "inventory.manage",
];
const navItems: {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  section: string;
  perm: Perm;
  disabled?: boolean;
  badge?: string;
}[] = [
  {
    to: "/merchant/",
    label: "Overview",
    icon: LayoutDashboard,
    section: "Dashboard",
    perm: "reports.view",
  },
  {
    to: "/merchant/analytics",
    label: "Analytics",
    icon: BarChart3,
    section: "Dashboard",
    perm: "reports.view",
  },
  {
    to: "/merchant/reports",
    label: "Reports",
    icon: FileText,
    section: "Dashboard",
    perm: "reports.view",
  },
  {
    to: "/merchant/orders",
    label: "Orders",
    icon: ShoppingBag,
    section: "Operations",
    perm: ["orders.create", "pos.access"],
  },
  {
    to: "/merchant/inventory",
    label: "Inventory",
    icon: Package,
    section: "Operations",
    perm: INVENTORY_PERMS,
  },
  {
    to: "/merchant/preparation",
    label: "Preparation",
    icon: ChefHat,
    section: "Operations",
    perm: "kds.access",
  },
  {
    to: "/merchant/tables",
    label: "Tables & Areas",
    icon: QrCode,
    section: "Operations",
    perm: ["tables.view", "tables.manage"],
  },
  { to: "/pos", label: "POS Terminal", icon: Monitor, section: "Operations", perm: "pos.access" },
  {
    to: "/merchant/menu",
    label: "Menu",
    icon: UtensilsCrossed,
    section: "Products",
    perm: "menu.manage",
  },
  {
    to: "/merchant/pdf-menu",
    label: "PDF Menu",
    icon: FileType,
    section: "Products",
    perm: "menu.manage",
  },
  {
    to: "/merchant/specials",
    label: "Today's Special",
    icon: Sparkles,
    section: "Products",
    perm: "menu.manage",
  },
  {
    to: "/merchant/customers",
    label: "Customers",
    icon: Users,
    section: "Customers",
    perm: "customers.manage",
  },
  {
    to: "/merchant/loyalty",
    label: "Loyalty",
    icon: Trophy,
    section: "Customers",
    perm: "customers.manage",
  },
  {
    to: "/merchant/offers",
    label: "Offers",
    icon: TicketPercent,
    section: "Customers",
    perm: "customers.manage",
  },
  {
    to: "/merchant/redeem",
    label: "Redeem Offer",
    icon: ScanLine,
    section: "Customers",
    perm: ["pos.access", "customers.manage"],
  },
  {
    to: "/merchant/team",
    label: "Team",
    icon: UsersRound,
    section: "Team",
    perm: ["staff.manage", "roles.manage"],
  },
  {
    to: "/merchant/ai",
    label: "AI Assistant",
    icon: Bot,
    section: "Tools",
    perm: "reports.view",
    disabled: true,
    badge: "Soon",
  },
  {
    to: "/merchant/settings",
    label: "Settings",
    icon: Settings,
    section: "Account",
    perm: "settings.manage",
  },
  {
    to: "/merchant/store",
    label: "Storefront",
    icon: Store,
    section: "Account",
    perm: "settings.manage",
  },
];

function matchNav(pathname: string) {
  const path = pathname.replace(/\/$/, "") || "/merchant";
  if (path === "/merchant") return navItems[0];
  return navItems
    .filter((n) => n.to !== "/merchant/" && path.startsWith(n.to.replace(/\/$/, "")))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

function MerchantLayout() {
  const { merchantProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { access, can, isStaff, isLoading } = useAccess();

  // Employees see only what their role allows; the owner sees everything.
  const visibleNav = access ? navItems.filter((n) => can(n.perm)) : isLoading ? [] : navItems;
  const current = matchNav(pathname);
  const blocked = Boolean(access && current && !can(current.perm));

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth/merchant" as any, replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden border-r border-border bg-background lg:flex">
        <MerchantNav
          navItems={visibleNav}
          onSignOut={handleSignOut}
          bell={<MerchantNotificationBell />}
        />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <aside
            className="absolute bottom-0 left-0 top-0 flex w-64 flex-col overflow-hidden bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <MerchantNav
              navItems={visibleNav}
              onSignOut={handleSignOut}
              onLinkClick={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-4 py-3 lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-muted"
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link
            to="/"
            className="inline-flex items-center text-foreground"
            aria-label="Zentro home"
          >
            <ZentroLogo className="h-6 w-auto" title="" />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeCycleButton />
            <MerchantNotificationBell />
            <button
              onClick={handleSignOut}
              className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              {(merchantProfile?.business_name ?? "M").charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {isStaff && access?.worker && (
          <StaffBanner name={access.worker.name} role={access.role.name} />
        )}
        {access && !isStaff && access.staff_mode_available && (
          <div className="flex justify-end px-4 pt-3 lg:px-8">
            <StartStaffModeButton />
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {blocked ? (
            <NoAccess
              links={visibleNav
                .filter((n) => !n.disabled)
                .slice(0, 4)
                .map((n) => ({ to: n.to, label: n.label }))}
            />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      {!isStaff && <ChatWidget />}
    </div>
  );
}
