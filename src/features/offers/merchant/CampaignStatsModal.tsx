import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { merchantOffersApi, type Campaign } from "@/lib/api/offers";
import { formatCurrency } from "@/lib/currency";

function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export function CampaignStatsModal({
  campaign,
  currencySymbol,
  onClose,
}: {
  campaign: Campaign;
  currencySymbol: string;
  onClose: () => void;
}) {
  const stats = useQuery({
    queryKey: ["offers", "stats", campaign.id],
    queryFn: () => merchantOffersApi.stats(campaign.id),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = stats.data;
  const maxViews = Math.max(
    1,
    ...(s?.series ?? []).map((r) => Math.max(r.views, r.claims, r.redemptions)),
  );

  const body = (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        className="glass-strong max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl p-6 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="stats-title" className="font-display text-2xl text-foreground">
              {campaign.title}
            </h2>
            <p className="text-xs text-muted-foreground">{campaign.summary}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-mist text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {stats.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        )}
        {stats.isError && (
          <p className="py-8 text-center text-sm text-muted-foreground">Couldn't load stats.</p>
        )}
        {s && (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Views", s.views],
                ["Claims", s.claims],
                ["Used", s.redemptions],
                ["Claim rate", pct(s.claim_rate)],
                ["Use rate", pct(s.redemption_rate)],
                ["In open orders", s.reserved_now],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-2xl bg-card p-3"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="font-display text-xl text-foreground">{value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div
                className="rounded-2xl bg-card p-3"
                style={{ border: "1px solid var(--border)" }}
              >
                <p className="text-[11px] text-muted-foreground">Sales with this offer</p>
                <p className="font-display text-xl text-foreground">
                  {formatCurrency(s.sales_total, currencySymbol)}
                </p>
              </div>
              <div
                className="rounded-2xl bg-card p-3"
                style={{ border: "1px solid var(--border)" }}
              >
                <p className="text-[11px] text-muted-foreground">Discount given</p>
                <p className="font-display text-xl text-foreground">
                  {formatCurrency(s.discount_total, currencySymbol)}
                </p>
              </div>
              <div
                className="rounded-2xl bg-card p-3"
                style={{ border: "1px solid var(--border)" }}
              >
                <p className="text-[11px] text-muted-foreground">New vs returning customers</p>
                <p className="font-display text-xl text-foreground">
                  {s.new_customers} / {s.returning_customers}
                </p>
              </div>
              <div
                className="rounded-2xl bg-card p-3"
                style={{ border: "1px solid var(--border)" }}
              >
                <p className="text-[11px] text-muted-foreground">Came back within 7 / 30 days</p>
                <p className="font-display text-xl text-foreground">
                  {pct(s.returned_within_7d_rate)} / {pct(s.returned_within_30d_rate)}
                </p>
              </div>
            </div>
            {s.voided > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {s.voided} use(s) were voided by cancelled or refunded orders.
              </p>
            )}
            {s.series.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                  Last 30 days
                </p>
                <div
                  className="flex h-28 items-end gap-1"
                  aria-label="Daily views, claims and uses"
                >
                  {s.series.map((r) => (
                    <div
                      key={r.date}
                      className="flex flex-1 items-end gap-px"
                      title={`${r.date}: ${r.views} views, ${r.claims} claims, ${r.redemptions} uses`}
                    >
                      <div
                        className="flex-1 rounded-t bg-mist"
                        style={{ height: `${(r.views / maxViews) * 100}%` }}
                      />
                      <div
                        className="flex-1 rounded-t bg-ember/60"
                        style={{ height: `${(r.claims / maxViews) * 100}%` }}
                      />
                      <div
                        className="flex-1 rounded-t bg-ember"
                        style={{ height: `${(r.redemptions / maxViews) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Grey: views · light: claims · dark: uses
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
