import { Link } from "@tanstack/react-router";
import {
  Utensils,
  QrCode,
  Gift,
  Sparkles,
  Zap,
  ArrowRight,
  Store,
  Compass,
  Coffee,
  ShieldCheck,
  Smartphone,
  Flame,
  UserPlus,
  LogIn,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

export function PublicLandingScreen() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      {/* Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2" aria-label="Zentro Home">
            <ZentroLogo className="h-7 w-auto text-foreground" title="Zentro" />
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <Link to="/stores" className="hover:text-foreground transition-colors">
              Explore Cafés
            </Link>
            <Link to="/offers" className="hover:text-foreground transition-colors">
              Deals & Offers
            </Link>
            <Link to="/auth/merchant" className="hover:text-foreground transition-colors">
              For Merchants
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/auth/login"
              search={{ redirect: undefined }}
              className="inline-flex h-9 items-center justify-center rounded-full border border-border px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Sign In
            </Link>
            <Link
              to="/auth/signup"
              search={{ redirect: undefined }}
              className="inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-xs font-semibold text-primary-foreground transition-transform active:scale-95 shadow-soft"
            >
              Join Free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative overflow-hidden px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-24">
          <div className="mx-auto max-w-4xl text-center">
            {/* Pill Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-ember/20 bg-ember/10 px-3.5 py-1.5 text-xs font-semibold text-ember mb-6 animate-fade-in">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Smart Table QR Ordering & Loyalty Platform</span>
            </div>

            {/* Main Headline */}
            <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl sm:leading-[1.1]">
              Dining Made Delightful. <br className="hidden sm:inline" />
              <span className="bg-gradient-to-r from-ember via-orange-500 to-amber-500 bg-clip-text text-transparent">
                Rewards Made Instant.
              </span>
            </h1>

            {/* Subheading */}
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg leading-relaxed">
              Explore top local cafés, bakeries, and restaurants. Scan table QR codes to order with zero app download, collect digital stamps, and redeem exclusive vouchers on every visit.
            </p>

            {/* CTA Buttons */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
              <Link
                to="/stores"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-primary-foreground shadow-soft transition-all hover:opacity-95 active:scale-95"
              >
                <Compass className="h-4 w-4" />
                Explore Cafés & Menus
              </Link>
              <Link
                to="/offers"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-card px-6 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-95"
              >
                <Gift className="h-4 w-4 text-ember" />
                Browse Special Offers
              </Link>
            </div>

            {/* Trust Signals */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Zero App Download Required
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Server-Authoritative Pricing
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Real-Time Kitchen Dispatch
              </span>
            </div>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="border-t border-border/40 bg-muted/20 px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="text-center mb-12">
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                Everything You Need for Effortless Dining
              </h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-xl mx-auto">
                Built from the ground up for seamless diner experiences and modern restaurant operations.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Feature 1 */}
              <div className="glass-strong rounded-3xl p-6 border border-border/50 flex flex-col justify-between">
                <div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-ember/10 text-ember mb-4">
                    <QrCode className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-base text-foreground">Table QR Ordering</h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Scan the code at your table to view visual menus, customize toppings and variants, and place orders directly.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-ember">
                  Fast & Contactless →
                </div>
              </div>

              {/* Feature 2 */}
              <div className="glass-strong rounded-3xl p-6 border border-border/50 flex flex-col justify-between">
                <div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 mb-4">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-base text-foreground">Digital Punch Cards</h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Collect digital stamps automatically on every visit. No paper cards to lose, instant free items upon completion.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-amber-600">
                  Automated Rewards →
                </div>
              </div>

              {/* Feature 3 */}
              <div className="glass-strong rounded-3xl p-6 border border-border/50 flex flex-col justify-between">
                <div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-purple-500/10 text-purple-600 mb-4">
                    <Gift className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-base text-foreground">Member Deals & Offers</h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    Unlock 2-for-1 specials, percentage discounts, and birthday treats curated by your favorite neighborhood restaurants.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-purple-600">
                  Exclusive Savings →
                </div>
              </div>

              {/* Feature 4 */}
              <div className="glass-strong rounded-3xl p-6 border border-border/50 flex flex-col justify-between">
                <div>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-500/10 text-blue-600 mb-4">
                    <Zap className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold text-base text-foreground">Offline-First Cloud POS</h3>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    For merchants: high-velocity cash registers, multi-station kitchen routing, thermal receipt printing, and fiscal reporting.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-border/40 text-[11px] font-medium text-blue-600">
                  Modern Hospitality Tech →
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-4xl">
            <div className="text-center mb-12">
              <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
                How Zentro Works
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Three simple steps to smarter dining.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-soft">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mist text-lg font-bold text-foreground mb-4">
                  1
                </div>
                <h3 className="font-semibold text-sm text-foreground">Scan at Your Table</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Point your phone camera at the table QR code. The live menu opens instantly without signing in.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-soft">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mist text-lg font-bold text-foreground mb-4">
                  2
                </div>
                <h3 className="font-semibold text-sm text-foreground">Order & Track in Kitchen</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Choose your sizes and modifiers. Watch your food status update from Received to Cooking to Ready.
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-6 text-center shadow-soft">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mist text-lg font-bold text-foreground mb-4">
                  3
                </div>
                <h3 className="font-semibold text-sm text-foreground">Earn Loyalty Stamps</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  Join with one click to collect loyalty points, track punch cards, and unlock members-only rewards.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Merchant Partner Banner */}
        <section className="border-t border-border/40 bg-gradient-to-r from-ember/10 via-orange-500/5 to-amber-500/10 px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-4xl rounded-3xl border border-ember/20 bg-background/80 p-8 sm:p-12 text-center backdrop-blur-md shadow-soft">
            <Store className="mx-auto h-12 w-12 text-ember mb-4" />
            <h2 className="font-display text-2xl font-bold text-foreground sm:text-3xl">
              Are You a Restaurant or Café Owner?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground leading-relaxed">
              Supercharge your restaurant with table QR ordering, automated digital punch cards, and our high-speed offline POS system.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/auth/merchant/signup"
                search={{ redirect: undefined }}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-xs font-semibold text-primary-foreground shadow-soft transition-transform active:scale-95"
              >
                Launch Your Store Free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/auth/merchant/login"
                search={{ redirect: undefined }}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Merchant Sign In
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* SEO Footer */}
      <footer className="border-t border-border/40 bg-background px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <ZentroLogo className="h-6 w-auto text-foreground" title="Zentro" />
            <span className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Zentro Globe. All rights reserved.
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
            <Link to="/stores" className="hover:text-foreground transition-colors">
              Discover Cafés
            </Link>
            <Link to="/offers" className="hover:text-foreground transition-colors">
              Special Offers
            </Link>
            <Link to="/auth/signup" search={{ redirect: undefined }} className="hover:text-foreground transition-colors">
              Customer Sign Up
            </Link>
            <Link to="/auth/merchant/signup" search={{ redirect: undefined }} className="hover:text-foreground transition-colors">
              Merchant Partner
            </Link>
            <Link to="/offline" className="hover:text-foreground transition-colors">
              Offline Status
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
