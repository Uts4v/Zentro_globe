// routes/m.$slug.tsx — Layout route for /m/$slug/*
//
// This is a parent layout route. Child routes (like table/$token) render via <Outlet />.
// For the bare /m/$slug path (no table), we show the merchant landing page.

import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ArrowRight, MapPin } from "lucide-react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";
import { merchantApi, type MerchantProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/m/$slug")({
  head: () => ({ meta: [{ title: "Store · Zentro" }] }),
  component: MerchantEntryLayout,
});

function MerchantEntryLayout() {
  const { slug } = Route.useParams();
  const routerState = useRouterState();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if a child route is matched (e.g. /m/$slug/table/$token)
  const hasChildRoute = routerState.location.pathname.includes(`/m/${slug}/`);

  // Fetch merchant by slug
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

  // Redirect based on role (only for bare /m/$slug, not child routes)
  useEffect(() => {
    if (hasChildRoute || authLoading || loading || !merchant) return;

    if (user?.role === "merchant") {
      navigate({ to: "/merchant/store" as any, replace: true });
      return;
    }

    if (user?.role === "customer") {
      navigate({ to: "/customer/merchant/$slug", params: { slug }, replace: true });
      return;
    }
  }, [hasChildRoute, authLoading, loading, merchant, user, slug, navigate]);

  // If a child route is active, just render the child
  if (hasChildRoute) {
    return <Outlet />;
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading || authLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
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

  // ── Redirect spinner — shown while navigate() fires ───────────────────────
  if (user?.role === "customer" || user?.role === "merchant") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {user.role === "merchant"
            ? "Opening your dashboard…"
            : `Opening ${merchant.business_name}…`}
        </p>
      </div>
    );
  }

  // ── Guest landing — not logged in (bare /m/$slug without table) ───────────
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5 pb-10 pt-10">
      <Link to="/" className="inline-flex items-center text-foreground" aria-label="Zentro home">
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>

      <div className="mt-12">
        <div
          className="grid h-16 w-16 place-items-center rounded-3xl text-3xl text-primary-foreground shadow-soft"
          style={{
            backgroundColor: merchant.store_theme_color || undefined,
            ...(merchant.logo_url
              ? {
                  backgroundImage: `url(${merchant.logo_url})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : !merchant.store_theme_color
                ? { backgroundColor: "var(--ink)" }
                : {}),
          }}
        >
          {!merchant.logo_url && "☕"}
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {merchant.is_open ? "Now open" : "Currently closed"}
        </p>
        <h1 className="font-display mt-2 text-5xl leading-[1.05] text-foreground">
          {merchant.business_name}
        </h1>
        {merchant.address && (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4 shrink-0" /> {merchant.address}
          </p>
        )}
        {merchant.description && (
          <p className="mt-2 text-sm text-muted-foreground">{merchant.description}</p>
        )}
      </div>

      <div className="mt-10 glass-strong rounded-3xl p-6">
        <p className="font-display text-2xl text-foreground">Join to start earning</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign up or sign in to order, collect points, and track your punch card at{" "}
          {merchant.business_name}.
        </p>
        <Link
          to="/auth"
          search={{ redirect: `/customer/merchant/${slug}` }}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-primary-foreground"
          style={{ backgroundColor: merchant.store_theme_color || "var(--ink)" }}
        >
          Sign up / Sign in <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
