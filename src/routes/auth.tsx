// routes/auth.tsx - Customer auth selector page
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign In · Zentro" }] }),
  component: Auth,
});

function Auth() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname !== "/auth") {
    return <Outlet />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[580px] flex-col px-5 pb-10 pt-10">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Welcome to Zentro</p>
        <h1 className="font-display mt-4 text-5xl leading-[1.05] text-ink">Choose your account type</h1>
        <p className="mt-3 max-w-[380px] mx-auto text-sm text-muted-foreground">
          Sign in or sign up as a customer, or switch to merchant auth for business access.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Link to="/auth/login" search={{ redirect: undefined }}
          className="rounded-[2rem] border border-border bg-background px-6 py-8 text-left shadow-sm transition hover:border-ink/20 hover:shadow-md"
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Customer</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Access rewards, points, and your customer loyalty profile.</p>
        </Link>

        <Link
          to="/auth/signup"
          search={{ redirect: undefined }}
          className="rounded-[2rem] border border-border bg-background px-6 py-8 text-left shadow-sm transition hover:border-ink/20 hover:shadow-md"
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Customer</p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">Sign up</h2>
          <p className="mt-2 text-sm text-muted-foreground">Create your customer account and start earning loyalty rewards.</p>
        </Link>
      </div>

      <div className="mt-10 rounded-[2rem] border border-border bg-background px-6 py-8 shadow-sm">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Merchant</p>
        <h2 className="mt-3 text-3xl font-semibold text-ink">Business access</h2>
        <p className="mt-2 text-sm text-muted-foreground">Manage your store, orders, and merchant loyalty settings.</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            to="/auth/merchant/login"
            search={{ redirect: undefined }}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Merchant sign in
          </Link>
          <Link
            to="/auth/merchant/signup"
            search={{ redirect: undefined }}
            className="rounded-2xl border border-border px-5 py-3 text-sm font-medium text-ink transition hover:bg-mist"
          >
            Merchant sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
