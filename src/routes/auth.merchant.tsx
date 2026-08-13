// routes/auth.merchant.tsx - Merchant auth selector page
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/merchant")({
  head: () => ({ meta: [{ title: "Merchant Auth · Zentro" }] }),
  component: MerchantAuth,
});

function MerchantAuth() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname !== "/auth/merchant") {
    return <Outlet />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[580px] flex-col px-5 pb-10 pt-10">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Business access</p>
        <h1 className="font-display mt-4 text-5xl leading-[1.05] text-ink">Merchant account</h1>
        <p className="mt-3 max-w-[380px] mx-auto text-sm text-muted-foreground">
          Sign in or sign up with merchant credentials to manage your store and loyalty operations.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Link
          to="/auth/merchant/login"
          search={{ redirect: undefined }}
          className="rounded-[2rem] border border-border bg-background px-6 py-8 text-left shadow-sm transition hover:border-ink/20 hover:shadow-md"
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Merchant</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Access your merchant dashboard, orders, and analytics.</p>
        </Link>

        <Link
          to="/auth/merchant/signup"
          search={{ redirect: undefined }}
          className="rounded-[2rem] border border-border bg-background px-6 py-8 text-left shadow-sm transition hover:border-ink/20 hover:shadow-md"
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Merchant</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Sign up</h2>
          <p className="mt-2 text-sm text-muted-foreground">Create your merchant account and start selling on Zentro.</p>
        </Link>
      </div>

      <div className="mt-10 text-center text-xs text-muted-foreground">
        <Link to="/auth/login" search={{ redirect: undefined }} className="font-medium text-ink underline-offset-4 hover:underline">Customer sign in</Link>
      </div>
    </div>
  );
}
