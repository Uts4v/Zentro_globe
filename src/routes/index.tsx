// routes/index.tsx — Premium Zentro Home Screen
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import {
  X as XIcon,
  QrCode,
  SendHorizontal,
  Loader2,
  Target,
  Check,
  Gift,
  Flame,
  Tag,
  ArrowRight,
} from "lucide-react";
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
  import("@/features/transfers/components/PersonalQR").then((m) => ({ default: m.PersonalQR })),
);
const TableQRScanner = lazy(() =>
  import("@/features/pos/screens/TableQRScanner").then((m) => ({ default: m.TableQRScanner })),
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
  const navigate = useNavigate();

  // Data states
  const [merchantName, setMerchantName] = useState("");
  const [merchantSlug, setMerchantSlug] = useState<string | null>(null);
  const [merchantLogo, setMerchantLogo] = useState<string | null>(null);
  const [merchantCategory, setMerchantCategory] = useState<string | null>(null);
  const [merchantLocation, setMerchantLocation] = useState<string | null>(null);
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
  const [memberName, setMemberName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [freeRewards, setFreeRewards] = useState(0);
  const [loading, setLoading] = useState(true);
  const [todaySpecials, setTodaySpecials] = useState<TodaySpecial[]>([]);
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
    [merchantBusinessType],
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
          setMerchantLocation(m.address ?? null);
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

  // Load today's specials
  useEffect(() => {
    if (!merchantSlug) {
      setTodaySpecials([]);
      return;
    }
    specialApi
      .forSlug(merchantSlug)
      .then((list) => setTodaySpecials(list.filter((s) => s.is_active)))
      .catch(() => setTodaySpecials([]));
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
    const nextTier =
      tier === "bronze"
        ? "silver"
        : tier === "silver"
          ? "gold"
          : tier === "gold"
            ? "platinum"
            : "platinum";
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
        customerApi
          .getWallet(selectedMerchantId)
          .then((w) => {
            if (w) setPoints(w.points_balance);
          })
          .catch(() => {});
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to redeem reward");
    } finally {
      setRedeemingRewardId(null);
    }
  }

  function handleSpecialClick(s: TodaySpecial) {
    if (s.linked_menu_item) {
      add(String(s.linked_menu_item));
      toast.success(`${s.linked_menu_item_name ?? "Today's special"} added to cart`);
      navigate({ to: "/menu" });
    } else if (s.linked_reward) {
      navigate({ to: "/rewards" });
    } else {
      navigate({ to: "/menu" });
    }
  }

  async function handleJoin() {
    if (joining) return;
    if (!merchantSlug) {
      navigate({ to: "/map" });
      return;
    }
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
      {merchantSlug && (
        <TodaySpecialPopup
          slug={merchantSlug}
          onOrderItem={(menuItemId) => {
            add(menuItemId);
            navigate({ to: "/menu" });
          }}
          onViewReward={() => navigate({ to: "/rewards" })}
        />
      )}

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
              merchantLocation={merchantLocation}
              tier={tier}
              points={points}
              streak={streak}
              ordersCount={ordersCount}
              rewardsCount={freeRewards}
              progressPercent={progressPercent}
              pointsToNextTier={(() => {
                const tierThresholds: Record<string, number> = {
                  bronze: 500,
                  silver: 1500,
                  gold: 3000,
                  platinum: 5000,
                };
                const next =
                  tier === "bronze"
                    ? "silver"
                    : tier === "silver"
                      ? "gold"
                      : tier === "gold"
                        ? "platinum"
                        : "";
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
            <div
              className="overflow-hidden rounded-[24px] bg-card p-5"
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex min-w-0 items-center justify-between">
                <h3 className="font-display min-w-0 truncate text-xl text-foreground">
                  Transfer Points
                </h3>
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
                    transferMode === "send" ? "bg-card text-foreground" : "text-muted-foreground"
                  }`}
                  style={transferMode === "send" ? { boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : {}}
                >
                  <SendHorizontal className="h-4 w-4" /> Send
                </button>
                <button
                  onClick={() => setTransferMode("receive")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-[14px] py-2.5 text-xs font-medium transition-all ${
                    transferMode === "receive" ? "bg-card text-foreground" : "text-muted-foreground"
                  }`}
                  style={
                    transferMode === "receive" ? { boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : {}
                  }
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
                      customerApi
                        .getWallet(selectedMerchantId)
                        .then((w) => {
                          if (w) setPoints(w.points_balance);
                        })
                        .catch(() => {});
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

        {/* Today's Special Carousel */}
        {selectedMerchantId && todaySpecials.length > 0 && (
          <section className="px-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted-foreground">
                Today's Special{todaySpecials.length > 1 ? "s" : ""}
              </p>
              {todaySpecials.length > 1 && (
                <span className="text-[11px] text-muted-foreground">Swipe to see more</span>
              )}
            </div>
            <style>{`.today-specials-scroll::-webkit-scrollbar { display: none; }`}</style>
            <div className="today-specials-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-2">
              {todaySpecials.map((s) => {
                const hasDiscount = s.discount_type !== "none" && s.discount_value != null;
                const discountLabel = hasDiscount
                  ? s.discount_type === "percentage"
                    ? `${s.discount_value}% OFF`
                    : `Rs. ${s.discount_value} OFF`
                  : null;
                const discountedPrice = (() => {
                  if (!hasDiscount || !s.linked_menu_item_price) return null;
                  const price = parseFloat(s.linked_menu_item_price);
                  if (Number.isNaN(price)) return null;
                  return s.discount_type === "percentage"
                    ? (price * (1 - (s.discount_value ?? 0) / 100)).toFixed(0)
                    : Math.max(0, price - (s.discount_value ?? 0)).toFixed(0);
                })();
                const ctaLabel = s.linked_menu_item
                  ? "Order now"
                  : s.linked_reward
                    ? "View reward"
                    : "Browse menu";
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSpecialClick(s)}
                    aria-label={`${ctaLabel}: ${s.title}`}
                    className={`group relative shrink-0 snap-start overflow-hidden rounded-[26px] bg-card text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] ${
                      todaySpecials.length > 1 ? "w-[85%]" : "w-full"
                    }`}
                    style={{
                      boxShadow: "var(--shadow-card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {/* Banner */}
                    <div className="relative h-32 w-full overflow-hidden">
                      {s.image_url ? (
                        <img
                          src={s.image_url}
                          alt={s.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ember-soft via-card to-primary/10">
                          <Flame className="h-10 w-10 text-ember" />
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
                      {discountLabel && (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-extrabold text-white shadow-md">
                          <Tag className="h-3 w-3" />
                          {discountLabel}
                        </span>
                      )}
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-ink shadow-sm backdrop-blur-sm">
                        Today only
                      </span>
                    </div>

                    {/* Body */}
                    <div className="p-4">
                      <h3 className="truncate text-[15px] font-black leading-snug text-foreground">
                        {s.title}
                      </h3>
                      {s.description && (
                        <p className="mt-1 line-clamp-2 text-[11.5px] font-medium leading-relaxed text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                      {(s.linked_menu_item_name || s.linked_reward_name) && (
                        <div className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-ember-soft px-2.5 py-1 text-[10px] font-bold text-ember">
                          <span className="truncate">
                            {s.linked_menu_item_name ?? s.linked_reward_name}
                          </span>
                          {discountedPrice && s.linked_menu_item_price && (
                            <span className="shrink-0 whitespace-nowrap">
                              <span className="line-through opacity-50">
                                Rs. {s.linked_menu_item_price}
                              </span>{" "}
                              <span className="font-extrabold text-emerald-600">
                                Rs. {discountedPrice}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                        <span className="text-[12px] font-extrabold text-primary">{ctaLabel}</span>
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary transition-transform duration-200 group-hover:translate-x-0.5">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
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
              <Link
                to="/missions"
                className="text-[11px] font-extrabold text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            {missions.length > 0 ? (
              <div className="space-y-3">
                {missions.map((m) => {
                  const pct = Math.min((m.current_count / m.target_count) * 100, 100);
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3.5 rounded-[26px] bg-card p-4 transition-all"
                      style={{
                        boxShadow: "var(--shadow-card)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mist text-2xl">
                        <span style={{ filter: "grayscale(1) brightness(0)" }}>
                          {m.icon || "🎯"}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-extrabold text-foreground">
                            {m.title}
                          </p>
                          {m.is_completed ? (
                            <span className="shrink-0 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-500">
                              Done ✓
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-extrabold text-primary">
                              +{m.reward_points} pts
                            </span>
                          )}
                        </div>
                        {m.description && (
                          <p className="mt-0.5 truncate text-[11.5px] font-medium text-muted-foreground">
                            {m.description}
                          </p>
                        )}
                        {m.linked_menu_item_name && (
                          <p className="mt-0.5 truncate text-[11.5px] font-medium text-ember">
                            Buy {m.linked_menu_item_name} {m.target_count}x
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${pct}%`,
                                background: m.is_completed
                                  ? "#10B981"
                                  : "linear-gradient(90deg, var(--primary) 0%, var(--primary) 100%)",
                              }}
                            />
                          </div>
                          <span className="shrink-0 text-[10px] font-extrabold text-muted-foreground">
                            {m.current_count}/{m.target_count}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Fallback Mission Display */
              <div
                className="flex items-center gap-3.5 rounded-[26px] bg-card p-4"
                style={{ boxShadow: "var(--shadow-card)", border: "1px solid var(--border)" }}
              >
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mist text-2xl">
                  <span style={{ filter: "grayscale(1) brightness(0)" }}>🎯</span>
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
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-1/2 rounded-full bg-emerald-500" />
                    </div>
                    <span className="shrink-0 text-[10px] font-extrabold text-muted-foreground">
                      1 / 2
                    </span>
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
              <Link
                to="/rewards"
                className="text-[11px] font-extrabold text-primary hover:underline"
              >
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
                    <div className="flex min-w-0 flex-1 items-center gap-3.5 pr-3">
                      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mist text-2xl">
                        <span style={{ filter: "grayscale(1) brightness(0)" }}>
                          {r.emoji || "🎁"}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-extrabold text-foreground">
                          {r.name}
                        </p>
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
                      {redeemingRewardId === r.id
                        ? "Redeeming…"
                        : points >= r.points_cost
                          ? "Redeem"
                          : "Locked"}
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
                      <p className="truncate text-[14px] font-extrabold text-foreground">
                        Free Special Chiya
                      </p>
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

        {/* No merchant selected — Membership hero handles the empty state */}
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
