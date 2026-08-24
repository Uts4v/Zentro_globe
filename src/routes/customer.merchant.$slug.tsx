// routes/customer.merchant.$slug.tsx — Merchant-specific customer dashboard (QR entry)
//
// Flow:
// 1. Customer opens /customer/merchant/{slug}
// 2. Guest → redirect to /auth?redirect=/customer/merchant/{slug}
// 3. After login → join merchant on backend → show merchant dashboard
// 4. Returning customer → join (idempotent) → dashboard directly

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import { useEffect, useState } from "react";
import {
  Loader2,
  ArrowRight,
  MapPin,
  Flame,
  Sparkles,
  ShoppingBag,
  Gift,
  Trophy,
  ArrowLeftRight,
  Utensils,
} from "lucide-react";
import {
  merchantApi,
  customerApi,
  type MerchantProfile,
  type CustomerMerchantWallet,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { MobileShell } from "@/components/MobileShell";
import { TodaySpecialPopup } from "@/components/TodaySpecialPopup";
import { useMerchantTheme } from "@/lib/merchant-theme";

export const Route = createFileRoute("/customer/merchant/$slug")({
  head: () => ({ meta: [{ title: "Your store · Zentro" }] }),
  component: CustomerMerchantDashboard,
});

function CustomerMerchantDashboard() {
  const { add } = useStore();
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { setSelectedMerchant, activeTable, setActiveTable } = useStore();
  const { setThemeColor } = useMerchantTheme();

  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [wallet, setWallet] = useState<CustomerMerchantWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTarget = `/customer/merchant/${slug}`;

  // Resolve merchant by slug (backend verifies existence)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    merchantApi
      .bySlug(slug)
      .then((m) => {
        if (!cancelled) setMerchant(m);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't find that store. Check the link and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Apply merchant theme color globally while on this page
  useEffect(() => {
    if (merchant?.store_theme_color) {
      setThemeColor(merchant.store_theme_color);
      const root = document.documentElement;
      root.style.setProperty("--merchant-color", merchant.store_theme_color);
      const alpha = (a: number) => {
        const r = parseInt(merchant.store_theme_color!.slice(1, 3), 16);
        const g = parseInt(merchant.store_theme_color!.slice(3, 5), 16);
        const b = parseInt(merchant.store_theme_color!.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      };
      root.style.setProperty("--merchant-light", alpha(0.1));
      root.style.setProperty("--merchant-mid", alpha(0.2));
      return () => {
        setThemeColor("");
        root.style.removeProperty("--merchant-color");
        root.style.removeProperty("--merchant-light");
        root.style.removeProperty("--merchant-mid");
      };
    }
  }, [merchant?.store_theme_color, setThemeColor]);

  // Logged-in customer → join merchant + load wallet
  useEffect(() => {
    if (authLoading || loading || !merchant || !user || user.role !== "customer") return;

    let cancelled = false;
    setJoining(true);

    customerApi
      .joinMerchant(slug)
      .then(({ wallet: w }) => {
        if (cancelled) return;
        setSelectedMerchant(String(merchant.id));
        setWallet(w);
      })
      .catch(() => {
        if (!cancelled) setError("Could not link you to this store. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setJoining(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, loading, merchant, user, slug, setSelectedMerchant]);

  if (loading || authLoading || joining || (user?.role === "customer" && !wallet && !error)) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {merchant ? `Opening ${merchant.business_name}…` : "Loading…"}
        </p>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-4xl">🔍</p>
        <p className="text-sm text-muted-foreground">{error ?? "Store not found."}</p>
        <Link
          to="/"
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const tier = wallet?.tier_level ?? "bronze";
  const points = wallet?.points_balance ?? 0;
  const streak = wallet?.streak_days ?? 0;

  return (
    <MobileShell>
      <div className="px-5 pt-6">
        <Link to="/" className="inline-flex items-center text-foreground" aria-label="Zentro home">
          <ZentroLogo className="h-6 w-auto" title="" />
        </Link>

        <div className="mt-8">
          <div
            className="grid h-14 w-14 place-items-center rounded-2xl text-2xl text-primary-foreground shadow-soft"
            style={{
              backgroundColor: merchant.store_theme_color || "var(--ink)",
              ...(merchant.logo_url
                ? {
                    backgroundImage: `url(${merchant.logo_url})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : {}),
            }}
          >
            {!merchant.logo_url && "☕"}
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {merchant.is_open ? "Your store" : "Currently closed"}
          </p>
          <h1 className="font-display mt-1 text-4xl leading-tight text-foreground">
            {merchant.business_name}
          </h1>
          {merchant.address && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" /> {merchant.address}
            </p>
          )}
        </div>

        {/* Table context banner */}
        {activeTable && activeTable.merchantSlug === slug && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-blue-50 border border-blue-100 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <Utensils className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">Dine-in · {activeTable.tableName}</p>
              <p className="text-xs text-blue-500">Your order will be placed at this table</p>
            </div>
            <button
              onClick={() => setActiveTable(null)}
              className="text-xs text-blue-600 underline"
            >
              Clear
            </button>
          </div>
        )}

        {/* Merchant-scoped loyalty card */}
        <div className="glass-strong relative mt-8 overflow-hidden rounded-[28px] p-6">
          {/* Subtle merchant color accent blob */}
          {merchant.store_theme_color && (
            <div
              className="absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20 blur-3xl transition-colors duration-500"
              style={{ background: merchant.store_theme_color }}
            />
          )}
          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Your balance
              </p>
              <p className="font-display mt-1 text-5xl text-foreground">{points}</p>
              <p className="text-sm text-muted-foreground">points at {merchant.business_name}</p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-xs font-medium capitalize text-white transition-colors duration-300"
              style={{ background: merchant.store_theme_color || "var(--ink)" }}
            >
              {tier}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-300"
              style={
                merchant.store_theme_color
                  ? {
                      background: `var(--merchant-light, ${merchant.store_theme_color}1a)`,
                      color: merchant.store_theme_color,
                    }
                  : {}
              }
            >
              <Flame className="h-3 w-3" /> {streak}-day streak
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-300"
              style={
                merchant.store_theme_color
                  ? {
                      background: `var(--merchant-light, ${merchant.store_theme_color}1a)`,
                      color: merchant.store_theme_color,
                    }
                  : {}
              }
            >
              <Sparkles className="h-3 w-3" /> {wallet?.lifetime_points ?? 0} lifetime
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-300"
              style={
                merchant.store_theme_color
                  ? {
                      background: `var(--merchant-light, ${merchant.store_theme_color}1a)`,
                      color: merchant.store_theme_color,
                    }
                  : {}
              }
            >
              {wallet?.order_count ?? 0} orders here
            </span>
          </div>
        </div>

        {/* Quick actions — all scoped to this merchant via selectedMerchantId */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Link
            to="/"
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 transition-transform active:scale-[0.98]"
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300"
              style={{
                background: merchant.store_theme_color
                  ? `var(--merchant-light, ${merchant.store_theme_color}1a)`
                  : "var(--muted)",
                color: merchant.store_theme_color || "var(--ember)",
              }}
            >
              <ShoppingBag className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Order</span>
            <span className="text-[11px] text-muted-foreground">Browse menu</span>
          </Link>
          <Link
            to="/loyalty"
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 transition-transform active:scale-[0.98]"
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300"
              style={{
                background: merchant.store_theme_color
                  ? `var(--merchant-light, ${merchant.store_theme_color}1a)`
                  : "var(--muted)",
                color: merchant.store_theme_color || "var(--ember)",
              }}
            >
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Loyalty</span>
            <span className="text-[11px] text-muted-foreground">Punch card & missions</span>
          </Link>
          <Link
            to="/rewards"
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 transition-transform active:scale-[0.98]"
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300"
              style={{
                background: merchant.store_theme_color
                  ? `var(--merchant-light, ${merchant.store_theme_color}1a)`
                  : "var(--muted)",
                color: merchant.store_theme_color || "var(--ember)",
              }}
            >
              <Gift className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Rewards</span>
            <span className="text-[11px] text-muted-foreground">Redeem points</span>
          </Link>
          <Link
            to="/leaderboard"
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 transition-transform active:scale-[0.98]"
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300"
              style={{
                background: merchant.store_theme_color
                  ? `var(--merchant-light, ${merchant.store_theme_color}1a)`
                  : "var(--muted)",
                color: merchant.store_theme_color || "var(--ember)",
              }}
            >
              <Trophy className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Leaderboard</span>
            <span className="text-[11px] text-muted-foreground">Top customers</span>
          </Link>
          <Link
            to="/transfers"
            search={{ code: undefined }}
            className="glass flex flex-col items-start gap-2 rounded-2xl p-4 transition-transform active:scale-[0.98]"
          >
            <div
              className="grid h-9 w-9 place-items-center rounded-xl transition-colors duration-300"
              style={{
                background: merchant.store_theme_color
                  ? `var(--merchant-light, ${merchant.store_theme_color}1a)`
                  : "var(--muted)",
                color: merchant.store_theme_color || "var(--ember)",
              }}
            >
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-foreground">Transfer</span>
            <span className="text-[11px] text-muted-foreground">Send & receive points</span>
          </Link>
        </div>

        {merchant.description && (
          <p className="mt-6 text-sm text-muted-foreground">{merchant.description}</p>
        )}
      </div>
    </MobileShell>
  );
}
