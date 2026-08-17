// src/routes/merchant.tsx
import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
  redirect,
} from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import {
  LayoutDashboard,
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
} from "lucide-react";
import { MerchantNav } from "@/components/merchant-nav";
import { ThemeCycleButton } from "@/components/ThemeCycleButton";
import { ChatWidget } from "@/features/ai/components/ChatWidget";

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

const navItems = [
  { to: "/merchant/", label: "Overview", icon: LayoutDashboard },
  { to: "/merchant/orders", label: "Orders", icon: ShoppingBag },
  { to: "/merchant/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/merchant/tables", label: "Tables & QR", icon: QrCode },
  { to: "/merchant/loyalty", label: "Loyalty", icon: Trophy },
  { to: "/merchant/customers", label: "Customers", icon: Users },
  { to: "/merchant/specials", label: "Today's Special", icon: Sparkles },
  { to: "/merchant/preparation", label: "Preparation", icon: ChefHat },
  { to: "/merchant/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/merchant/ai", label: "AI Assistant", icon: Bot },
  { to: "/merchant/store", label: "Store", icon: Store },
  { to: "/pos", label: "POS Terminal", icon: Monitor },
];

function MerchantLayout() {
  const { merchantProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth/merchant" as any, replace: true });
  }

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-background lg:flex">
        <MerchantNav navItems={navItems} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <aside
            className="absolute bottom-0 left-0 top-0 flex w-64 flex-col bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <MerchantNav
              navItems={navItems}
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
          <Link to="/" className="font-display text-xl text-foreground">
            zentro<span className="text-ember">.</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <ThemeCycleButton />
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
      <ChatWidget />
    </div>
  );
}
