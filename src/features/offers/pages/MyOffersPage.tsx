import { useRef, useState, type KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import { CircleCheck, Clock3, Compass, Ticket, TicketCheck, WifiOff } from "lucide-react";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { cn } from "@/lib/utils";
import type { OfferClaim } from "@/lib/api/offers";
import { VoucherModal } from "../components/VoucherModal";
import { WalletCard } from "../components/WalletCard";
import { OfferEmptyState, WalletCardSkeleton } from "../components/OfferStates";
import { isEndingSoon } from "../lib/format";
import { useMyOffers, type WalletTab } from "../lib/hooks";
import { btnPrimary, microLabel } from "../lib/ui";

const TABS: Array<{ key: WalletTab; label: string }> = [
  { key: "available", label: "Available" },
  { key: "used", label: "Used" },
  { key: "expired", label: "Expired" },
];

const EMPTY: Record<WalletTab, { icon: typeof Ticket; title: string; body: string }> = {
  available: {
    icon: Ticket,
    title: "No saved offers yet.",
    body: "Discover nearby deals and save your favorites.",
  },
  used: {
    icon: CircleCheck,
    title: "No offers used yet.",
    body: "Vouchers you redeem show up here.",
  },
  expired: { icon: Clock3, title: "No expired offers.", body: "Nice, nothing has slipped away." },
};

export function MyOffersPage() {
  const [tab, setTab] = useState<WalletTab>("available");
  const [open, setOpen] = useState<OfferClaim | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queries: Record<WalletTab, ReturnType<typeof useMyOffers>> = {
    available: useMyOffers("available"),
    used: useMyOffers("used"),
    expired: useMyOffers("expired"),
  };
  const current = queries[tab];
  const available = queries.available.data ?? [];
  const expiringSoon = available.filter(
    (c) => c.status === "available" && isEndingSoon(c.expires_at, 7),
  ).length;

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const jump = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (!delta && jump === null) return;
    e.preventDefault();
    const next = jump ?? (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next].key);
    tabRefs.current[next]?.focus();
  }

  return (
    <MobileShell wide>
      <TopBar />
      <div className="px-5 sm:px-6 lg:max-w-5xl lg:px-8">
        <header className="mt-5 lg:mt-8">
          <p className={cn(microLabel, "text-muted-foreground")}>Wallet</p>
          <h1 className="mt-1 text-[40px] font-extrabold leading-none tracking-[-0.035em] text-foreground lg:text-[54px]">
            My Offers
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground lg:text-base">
            Your saved offers and vouchers.
          </p>
        </header>

        {/* Compact summary */}
        <div className="mt-5 flex items-center gap-4 rounded-[22px] bg-primary px-5 py-4 text-primary-foreground sm:max-w-md">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-foreground/12">
            <TicketCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-extrabold leading-tight">
              {queries.available.isLoading ? "…" : available.length}{" "}
              <span className="text-sm font-semibold opacity-90">ready to use</span>
            </p>
            {expiringSoon > 0 && (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs opacity-90">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />
                {expiringSoon} expiring soon
              </p>
            )}
          </div>
        </div>

        {/* Segmented tabs */}
        <div
          role="tablist"
          aria-label="Voucher status"
          className="mt-5 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-card p-1 sm:max-w-md"
        >
          {TABS.map((t, i) => {
            const selected = tab === t.key;
            const count = queries[t.key].data?.length;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`wallet-tab-${t.key}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="wallet-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={cn(
                  "flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {count !== undefined && (
                  <span className={cn("tabular-nums", selected ? "opacity-90" : "opacity-70")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section
        id="wallet-panel"
        role="tabpanel"
        aria-labelledby={`wallet-tab-${tab}`}
        className="mt-5 px-5 pb-10 sm:px-6 lg:max-w-5xl lg:px-8"
      >
        {current.isLoading && (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <WalletCardSkeleton key={i} />
            ))}
          </div>
        )}

        {current.isError && (
          <OfferEmptyState
            icon={WifiOff}
            title="We couldn't load your offers."
            body="Check your connection and try again."
            action={
              <button type="button" onClick={() => current.refetch()} className={btnPrimary}>
                Try again
              </button>
            }
          />
        )}

        {current.data?.length === 0 && (
          <OfferEmptyState
            icon={EMPTY[tab].icon}
            title={EMPTY[tab].title}
            body={EMPTY[tab].body}
            action={
              tab === "available" ? (
                <Link to="/offers" className={btnPrimary}>
                  <Compass className="h-4 w-4" aria-hidden="true" /> Explore offers
                </Link>
              ) : undefined
            }
          />
        )}

        {current.data && current.data.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            {current.data.map((claim) => (
              <WalletCard key={claim.id} claim={claim} onOpen={() => setOpen(claim)} />
            ))}
          </div>
        )}
      </section>

      {open && <VoucherModal claim={open} onClose={() => setOpen(null)} />}
    </MobileShell>
  );
}
