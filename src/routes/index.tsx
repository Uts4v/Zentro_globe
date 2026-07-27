// routes/index.tsx — Premium Zentro Home Screen
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import {
  merchantApi,
  customerApi,
  specialApi,
  punchCardApi,
  missionApi,
  membershipCardApi,
  rewardApi,
  type TodaySpecial,
  type CustomerPunchCard,
  type MissionView,
  type MembershipCardDesign,
  type Reward,
} from "@/lib/api";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { X as XIcon, QrCode, SendHorizontal, Loader2, Target, Check, Gift, Flame } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { lazy, Suspense, useState, useEffect, useMemo } from "react";
import { TodaySpecialPopup } from "@/features/merchant-management/components/TodaySpecialPopup";
import { TransferForm } from "@/features/transfers/components/TransferForm";
import { PremiumPunchCard } from "@/components/PremiumPunchCard";
import { PunchCardProofModal } from "@/components/PunchCardProofModal";
import { resolveMerchantPreset, type MerchantThemePreset } from "@/lib/merchant-theme-presets";

import { toast } from "sonner";

// Home components
import { MainPageLoyaltyCard, MainPageLoyaltyCardSkeleton } from "@/components/MainPageLoyaltyCard";
import { QuickActions } from "@/components/home/QuickActions";

const PersonalQR = lazy(() =>
  import("@/features/transfers/components/PersonalQR").then((m) => ({ default: m.PersonalQR }))
);
const TableQRScanner = lazy(() =>
  import("@/features/pos/screens/TableQRScanner").then((m) => ({ default: m.TableQRScanner }))
);

export const Route = createFileRoute("/")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Zentro — Home" },
      { name: "description", content: "Your loyalty dashboard. Earn, redeem, and discover." },
    ],
  }),
  component: Index,
});

function Index() {
  const { add, selectedMerchantId, setSelectedMerchant } = useStore();

  // Data states
  const [merchantName, setMerchantName] = useState("");
  const [merchantSlug, setMerchantSlug] = useState<string | null>(null);
  const [merchantLogo, setMerchantLogo] = useState<string | null>(null);
  const [merchantCategory, setMerchantCategory] = useState<string | null>(null);
  const [merchantThemeColor, setMerchantThemeColor] = useState("");
  const [merchantBusinessType, setMerchantBusinessType] = useState<string | null>(null);
  const [cardTextColor, setCardTextColor] = useState("");
  const [cardBackgroundImage, setCardBackgroundImage] = useState("");
  const [cardDesign, setCardDesign] = useState<MembershipCardDesign | null>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [ordersCount, setOrdersCount] = useState(0);
  const [tier, setTier] = useState("bronze");
  const [memberName, setMemberName] = useState("Member");
  const [cardNumber, setCardNumber] = useState("•••• 0000");
  const [freeRewards, setFreeRewards] = useState(0);
  const [loading, setLoading] = useState(true);
  const [todaySpecial, setTodaySpecial] = useState<TodaySpecial | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferMode, setTransferMode] = useState<"send" | "receive">("send");
  const [punchCards, setPunchCards] = useState<{
    active: CustomerPunchCard[];
    completed: CustomerPunchCard[];
  }>({ active: [], completed: [] });
  const [punchRedeeming, setPunchRedeeming] = useState<string | null>(null);
  const [proofCard, setProofCard] = useState<CustomerPunchCard | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [missions, setMissions] = useState<MissionView[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redeemingRewardId, setRedeemingRewardId] = useState<string | null>(null);
  const [showTableScanner, setShowTableScanner] = useState(false);

  // Resolve merchant theme preset
  const themePreset: MerchantThemePreset | null = useMemo(
    () => resolveMerchantPreset(merchantBusinessType),
    [merchantBusinessType]
  );

  // Load merchant data
  useEffect(() => {
    if (!selectedMerchantId) {
      setLoading(false);
      setJoined(false);
      setMissions([]);
      return;
    }
    setLoading(true);
    setJoined(false);
    setMissions([]);

    let resolvedSlug: string | null = null;

    Promise.all([
      merchantApi
        .get(selectedMerchantId)
        .then((m) => {
          resolvedSlug = m.slug ?? null;
          setMerchantName(m.business_name);
          setMerchantSlug(resolvedSlug);
          setMerchantLogo(m.logo_url ?? null);
          setMerchantThemeColor(m.store_theme_color || "");
          setMerchantCategory(m.business_type ?? null);
          setMerchantBusinessType(m.business_type ?? null);
          setCardTextColor(m.card_text_color || "");
          setCardBackgroundImage(m.card_background_image || "");
        })
        .catch(() => setSelectedMerchant(null)),
      customerApi
        .getWallet(selectedMerchantId)
        .then((w) => {
          setPoints(w?.points_balance ?? 0);
          setStreak(w?.streak_days ?? 0);
          setOrdersCount(w?.order_count ?? 0);
          setTier(w?.tier_level ?? "bronze");
          setJoined(true);
        })
        .catch(() => setJoined(false)),
      punchCardApi
        .customerList(selectedMerchantId)
        .then((data) => {
          setPunchCards(data);
          setFreeRewards(data.completed.length);
        })
        .catch(() => setPunchCards({ active: [], completed: [] })),
      missionApi
        .myMissions(selectedMerchantId)
        .then((m) => setMissions(m))
        .catch(() => setMissions([])),
      rewardApi
        .list(selectedMerchantId)
        .then((r) => setRewards(r.filter((item) => item.is_active)))
        .catch(() => setRewards([])),
      membershipCardApi
        .list()
        .then((cards) => {
          const card = cards.find((c) => c.merchant.slug === resolvedSlug);
          if (card) {
            setCardDesign(card.card_design ?? null);
            setJoinedAt(card.membership.joined_at ?? null);
            setCardNumber(card.membership.membership_number_masked);
            setTier(card.wallet?.tier ?? "bronze");
          }
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [selectedMerchantId]);

  // Load customer profile
  useEffect(() => {
    if (!selectedMerchantId || !joined) return;
    customerApi
      .profile()
      .then((p) => {
        if (p?.full_name) setMemberName(p.full_name);
      })
      .catch(() => {});
  }, [selectedMerchantId, joined]);

  // Load today's special
  useEffect(() => {
    if (!merchantSlug) {
      setTodaySpecial(null);
      return;
    }
    specialApi
      .forSlug(merchantSlug)
      .then((s) => setTodaySpecial(s?.is_active ? s : null))
      .catch(() => setTodaySpecial(null));
  }, [merchantSlug]);

  // Progress to next tier
  const progressPercent = useMemo(() => {
    const tierThresholds: Record<string, number> = {
      bronze: 500,
      silver: 1500,
      gold: 3000,
      platinum: 5000,
    };
    const current = points;
    const nextTier = tier === "bronze" ? "silver" : tier === "silver" ? "gold" : tier === "gold" ? "platinum" : "platinum";
    const target = tierThresholds[nextTier] ?? 5000;
    return (current / target) * 100;
  }, [points, tier]);

  // Handlers
  function handleRedeemPunch(cardId: string) {
    const card =
      punchCards.active.find((c) => c.id === cardId) ||
      punchCards.completed.find((c) => c.id === cardId);
    if (card) setProofCard(card);
  }

  async function handleRedeemReward(reward: Reward) {
    if (points < reward.points_cost) {
      toast.error(`You need ${reward.points_cost - points} more points to redeem ${reward.name}`);
      return;
    }
    setRedeemingRewardId(reward.id);
    try {
      const res = await rewardApi.redeem(reward.id);
      toast.success(`Redeemed ${reward.name}! Code: ${res.code}`);
      if (selectedMerchantId) {
        customerApi.getWallet(selectedMerchantId).then((w) => {
          if (w) setPoints(w.points_balance);
        }).catch(() => {});
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to redeem reward");
    } finally {
      setRedeemingRewardId(null);
    }
  }

  async function handleJoin() {
    if (!merchantSlug || joining) return;
    setJoining(true);
    try {
      const { wallet: w } = await customerApi.joinMerchant(merchantSlug);
      setJoined(true);
      setPoints(w?.points_balance ?? 0);
      setStreak(w?.streak_days ?? 0);
    } catch {}
    setJoining(false);
  }

  const allPunchCards = [...punchCards.completed, ...punchCards.active];

  // Apply merchant theme
  useEffect(() => {
    const root = document.documentElement;
    const color = themePreset?.primary || merchantThemeColor;
    if (color && color.startsWith("#")) {
      root.style.setProperty("--merchant-color", color);
      const alpha = (a: number) => {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      };
      root.style.setProperty("--merchant-light", alpha(0.1));
      root.style.setProperty("--merchant-mid", alpha(0.2));
    } else {
      root.style.removeProperty("--merchant-color");
      root.style.removeProperty("--merchant-light");
      root.style.removeProperty("--merchant-mid");
    }
    return () => {
      root.style.removeProperty("--merchant-color");
      root.style.removeProperty("--merchant-light");
      root.style.removeProperty("--merchant-mid");
    };
  }, [themePreset, merchantThemeColor]);

  const merchantColor = themePreset?.primary || merchantThemeColor || undefined;

  return (
    <MobileShell>
      <TopBar />

      {/* Today's Special popup */}
      {merchantSlug && <TodaySpecialPopup slug={merchantSlug} />}

      <div className="relative flex min-w-0 flex-col gap-5 overflow-x-hidden pb-6">

        {/* Hero Loyalty Card */}
        <section className="mx-auto w-[100%] max-w-[550px] px-2">
        {loading ? (
          <MainPageLoyaltyCardSkeleton />
        ) : (
          <MainPageLoyaltyCard
            merchantName={merchantName || "Select a store"}
            merchantLogo={merchantLogo}
            merchantCategory={merchantCategory}
            tier={tier}
            points={points}
            streak={streak}
            ordersCount={ordersCount}
            rewardsCount={freeRewards}
            progressPercent={progressPercent}
            pointsToNextTier={(() => {
              const tierThresholds: Record<string, number> = { bronze: 500, silver: 1500, gold: 3000, platinum: 5000 };
              const next = tier === "bronze" ? "silver" : tier === "silver" ? "gold" : tier === "gold" ? "platinum" : "";
              return next ? Math.max(0, (tierThresholds[next] ?? 5000) - points) : 0;
            })()}
            memberName={memberName}
            cardNumber={cardNumber}
            theme={themePreset}
            themeColor={merchantThemeColor}
            cardDesign={cardDesign}
            joined={joined}
            joinedAt={joinedAt}
            onJoin={handleJoin}
            joining={joining}
          />
        )}
        </section>

        {/* Quick Actions */}
        {joined && (
          <QuickActions
            onScanQR={() => setShowTableScanner(true)}
            onTransfer={() => setShowTransfer(true)}
            availablePoints={points}
            merchantColor={merchantColor}
          />
        )}

        {/* Transfer expanded panel */}
        {showTransfer && selectedMerchantId && (
          <section className="min-w-0 px-5">
            <div className="overflow-hidden rounded-[24px] bg-card p-5" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex min-w-0 items-center justify-between">
                <h3 className="font-display min-w-0 truncate text-xl text-foreground">Transfer Points</h3>
                <button
                  onClick={() => setShowTransfer(false)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mist text-muted-foreground transition-colors hover:bg-accent"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex gap-1.5 rounded-2xl bg-mist p-1">
                <button
                  onClick={() => setTransferMode("send")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-[14px] py-2.5 text-xs font-medium transition-all ${
                    transferMode === "send"
                      ? "bg-card text-foreground"
                      : "text-muted-foreground"
                  }`}
                  style={transferMode === "send" ? { boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : {}}
                >
                  <SendHorizontal className="h-4 w-4" /> Send
                </button>
                <button
                  onClick={() => setTransferMode("receive")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-[14px] py-2.5 text-xs font-medium transition-all ${
                    transferMode === "receive"
                      ? "bg-card text-foreground"
                      : "text-muted-foreground"
                  }`}
                  style={transferMode === "receive" ? { boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : {}}
                >
                  <QrCode className="h-4 w-4" /> Receive
                </button>
              </div>
              <div className="mt-4 overflow-hidden">
                {transferMode === "send" ? (
                  <TransferForm
                    compact
                    preselectedMerchantId={selectedMerchantId}
                    onSuccess={() => {
                      customerApi.getWallet(selectedMerchantId).then((w) => {
                        if (w) setPoints(w.points_balance);
                      }).catch(() => {});
                    }}
                  />
                ) : (
                  <Suspense
                    fallback={
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <PersonalQR />
                  </Suspense>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Today's Special Banner (Ultra-Premium Modern Aesthetic) */}
        {selectedMerchantId && todaySpecial && (
          <section className="px-5">
            <div
              className="group relative overflow-hidden bg-card p-5 transition-all"
              style={{
                borderRadius: 30,
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex items-center gap-4">
                {todaySpecial.image_url ? (
                  <img
                    src={todaySpecial.image_url}
                    alt={todaySpecial.title}
                    className="h-20 w-20 shrink-0 rounded-2xl object-cover shadow-sm transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-ember-soft text-3xl">
                    <Flame className="h-8 w-8 text-ember" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-ember-soft px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-ember">
                      Today's Special
                    </span>
                  </div>
                  <h3 className="mt-2 truncate text-[17px] font-black leading-snug text-foreground">
                    {todaySpecial.title}
                  </h3>
                  {todaySpecial.description && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] font-medium text-muted-foreground">
                      {todaySpecial.description}
                    </p>
                  )}
                  {(todaySpecial.linked_menu_item_name || todaySpecial.linked_reward_name) && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
                      {todaySpecial.linked_menu_item_name ?? todaySpecial.linked_reward_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Punch Cards (Original Interactive Stamp Punch Cards) */}
        {selectedMerchantId && allPunchCards.length > 0 && (
          <section className="px-5">
            <p className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
              Punch Cards
            </p>
            <div className="space-y-3">
              {allPunchCards.map((card) => (
                <PremiumPunchCard
                  key={card.id}
                  card={card}
                  onRedeem={handleRedeemPunch}
                  redeeming={punchRedeeming === card.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Real Missions Section (Ultra-Premium Modern Style) */}
        {selectedMerchantId && joined && (
          <section className="px-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                Active Missions
              </p>
              <Link to="/missions" className="text-[11px] font-extrabold text-primary hover:underline">
                View all
              </Link>
            </div>
            {missions.length > 0 ? (
              <div className="space-y-3">
                {missions.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-[26px] bg-card p-4.5 transition-all"
                    style={{
                      boxShadow: "var(--shadow-card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl text-primary">
                        {m.icon || "🎯"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-extrabold text-foreground">{m.title}</p>
                          {m.is_completed ? (
                            <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-500">
                              Done ✓
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
                              +{m.reward_points} pts
                            </span>
                          )}
                        </div>
                        {m.description && (
                          <p className="mt-0.5 line-clamp-1 text-[11.5px] font-medium text-muted-foreground">
                            {m.description}
                          </p>
                        )}
                        {m.linked_menu_item_name && (
                          <p className="mt-0.5 text-[11.5px] font-medium text-ember">
                            Buy {m.linked_menu_item_name} {m.target_count}x
                          </p>
                        )}
                        <div className="mt-2.5">
                          <div className="mb-1 flex items-center justify-between text-[10px] font-extrabold text-muted-foreground">
                            <span>
                              {m.current_count} / {m.target_count}
                            </span>
                            <span className="capitalize">{m.mission_type.replace(/_/g, " ")}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min(100, (m.current_count / m.target_count) * 100)}%`,
                                background: m.is_completed
                                  ? "#10B981"
                                  : "linear-gradient(90deg, var(--primary) 0%, var(--primary) 100%)",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Fallback Mission Display */
              <div
                className="rounded-[26px] bg-card p-4.5"
                style={{ boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-xl text-emerald-500">
                    <Target className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-extrabold text-foreground">Order any drink</p>
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
                        +25 pts
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">
                      Order 1 drink today to claim bonus points
                    </p>
                    <div className="mt-2.5 flex items-center justify-between text-[10px] font-extrabold text-muted-foreground">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted mr-3">
                        <div className="h-full w-1/2 rounded-full bg-emerald-500" />
                      </div>
                      <span>1 / 2</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Real Rewards Section (Ultra-Premium Modern Style) */}
        {selectedMerchantId && joined && (
          <section className="px-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                Available Rewards
              </p>
              <Link to="/rewards" className="text-[11px] font-extrabold text-primary hover:underline">
                Explore all
              </Link>
            </div>
            {rewards.length > 0 ? (
              <div className="space-y-3">
                {rewards.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-[26px] bg-card p-4 transition-all"
                    style={{
                      boxShadow: "var(--shadow-card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl">
                        {r.emoji || "🎁"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-extrabold text-foreground">{r.name}</p>
                        {r.description && (
                          <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                            {r.description}
                          </p>
                        )}
                        <span className="mt-1 inline-block text-[11px] font-extrabold text-primary">
                          {r.points_cost} pts
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRedeemReward(r)}
                      disabled={redeemingRewardId === r.id || points < r.points_cost}
                      className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-extrabold transition-all active:scale-95 ${
                        points >= r.points_cost
                          ? "bg-primary text-primary-foreground shadow-md hover:opacity-90"
                          : "bg-muted text-muted-foreground cursor-not-allowed"
                      }`}
                    >
                      {redeemingRewardId === r.id ? "Redeeming…" : points >= r.points_cost ? "Redeem" : "Locked"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              /* Fallback Reward Display */
              <div className="space-y-3">
                <div
                  className="flex items-center justify-between rounded-[26px] bg-card p-4"
                  style={{ boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-xl text-primary">
                      <Gift className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-extrabold text-foreground">Free Special Chiya</p>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                        1 Free cup of signature Chiya Tea
                      </p>
                      <span className="mt-1 inline-block text-[11px] font-extrabold text-primary">
                        100 pts
                      </span>
                    </div>
                  </div>
                  <Link
                    to="/rewards"
                    className="shrink-0 rounded-full bg-primary px-4 py-2 text-[11px] font-extrabold text-primary-foreground shadow-md"
                  >
                    View
                  </Link>
                </div>
              </div>
            )}
          </section>
        )}

        {/* No merchant selected */}
        {!selectedMerchantId && !loading && (
          <section className="px-5">
            <div className="rounded-[24px] bg-card p-8 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-soft">
                <span className="text-2xl">✦</span>
              </div>
              <p className="mt-4 text-sm font-semibold text-foreground">Welcome to Zentro</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse stores to start earning loyalty points.
              </p>
              <Link
                to="/map"
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-6 text-xs font-medium text-white transition-all active:scale-95"
              >
                Discover stores
              </Link>
            </div>
          </section>
        )}
      </div>

      {/* Punch card proof modal */}
      {proofCard && (
        <PunchCardProofModal
          card={proofCard}
          onClose={() => setProofCard(null)}
          onRedeemed={() => {
            setProofCard(null);
            if (selectedMerchantId) {
              punchCardApi
                .customerList(selectedMerchantId)
                .then((data) => setPunchCards(data))
                .catch(() => {});
            }
          }}
        />
      )}

      {/* Table QR scanner */}
      {showTableScanner && (
        <Suspense fallback={null}>
          <TableQRScanner onClose={() => setShowTableScanner(false)} />
        </Suspense>
      )}
    </MobileShell>
  );
}
