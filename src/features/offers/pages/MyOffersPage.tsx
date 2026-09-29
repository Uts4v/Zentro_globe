import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Ticket } from "lucide-react";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { offersApi, type OfferClaim } from "@/lib/api/offers";
import { ClaimSheet } from "../components/ClaimSheet";
import { formatExpiry } from "../components/OfferCard";

const TABS = [
  { key: "available", label: "Available" },
  { key: "used", label: "Used" },
  { key: "expired", label: "Expired" },
] as const;

export function MyOffersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("available");
  const [open, setOpen] = useState<OfferClaim | null>(null);
  const claims = useQuery({
    queryKey: ["offers", "mine", tab],
    queryFn: () => offersApi.mine(tab),
  });

  return (
    <MobileShell>
      <TopBar />
      <div className="px-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Wallet</p>
        <h1 className="font-display mt-1 text-4xl text-foreground">My Offers</h1>
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl bg-mist p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-xl py-2 text-xs font-bold transition-colors ${
                tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-3 px-5 pb-10">
        {claims.isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        )}
        {claims.isError && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn't load your offers.
          </p>
        )}
        {claims.data?.length === 0 && (
          <div className="glass rounded-3xl py-14 text-center">
            <p className="text-4xl">🎟️</p>
            <p className="mt-3 text-sm text-muted-foreground">
              {tab === "available"
                ? "No offers saved yet."
                : tab === "used"
                  ? "Nothing used yet."
                  : "Nothing expired."}
            </p>
            {tab === "available" && (
              <Link
                to="/offers"
                className="mt-4 inline-block rounded-full bg-ink px-5 py-2 text-xs font-bold text-primary-foreground"
              >
                Browse offers
              </Link>
            )}
          </div>
        )}
        {claims.data?.map((claim) => (
          <button
            key={claim.id}
            onClick={() => setOpen(claim)}
            className="flex w-full items-center gap-3 rounded-[26px] bg-card p-4 text-left"
            style={{ boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
          >
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ember-soft text-ember">
              <Ticket className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-muted-foreground">
                {claim.offer.merchant.name}
              </p>
              <p className="truncate text-[15px] font-extrabold text-foreground">
                {claim.offer.summary}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {claim.status === "reserved"
                  ? "Applied to an open order"
                  : tab === "used"
                    ? "Used"
                    : formatExpiry(claim.expires_at)}
                {" · "}
                <span className="font-mono">{claim.code}</span>
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
      {open && <ClaimSheet claim={open} onClose={() => setOpen(null)} />}
    </MobileShell>
  );
}
