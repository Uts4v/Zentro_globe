// C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\features\cards\components\MembershipCardDetail.tsx
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import {
  membershipCardApi,
  transactionApi,
  missionApi,
  punchCardApi,
  type MembershipCard,
  type PointTransaction,
  type MissionView,
  type CustomerPunchCard,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MobileShell } from "@/components/MobileShell";
import { PunchCardProofModal } from "@/components/PunchCardProofModal";
import {
  ArrowLeft,
  QrCode,
  ArrowRightLeft,
  Flame,
  Sparkles,
  Gift,
  ChevronRight,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

function cardGradient(design: MembershipCard["card_design"], merchantName: string) {
  if (design) {
    return {
      background: `linear-gradient(135deg, ${design.primary_color} 0%, ${design.secondary_color} 100%)`,
      color: design.text_mode === "light" ? "#ffffff" : "#1a1a1a",
    };
  }
  const safeName = merchantName || "Zentro";
  const hash = safeName.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(hash) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 35%, 18%) 0%, hsl(${(hue + 30) % 360}, 40%, 28%) 100%)`,
    color: "#ffffff",
  };
}

function tierBadgeColor(tier: string) {
  switch (tier) {
    case "platinum":
      return "bg-white/20 text-white";
    case "gold":
      return "bg-amber-300/20 text-amber-100";
    case "silver":
      return "bg-white/15 text-white/80";
    default:
      return "bg-white/10 text-white/60";
  }
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 px-5 pb-10">
      <div className="h-10 w-40 animate-pulse rounded-xl bg-muted" />
      <div className="h-[260px] animate-pulse rounded-[28px] bg-muted" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-20 animate-pulse rounded-2xl bg-muted" />
        <div className="h-20 animate-pulse rounded-2xl bg-muted" />
      </div>
      <div className="h-40 animate-pulse rounded-3xl bg-muted" />
    </div>
  );
}

export function MembershipCardDetail({ merchantSlug }: { merchantSlug: string }) {
  const { user } = useAuth();
  const transferCode = user?.customer_profile?.transfer_code;

  const [card, setCard] = useState<MembershipCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showQr, setShowQr] = useState(true);

  const [transactions, setTransactions] = useState<PointTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);

  const [missions, setMissions] = useState<MissionView[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);

  const [punchCards, setPunchCards] = useState<{
    active: CustomerPunchCard[];
    completed: CustomerPunchCard[];
  }>({ active: [], completed: [] });
  const [punchLoading, setPunchLoading] = useState(true);
  const [proofCard, setProofCard] = useState<CustomerPunchCard | null>(null);

  useEffect(() => {
    let cancelled = false;
    membershipCardApi
      .list()
      .then((cards) => {
        if (cancelled) return;
        const found = cards.find((c) => c.merchant.slug === merchantSlug);
        if (found) {
          setCard(found);
          return Promise.all([
            transactionApi.customerList(merchantSlug).catch(() => []),
            missionApi.myMissions(merchantSlug).catch(() => []),
            punchCardApi.customerList(merchantSlug).catch(() => ({ active: [], completed: [] })),
          ]).then(([txns, mis, pc]) => {
            if (!cancelled) {
              setTransactions(txns);
              setMissions(mis);
              setPunchCards(pc);
            }
          });
        } else {
          setError("Card not found");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Failed to load card");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setTxLoading(false);
          setMissionsLoading(false);
          setPunchLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [merchantSlug]);

  if (loading) {
    return (
      <MobileShell>
        <div className="px-5 pt-5">
          <DetailSkeleton />
        </div>
      </MobileShell>
    );
  }

  if (error || !card) {
    return (
      <MobileShell>
        <div className="flex flex-col items-center justify-center px-5 pb-10 pt-20 text-center">
          <p className="text-sm text-muted-foreground">{error || "Card not found"}</p>
          <Link to="/cards" className="mt-4 text-sm font-medium text-ember underline">
            Back to cards
          </Link>
        </div>
      </MobileShell>
    );
  }

  const merchantName = card.merchant?.name || "Zentro";
  const style = cardGradient(card.card_design, merchantName);
  const tier = card.wallet?.tier ?? "bronze";
  const points = card.wallet?.points_balance ?? 0;
  const lifetime = card.wallet?.lifetime_points ?? 0;
  const streakDays = card.wallet?.streak_days ?? 0;
  const design = card.card_design;

  return (
    <MobileShell>
      <div className="px-5 pb-10 pt-2">
        <Link
          to="/cards"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> My Cards
        </Link>

        {/* Full card */}
        <div
          className="relative overflow-hidden rounded-[28px] p-6 shadow-lg animate-card-enter"
          style={design?.background_image ? { ...style, background: "rgba(0,0,0,0.25)" } : style}
        >
          {design?.background_image && (
            <img
              src={design.background_image}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-white/5 blur-3xl" />

          <div className="relative flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.2em] opacity-50">
                {design?.card_title || "Membership"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                {card.merchant.logo && (
                  <img
                    src={card.merchant.logo}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-xl object-cover"
                  />
                )}
                <p className="truncate font-display text-3xl">{merchantName}</p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-widest ${tierBadgeColor(tier)}`}
            >
              {tier}
            </span>
          </div>

          <div className="relative mt-8">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-50">
              {design?.points_label || "Points balance"}
            </p>
            <p className="font-display mt-0.5 text-[64px] leading-none tracking-tight">
              {points.toLocaleString()}
            </p>
            <p className="mt-1 text-xs opacity-40">
              ≈ {Math.floor(points / 80)} free drinks · {lifetime.toLocaleString()} lifetime pts
            </p>
          </div>

          <div className="relative mt-6 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/8 p-3 backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest opacity-60">
                <Flame className="h-3 w-3" /> Tier
              </div>
              <p className="font-display mt-1 text-lg capitalize">{tier}</p>
            </div>
            {streakDays > 0 && (
              <div className="rounded-2xl bg-white/8 p-3 backdrop-blur-md">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest opacity-60">
                  <Flame className="h-3 w-3" /> Streak
                </div>
                <p className="font-display mt-1 text-lg">{streakDays}d</p>
              </div>
            )}
            {card.membership.joined_at && (
              <div className="rounded-2xl bg-white/8 p-3 backdrop-blur-md">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest opacity-60">
                  <Sparkles className="h-3 w-3" /> Joined
                </div>
                <p className="font-display mt-1 text-sm">
                  {new Date(card.membership.joined_at).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>

          <div className="relative mt-5 flex items-end justify-between">
            <div>
              <p className="font-mono text-[10px] tracking-widest opacity-40">
                {card.membership.membership_number_masked}
              </p>
            </div>
            {card.transfer_enabled && (
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[9px] uppercase tracking-widest opacity-60">
                <ArrowRightLeft className="h-2.5 w-2.5" /> Transfers enabled
              </span>
            )}
          </div>
        </div>

        {/* QR Code toggle */}
        <div className="mt-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <button
            onClick={() => setShowQr(!showQr)}
            className="glass flex w-full items-center justify-between rounded-2xl p-4 transition-all hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-ember-soft">
                <QrCode className="h-5 w-5 text-ember" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-foreground">
                  {showQr ? "Hide QR Code" : "Show QR Code"}
                </p>
                <p className="text-xs text-muted-foreground">Let the merchant scan this</p>
              </div>
            </div>
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${showQr ? "rotate-90" : ""}`}
            />
          </button>

          {showQr && (
            <div className="glass-strong mt-2 flex flex-col items-center rounded-3xl p-8">
              {transferCode ? (
                <div className="flex flex-col items-center rounded-2xl bg-white p-4">
                  <QRCodeSVG
                    value={`zentro-transfer:${transferCode}`}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Show this to earn or redeem points
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    No transfer code available
                  </p>
                  <button
                    onClick={() => setShowQr(false)}
                    className="rounded-full bg-ember px-4 py-2 text-xs font-medium text-white active:scale-95"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick stats */}
        <div
          className="mt-4 grid grid-cols-3 gap-3 animate-slide-up"
          style={{ animationDelay: "150ms" }}
        >
          <div className="glass rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Earned</p>
            <p className="font-display mt-1 text-xl text-foreground">{lifetime.toLocaleString()}</p>
          </div>
          <div className="glass rounded-2xl p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Tier</p>
            <p className="font-display mt-1 text-xl text-foreground">
              {Math.min(Math.floor((points / 5000) * 100), 100)}%
            </p>
          </div>
          {streakDays > 0 && (
            <div className="glass rounded-2xl p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Streak</p>
              <p className="font-display mt-1 text-xl text-foreground">{streakDays}d</p>
            </div>
          )}
        </div>

        {/* Progress to Platinum */}
        <div
          className="glass mt-4 rounded-3xl p-5 animate-slide-up"
          style={{ animationDelay: "200ms" }}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Progress to Platinum</p>
            <p className="text-xs text-muted-foreground">{points}/5000 pts</p>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist">
            <div
              className="h-full rounded-full gradient-ember transition-all duration-500"
              style={{ width: `${Math.min((points / 5000) * 100, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {5000 - points > 0
              ? `${5000 - points} pts to unlock Platinum perks.`
              : "You reached Platinum!"}
          </p>
        </div>

        {/* Punch Cards */}
        <section className="mt-6">
          <h3 className="font-display mb-3 text-xl text-foreground">Punch Cards</h3>
          {punchLoading ? (
            <div className="glass rounded-3xl p-6 text-center">
              <div className="mx-auto h-5 w-32 animate-pulse rounded-full bg-muted" />
            </div>
          ) : [...punchCards.completed, ...punchCards.active].length === 0 ? (
            <div className="glass rounded-3xl p-6 text-center">
              <p className="text-xs text-muted-foreground">No punch cards at this merchant.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...punchCards.completed, ...punchCards.active].map((pc) => (
                <div key={pc.id} className="glass-strong rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{pc.merchant_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pc.current_stamps}/{pc.punch_card?.stamps_required ?? 10} stamps
                      </p>
                    </div>
                    {pc.is_completed && (
                      <button
                        onClick={() => setProofCard(pc)}
                        className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                      >
                        Ready to redeem
                      </button>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full gradient-ember transition-all"
                      style={{
                        width: `${Math.min((pc.current_stamps / (pc.punch_card?.stamps_required ?? 10)) * 100, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Missions */}
        <section className="mt-6">
          <h3 className="font-display mb-3 text-xl text-foreground">Missions</h3>
          {missionsLoading ? (
            <div className="glass rounded-3xl p-6 text-center">
              <div className="mx-auto h-5 w-32 animate-pulse rounded-full bg-muted" />
            </div>
          ) : missions.length === 0 ? (
            <div className="glass rounded-3xl p-6 text-center">
              <p className="text-xs text-muted-foreground">No missions at this merchant.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {missions.map((m) => {
                const pct = Math.min((m.current_count / m.target_count) * 100, 100);
                const done = m.is_completed || m.current_count >= m.target_count;
                return (
                  <div key={m.id} className="glass-strong rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-soft text-xl">
                        {m.icon || "🎯"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                          <span className="font-display shrink-0 text-xs text-ember">
                            {m.current_count}/{m.target_count}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{m.description}</p>
                        {m.linked_menu_item_name && (
                          <p className="mt-1 text-[11px] font-medium text-ember">Buy {m.linked_menu_item_name} {m.target_count}x</p>
                        )}
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${done ? "bg-ink" : "gradient-ember"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">
                            +{m.reward_points} pts
                          </p>
                          {done && (
                            <span className="rounded-full bg-slate-900 dark:bg-white px-2 py-0.5 text-[9px] uppercase tracking-widest text-white dark:text-slate-900">
                              Done ✓
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent Transactions */}
        <section className="mt-6">
          <h3 className="font-display mb-3 text-xl text-foreground">Transactions</h3>
          {txLoading ? (
            <div className="glass rounded-3xl p-6 text-center">
              <div className="mx-auto h-5 w-32 animate-pulse rounded-full bg-muted" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="glass rounded-3xl p-6 text-center">
              <p className="text-xs text-muted-foreground">No transactions yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.slice(0, 8).map((tx) => (
                <div
                  key={tx.id}
                  className="glass rounded-2xl p-3.5 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground capitalize">
                      {tx.transaction_type.toLowerCase().replace("_", " ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-bold ${tx.points >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {tx.points > 0 ? "+" : ""}
                      {tx.points} pts
                    </p>
                    <p className="text-[10px] text-muted-foreground">Bal: {tx.balance_after}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Transfer CTA */}
        {card.transfer_enabled && (
          <Link
            to="/transfers"
            search={{ code: undefined }}
            className="mt-6 flex items-center justify-between glass rounded-2xl p-4 transition-all hover:bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-ember-soft">
                <ArrowRightLeft className="h-5 w-5 text-ember" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Send Points</p>
                <p className="text-xs text-muted-foreground">
                  Transfer to a friend at this merchant
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        )}

        {/* Visit merchant CTA */}
        <Link
          to="/m/$slug"
          params={{ slug: merchantSlug }}
          className="mt-3 flex items-center justify-between glass rounded-2xl p-4 transition-all hover:bg-muted/50"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-lg">
              <Gift className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Visit Store</p>
              <p className="text-xs text-muted-foreground">View menu & specials</p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>

      {proofCard && (
        <PunchCardProofModal
          card={proofCard}
          onClose={() => setProofCard(null)}
          onRedeemed={() => {
            setProofCard(null);
            punchCardApi
              .customerList(merchantSlug)
              .then((data) => setPunchCards(data))
              .catch(() => {});
          }}
        />
      )}
    </MobileShell>
  );
}
