import { createFileRoute } from "@tanstack/react-router";
import { customerApi, leaderboardApi } from "@/lib/api";
import { useStore } from "@/lib/store";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { requireAuth } from "@/lib/auth-guard";
import { useEffect, useState } from "react";
import { Flame, Trophy, Star } from "lucide-react";

export const Route = createFileRoute("/leaderboard")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Leaderboard · Zentro" }] }),
  component: Leaders,
});

type LeaderEntry = {
  rank: number;
  customer_id: string;
  full_name: string | null;
  loyalty_points: number;
  tier: string;
  streak_days: number;
};

const TIER_CONFIG = [
  { name: "Bronze", min: 0, color: "bg-amber-700", dot: "bg-amber-700" },
  { name: "Silver", min: 500, color: "bg-gray-400", dot: "bg-gray-400" },
  { name: "Gold", min: 2000, color: "bg-yellow-500", dot: "bg-yellow-500" },
  { name: "Platinum", min: 5000, color: "bg-purple-500", dot: "bg-purple-500" },
];

function getTier(pts: number) {
  return [...TIER_CONFIG].reverse().find((t) => pts >= t.min) ?? TIER_CONFIG[0];
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-2xl">🥇</span>;
  if (rank === 2) return <span className="text-2xl">🥈</span>;
  if (rank === 3) return <span className="text-2xl">🥉</span>;
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-mist text-sm font-bold text-muted-foreground">
      {rank}
    </span>
  );
}

function Leaders() {
  const { selectedMerchantId } = useStore();
  const [profile, setProfile] = useState<{ id: string; full_name: string | null } | null>(null);
  const [wallet, setWallet] = useState<{
    points_balance: number;
    tier_level: string;
    streak_days: number;
    order_count: number;
  } | null>(null);
  const [leaders, setLeaders] = useState<LeaderEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!selectedMerchantId) {
        setProfile(null);
        setWallet(null);
        setLeaders([]);
        setMyRank(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [p, w, lb] = await Promise.all([
          customerApi.profile(),
          customerApi.getWallet(selectedMerchantId),
          leaderboardApi.get(selectedMerchantId, 50),
        ]);
        setProfile({ id: p.id, full_name: p.full_name });
        setWallet(w);
        setLeaders(lb as LeaderEntry[]);
        const mine = (lb as LeaderEntry[]).find((e) => String(e.customer_id) === String(p.id));
        setMyRank(mine ? mine.rank : null);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedMerchantId]);

  const points = wallet?.points_balance ?? 0;
  const tier = getTier(points);

  return (
    <MobileShell>
      <TopBar />
      <div className="px-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Rankings</p>
        <h1 className="font-display mt-1 text-4xl text-foreground">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Top customers at your current store.</p>
      </div>

      {!selectedMerchantId && !loading && (
        <p className="mt-8 px-5 text-center text-sm text-muted-foreground">
          Open a store via QR code to see the leaderboard.
        </p>
      )}

      {loading && <p className="mt-8 text-center text-sm text-muted-foreground">Loading…</p>}

      {!loading && selectedMerchantId && profile && (
        <>
          {/* Your rank card */}
          <section className="mt-6 px-5">
            <div className="relative overflow-hidden rounded-3xl bg-slate-900 dark:bg-slate-800 p-6 text-white shadow-ember">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full gradient-ember opacity-30 blur-3xl" />
              <div className="relative flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-ember" />
                    <p className="text-[11px] uppercase tracking-widest text-white/60">Your Rank</p>
                  </div>
                  <p className="font-display mt-1 text-6xl leading-none text-white">
                    #{myRank ?? "—"}
                  </p>
                  <p className="mt-1 text-sm text-white/70">
                    {profile.full_name ?? "You"} · {tier.name}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-center">
                  <p className="font-display text-3xl text-white">{points.toLocaleString()}</p>
                  <p className="text-[10px] uppercase tracking-wider text-white/50">pts</p>
                </div>
              </div>
              <div className="relative mt-5 grid grid-cols-3 gap-3">
                {[
                  { label: "Points", val: points.toLocaleString() },
                  { label: "Orders", val: wallet?.order_count ?? 0 },
                  {
                    label: "Streak",
                    val: wallet?.streak_days ?? 0,
                    icon: <Flame className="h-4 w-4 text-ember" />,
                  },
                ].map(({ label, val, icon }) => (
                  <div key={label} className="rounded-2xl bg-white/10 p-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {icon}
                      <p className="font-display text-2xl">{val}</p>
                    </div>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider text-white/60">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Podium */}
          {leaders.length >= 3 && (
            <section className="mt-6 px-5">
              <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Top 3
              </p>
              <div className="flex items-end gap-2">
                {[leaders[1], leaders[0], leaders[2]].map((entry, col) => (
                  <div key={entry.customer_id} className="flex flex-1 flex-col items-center gap-2">
                    <p className="text-xs font-medium text-foreground truncate max-w-full text-center">
                      {entry.full_name ?? "Customer"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entry.loyalty_points.toLocaleString()} pts
                    </p>
                    <div
                      className={`flex w-full items-center justify-center rounded-t-2xl text-2xl ${
                        col === 0
                          ? "h-16 bg-gray-200 dark:bg-gray-700"
                          : col === 1
                            ? "h-24 bg-amber-100 dark:bg-amber-700"
                            : "h-12 bg-orange-100 dark:bg-orange-700"
                      }`}
                    >
                      {col === 0 ? "🥈" : col === 1 ? "🥇" : "🥉"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Full list */}
          <section className="mt-4 px-5 pb-8">
            <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Top {leaders.length}
            </p>
            <div className="space-y-2">
              {leaders.map((entry) => {
                const isMe = String(entry.customer_id) === String(profile.id);
                const eTier = getTier(entry.loyalty_points);
                return (
                  <div
                    key={entry.customer_id}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${isMe ? "bg-slate-900 dark:bg-slate-800 text-white shadow-ember" : "glass"}`}
                  >
                    <RankBadge rank={entry.rank} />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm font-medium ${isMe ? "text-white" : "text-foreground"}`}
                      >
                        {entry.full_name ?? "Customer"}
                        {isMe && <span className="ml-2 text-[10px] text-white/60">· You</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span
                          className={`text-[10px] ${isMe ? "text-white/60" : "text-muted-foreground"}`}
                        >
                          {eTier.name}
                        </span>
                        {entry.streak_days > 0 && (
                          <span
                            className={`flex items-center gap-0.5 text-[10px] ${isMe ? "text-white/60" : "text-muted-foreground"}`}
                          >
                            <Flame className="h-2.5 w-2.5 text-ember" />
                            {entry.streak_days}d
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-display text-lg ${isMe ? "text-white" : "text-foreground"}`}
                      >
                        {entry.loyalty_points.toLocaleString()}
                      </p>
                      <p
                        className={`text-[10px] ${isMe ? "text-white/60" : "text-muted-foreground"}`}
                      >
                        pts
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Tier milestones */}
          <section className="px-5 pb-8">
            <div className="glass rounded-3xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Star className="h-4 w-4 text-ember" />
                <p className="text-sm font-medium text-foreground">Tier milestones</p>
              </div>
              <div className="space-y-3">
                {TIER_CONFIG.map((t) => {
                  const reached = points >= t.min;
                  const isCurrent = tier.name === t.name;
                  return (
                    <div key={t.name} className="flex items-center gap-3">
                      <div
                        className={`h-3 w-3 rounded-full ${t.dot} ${!reached ? "opacity-30" : ""}`}
                      />
                      <span
                        className={`text-sm ${reached ? "font-medium text-foreground" : "text-muted-foreground"}`}
                      >
                        {t.name}
                        {isCurrent && (
                          <span className="ml-2 rounded-full bg-ember-soft px-2 py-0.5 text-[10px] text-ember">
                            Current
                          </span>
                        )}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {t.min.toLocaleString()}+ pts
                      </span>
                      {reached && <span className="text-xs text-ember">✓</span>}
                    </div>
                  );
                })}
                {(() => {
                  const next = TIER_CONFIG.find((t) => t.min > points);
                  if (!next) return null;
                  return (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {(next.min - points).toLocaleString()} more pts to reach {next.name}
                    </p>
                  );
                })()}
              </div>
            </div>
          </section>
        </>
      )}
    </MobileShell>
  );
}
