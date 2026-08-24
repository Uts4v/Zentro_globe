import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Store, User, Hash, Shield } from "lucide-react";
import { publicQrApi, type MembershipQrResolve } from "@/lib/api";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

export const Route = createFileRoute("/loyalty/qr/$token")({
  head: () => ({ meta: [{ title: "Membership QR · Zentro" }] }),
  component: LoyaltyQrPage,
});

function LoyaltyQrPage() {
  const { token } = Route.useParams();
  const [data, setData] = useState<MembershipQrResolve | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    publicQrApi
      .resolve(token)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Invalid or expired QR code.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-4xl">🔍</p>
        <p className="text-sm text-muted-foreground">{error ?? "QR code not found."}</p>
        <Link
          to="/"
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col items-center px-5 pb-10 pt-10">
      <Link to="/" className="inline-flex items-center text-foreground" aria-label="Zentro home">
        <ZentroLogo className="h-7 w-auto" title="" />
      </Link>

      <div className="mt-16 w-full">
        <div className="glass-strong rounded-3xl p-6 text-center">
          {data.merchant.logo ? (
            <img
              src={data.merchant.logo}
              alt={data.merchant.name}
              className="mx-auto h-14 w-14 rounded-2xl object-cover"
            />
          ) : (
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ink text-xl text-white">
              ☕
            </div>
          )}

          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {data.merchant.name}
          </p>
          <h1 className="font-display mt-1 text-2xl text-foreground">{data.customer_name}</h1>

          <div className="mt-6 space-y-3">
            <div className="glass flex items-center gap-3 rounded-2xl p-4">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ember-soft">
                <Hash className="h-4 w-4 text-ember" />
              </div>
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Membership
                </p>
                <p className="text-sm font-medium text-foreground">{data.membership_number}</p>
              </div>
            </div>

            <div className="glass flex items-center gap-3 rounded-2xl p-4">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted">
                <Shield className="h-4 w-4 text-foreground" />
              </div>
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Status
                </p>
                <p className="text-sm font-medium capitalize text-foreground">{data.status}</p>
              </div>
            </div>
          </div>

          <Link
            to="/m/$slug"
            params={{ slug: data.merchant.slug }}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95"
          >
            <Store className="h-4 w-4" /> Visit store
          </Link>
        </div>
      </div>
    </div>
  );
}
