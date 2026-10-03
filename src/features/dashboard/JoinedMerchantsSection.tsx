// src/features/dashboard/JoinedMerchantsSection.tsx
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, ChevronRight, Gift, ShoppingBag } from "lucide-react";
import { customerApi, type JoinedMerchant } from "@/lib/api";

function MerchantCard({ merchant }: { merchant: JoinedMerchant }) {
  return (
    <div className="glass flex items-center gap-4 rounded-3xl p-4">
      <div
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-mist text-2xl"
        style={
          merchant.logo_url
            ? {
                backgroundImage: `url(${merchant.logo_url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {!merchant.logo_url && "☕"}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{merchant.business_name}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              merchant.is_open ? "bg-emerald-100 text-emerald-700" : "bg-mist text-muted-foreground"
            }`}
          >
            {merchant.is_open ? "Open" : "Closed"}
          </span>
        </div>

        <p className="mt-1 text-lg font-display text-ink">
          {merchant.points_balance.toLocaleString()}
          <span className="ml-1 text-[11px] font-sans uppercase tracking-wide text-muted-foreground">
            pts · {merchant.tier_level}
          </span>
        </p>

        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Gift className="h-3 w-3" /> {merchant.active_rewards_count} reward
            {merchant.active_rewards_count === 1 ? "" : "s"}
          </span>
          {merchant.pending_orders_count > 0 && (
            <span className="inline-flex items-center gap-1 text-ember">
              <ShoppingBag className="h-3 w-3" /> {merchant.pending_orders_count} pending
            </span>
          )}
        </div>
      </div>

      <Link
        to="/customer/merchant/$slug"
        params={{ slug: merchant.merchant_slug }}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-ink px-4 text-xs font-medium text-primary-foreground"
      >
        Open <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function JoinedMerchantsSection() {
  const [merchants, setMerchants] = useState<JoinedMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    customerApi
      .joinedMerchants()
      .then((data) => {
        if (!cancelled) setMerchants(data);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Failed to load your cafés");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-ink">Your cafés</h2>
        <span className="text-xs text-muted-foreground">{merchants.length} joined</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : merchants.length === 0 ? (
        <div className="glass rounded-3xl py-12 text-center">
          <p className="text-3xl">☕</p>
          <p className="mt-2 text-sm text-muted-foreground">You haven't joined any cafés yet.</p>
          <Link
            to="/stores"
            className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-xs font-medium text-primary-foreground"
          >
            Discover cafés
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {merchants.map((m) => (
            <MerchantCard key={m.merchant_id} merchant={m} />
          ))}
        </div>
      )}
    </section>
  );
}
