import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { customerApi, missionApi, merchantApi, punchCardApi, transactionApi, type MissionView, type CustomerPunchCard, type PointTransaction } from "@/lib/api";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { Flame, Sparkles, Gift } from "lucide-react";
import { TodaySpecialPopup } from "@/features/merchant-management/components/TodaySpecialPopup";
import { FullBackgroundPunchCard } from "@/components/FullBackgroundPunchCard";
import { PunchCardProofModal } from "@/components/PunchCardProofModal";

type WalletView = {
  points_balance: number;
  streak_days: number;
  order_count: number;
  tier_level: string;
  full_name: string;
};

const DEFAULT_WALLET: WalletView = {
  points_balance: 0,
  streak_days: 0,
  order_count: 0,
  tier_level: "bronze",
  full_name: "Customer",
};


export function CustomerLoyaltyPage() {
  const { selectedMerchantId, setSelectedMerchant } = useStore();
  const [merchantSlug, setMerchantSlug] = useState<string | null>(null);
  const [walletView, setWalletView] = useState<WalletView>(DEFAULT_WALLET);
  const [walletLoading, setWalletLoading] = useState(true);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);
  const [punchCards, setPunchCards] = useState<{ active: CustomerPunchCard[]; completed: CustomerPunchCard[] }>({ active: [], completed: [] });
  const [punchLoading, setPunchLoading] = useState(false);
  const [proofCard, setProofCard] = useState<CustomerPunchCard | null>(null);
  const [punchError, setPunchError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);

  // FIX: Auto-select first merchant if none is selected
  useEffect(() => {
    if (selectedMerchantId) return;
    merchantApi
      .list()
      .then((list) => {
        if (list[0]) setSelectedMerchant(list[0].id);
      })
      .catch(console.error);
  }, [selectedMerchantId, setSelectedMerchant]);

  // Resolve the merchant's slug whenever the selected merchant changes,
  // so we can pass it to TodaySpecialPopup (which is slug-keyed).
  useEffect(() => {
    if (!selectedMerchantId) {
      setMerchantSlug(null);
      return;
    }
    merchantApi
      .get(selectedMerchantId)
      .then((m) => setMerchantSlug(m.slug ?? null))
      .catch(() => setMerchantSlug(null));
  }, [selectedMerchantId]);

  // Load merchant-scoped wallet + missions when merchant changes
  useEffect(() => {
    if (!selectedMerchantId) {
      setWalletView(DEFAULT_WALLET);
      setWalletLoading(false);
      setMissions([]);
      setMissionsLoading(false);
      return;
    }

    setWalletLoading(true);
    setMissionsLoading(true);
    setTransactionsLoading(true);

    Promise.all([
      customerApi.profile().catch(() => null),
      customerApi.getWallet(selectedMerchantId).catch(() => {
        setSelectedMerchant(null);
        return null;
      }),
      missionApi.myMissions(selectedMerchantId).catch(() => []),
      transactionApi.customerList(selectedMerchantId).catch(() => []),
    ])
      .then(([profile, wallet, missionList, txList]) => {
        setWalletView({
          points_balance: wallet?.points_balance ?? 0,
          streak_days: wallet?.streak_days ?? 0,
          order_count: wallet?.order_count ?? 0,
          tier_level: wallet?.tier_level ?? "bronze",
          full_name: profile?.full_name ?? "Customer",
        });
        setMissions(missionList);
        setTransactions(txList);
      })
      .finally(() => {
        setWalletLoading(false);
        setMissionsLoading(false);
        setTransactionsLoading(false);
      });
  }, [selectedMerchantId]);

  // Load punch cards whenever selected merchant changes
  const loadPunchCard = useCallback(async () => {
    if (!selectedMerchantId) {
      setPunchCards({ active: [], completed: [] });
      return;
    }
    setPunchLoading(true);
    setPunchError(null);
    try {
      const data = await punchCardApi.customerList(selectedMerchantId);
      setPunchCards(data);
    } catch (e: any) {
      setPunchError("Couldn't load punch cards.");
      setPunchCards({ active: [], completed: [] });
    } finally {
      setPunchLoading(false);
    }
  }, [selectedMerchantId]);

  useEffect(() => {
    loadPunchCard();
  }, [loadPunchCard]);

  function handleUseFreeReward(id: string) {
    const card = [...punchCards.completed, ...punchCards.active].find(c => c.id === id);
    if (card) setProofCard(card);
  }

  // Derived display values
  const displayPoints = walletView.points_balance;
  const displayStreak = walletView.streak_days;
  const displayName = walletView.full_name;
  const displayTier = walletView.tier_level.charAt(0).toUpperCase() + walletView.tier_level.slice(1);


  return (
    <MobileShell>
      <TopBar />

      {/* Loyalty card */}
      <section className="px-5">
        <div className="relative overflow-hidden rounded-[32px] bg-slate-900 dark:bg-slate-800 p-7 text-white shadow-ember">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full gradient-ember opacity-50 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />

          <div className="relative flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-white/60">Loyalty Card</p>
              <p className="mt-1 font-display text-3xl">Zentro Rewards</p>
            </div>
            <div className="glass-strong rounded-full px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-foreground">
              {displayTier}
            </div>
          </div>

          <div className="relative mt-10">
            <p className="text-xs text-white/60">Points balance</p>
            {walletLoading ? (
              <div className="mt-1 h-16 w-32 animate-pulse rounded-2xl bg-white/10" />
            ) : (
              <p className="font-display mt-1 text-[72px] leading-none tracking-tight">
                {displayPoints.toLocaleString()}
              </p>
            )}
            <p className="mt-1 text-xs text-white/60">
              ≈ {Math.floor(displayPoints / 80)} free drinks available
            </p>
          </div>

          {/* FIX: grid now has both columns and is properly closed */}
          <div className="relative mt-8 grid grid-cols-2 gap-3">
            {/* Streak */}
            <div className="rounded-2xl bg-white/8 p-3 backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/60">
                <Flame className="h-3 w-3 text-ember" /> Streak
              </div>
              {walletLoading ? (
                <div className="mt-1 h-8 w-20 animate-pulse rounded-xl bg-white/10" />
              ) : (
                <>
                  <p className="font-display mt-1 text-3xl">
                    {displayStreak} {displayStreak === 1 ? "day" : "days"}
                  </p>
                  <p className="mt-1 text-[10px] text-white/40">At this store</p>
                </>
              )}
            </div>

            {/* Orders at this merchant */}
            <div className="rounded-2xl bg-white/8 p-3 backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/60">
                <Sparkles className="h-3 w-3 text-white/60" /> Orders
              </div>
              {walletLoading ? (
                <div className="mt-1 h-8 w-20 animate-pulse rounded-xl bg-white/10" />
              ) : (
                <>
                  <p className="font-display mt-1 text-3xl">{walletView.order_count}</p>
                  <p className="mt-1 text-[10px] text-white/40">at this store</p>
                </>
              )}
            </div>
          </div>{/* end grid */}

          <div className="relative mt-6 flex items-end justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/50">Member</p>
              <p className="mt-0.5 text-sm font-medium">{displayName}</p>
            </div>
            <p className="font-mono text-[10px] tracking-widest text-white/40">
              •••• {String(walletView.order_count).padStart(4, "0")}
            </p>
          </div>
        </div>
      </section>

      {/* Punch cards */}
      <section className="mt-6 px-5 space-y-4">
        {punchError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {punchError}
          </div>
        )}

        {punchLoading && punchCards.active.length === 0 && punchCards.completed.length === 0 ? (
          <div className="glass-strong rounded-3xl p-5 text-center">
            <p className="text-xs text-muted-foreground animate-pulse">Loading punch cards...</p>
          </div>
        ) : [...punchCards.completed, ...punchCards.active].length === 0 ? (
          <div className="glass-strong rounded-3xl p-5 text-center">
            <p className="text-xs text-muted-foreground">No active punch cards for this merchant.</p>
          </div>
        ) : (
          [...punchCards.completed, ...punchCards.active].map((card) => (
            <FullBackgroundPunchCard
              key={card.id}
              card={card}
              onRedeem={handleUseFreeReward}
            />
          ))
        )}
      </section>

      {/* Missions */}
      <section className="mt-6 px-5">
        <h2 className="font-display mb-3 text-2xl text-foreground">Missions</h2>
        {missionsLoading ? (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-sm text-muted-foreground">Loading missions…</p>
          </div>
        ) : missions.length > 0 ? (
          <div className="space-y-3">
            {missions.map((m) => {
              const pct = Math.min((m.current_count / m.target_count) * 100, 100);
              const done = m.is_completed || m.current_count >= m.target_count;
              return (
                <div key={m.id} className="glass-strong rounded-3xl p-5">
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-ember-soft text-2xl">
                      {m.icon || "🎯"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate font-medium text-foreground">{m.title}</p>
                        <span className="font-display shrink-0 text-sm text-ember">
                          {m.current_count}/{m.target_count}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{m.description}</p>
                      {m.linked_menu_item_name && (
                        <p className="mt-1 text-xs font-medium text-ember">Buy {m.linked_menu_item_name} {m.target_count}x</p>
                      )}
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-mist">
                        <div
                          className={`h-full rounded-full transition-all ${done ? "bg-ink" : "gradient-ember"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          Reward · <span className="text-foreground">+{m.reward_points} pts</span>
                        </p>
                        {done && (
                          <span className="rounded-full bg-slate-900 dark:bg-white px-2.5 py-1 text-[10px] uppercase tracking-widest text-white dark:text-slate-900">
                            Completed ✓
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-4xl">🎯</p>
            <p className="mt-3 text-sm font-medium text-foreground">No missions yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your merchant hasn't created any missions yet.
            </p>
          </div>
        )}
      </section>

      {/* Tier progress */}
      <section className="mt-4 px-5 pb-8">
        <div className="glass rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Progress to Platinum</p>
            <p className="text-xs text-muted-foreground">{displayPoints}/5000 pts</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist">
            <div
              className="h-full rounded-full gradient-ember transition-all"
              style={{ width: `${Math.min((displayPoints / 5000) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {5000 - displayPoints > 0
              ? `${5000 - displayPoints} pts to unlock Platinum perks at this store.`
              : "You reached Platinum at this store! 🎉"}
          </p>
        </div>
      </section>

      {/* Point Transactions */}
      <section className="mt-4 px-5 pb-8">
        <h3 className="font-display mb-3 px-2 text-xl text-foreground">Recent Transactions</h3>
        {transactionsLoading ? (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-xs text-muted-foreground animate-pulse">Loading...</p>
          </div>
        ) : transactions.length === 0 ? (
          <div className="glass rounded-3xl p-6 text-center">
            <p className="text-xs text-muted-foreground">No recent transactions at this store.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="glass rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground capitalize">{tx.transaction_type.toLowerCase().replace("_", " ")}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(tx.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${tx.points >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                    {tx.points > 0 ? "+" : ""}{tx.points} pts
                  </p>
                  <p className="text-[10px] text-muted-foreground">Balance: {tx.balance_after}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Today's Special popup — shown once per merchant per session */}
      {merchantSlug && (
        <TodaySpecialPopup
          slug={merchantSlug}
          onOrderItem={() => {
            // No dedicated order page rendered on this view yet —
            // scroll to top for now. Swap for navigation to /m/$slug
            // or /customer/order if you want a real "go order" action.
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
      {proofCard && (
        <PunchCardProofModal
          card={proofCard}
          onClose={() => setProofCard(null)}
          onRedeemed={() => {
            setProofCard(null);
            loadPunchCard();
          }}
        />
      )}
    </MobileShell>
  );
}