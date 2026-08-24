import { createFileRoute } from "@tanstack/react-router";
import { rewardApi, customerApi, type Reward } from "@/lib/api";
import { useStore } from "@/lib/store";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { Lock } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/rewards")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Rewards · Zentro" }] }),
  component: Rewards,
});

function Rewards() {
  const { selectedMerchantId } = useStore();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedMerchantId) {
      setRewards([]);
      setPoints(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      rewardApi
        .list(selectedMerchantId)
        .then(setRewards)
        .catch(() => setRewards([])),
      customerApi
        .getWallet(selectedMerchantId)
        .then((w) => setPoints(w?.points_balance ?? 0))
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [selectedMerchantId]);

  const handleRedeem = async (rewardId: string) => {
    setRedeeming(rewardId);
    try {
      await rewardApi.redeem(rewardId);
      if (selectedMerchantId) {
        const wallet = await customerApi.getWallet(selectedMerchantId);
        setPoints(wallet?.points_balance ?? 0);
      }
      setSuccessId(rewardId);
      setTimeout(() => setSuccessId(null), 2000);
    } catch (e: any) {
      alert(e.message || "Failed to redeem. Do you have enough points?");
    } finally {
      setRedeeming(null);
    }
  };

  return (
    <MobileShell>
      <TopBar />
      <div className="px-5">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Redeem</p>
        <h1 className="font-display mt-1 text-4xl text-foreground">Rewards</h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-ember-soft px-4 py-2">
          <span className="text-xs text-foreground">Balance</span>
          <span className="font-display text-lg text-ember">{points} pts</span>
        </div>
      </div>

      <div className="mt-6 space-y-3 px-5 pb-8">
        {!selectedMerchantId && !loading && (
          <p className="text-center text-sm text-muted-foreground">
            Scan a store QR code or open a merchant link to see rewards.
          </p>
        )}
        {selectedMerchantId && loading && (
          <p className="text-center text-sm text-muted-foreground">Loading rewards…</p>
        )}
        {!loading && rewards.length === 0 && (
          <div className="glass rounded-3xl py-16 text-center">
            <p className="text-4xl">🎁</p>
            <p className="mt-3 text-sm text-muted-foreground">No rewards available yet.</p>
          </div>
        )}
        {rewards.map((r) => {
          const affordable = points >= r.points_cost;
          const isRedeeming = redeeming === r.id;
          const justRedeemed = successId === r.id;
          return (
            <article
              key={r.id}
              className={`flex items-center justify-between rounded-[26px] bg-card p-4 transition-all ${
                !affordable ? "opacity-70" : ""
              }`}
              style={{
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border)",
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3.5 pr-3">
                <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-mist text-2xl">
                  <span style={{ filter: "grayscale(1) brightness(0)" }}>{r.emoji || "🎁"}</span>
                  {!affordable && (
                    <div className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/80 text-primary-foreground">
                      <Lock className="h-2.5 w-2.5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-extrabold text-foreground">{r.name}</p>
                  {r.description && (
                    <p className="truncate text-[11px] font-medium text-muted-foreground">
                      {r.description}
                    </p>
                  )}
                  {r.linked_menu_item_name && (
                    <p className="truncate text-[11px] font-medium text-ember">
                      {r.linked_menu_item_name}
                    </p>
                  )}
                  <span className="mt-1 inline-block font-display text-base text-primary">
                    {r.points_cost} pts
                  </span>
                </div>
              </div>
              <button
                disabled={!affordable || isRedeeming}
                onClick={() => handleRedeem(r.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-[11px] font-extrabold transition-all active:scale-95 ${
                  justRedeemed
                    ? "bg-emerald-500 text-white"
                    : affordable
                      ? "bg-primary text-primary-foreground shadow-md hover:opacity-90"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                }`}
              >
                {isRedeeming ? "…" : justRedeemed ? "✓" : affordable ? "Redeem" : "Locked"}
              </button>
            </article>
          );
        })}
      </div>
    </MobileShell>
  );
}
