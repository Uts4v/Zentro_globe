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
      rewardApi.list(selectedMerchantId).then(setRewards).catch(() => setRewards([])),
      customerApi.getWallet(selectedMerchantId).then((w) => setPoints(w?.points_balance ?? 0)).catch(() => {}),
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

      <div className="mt-6 grid grid-cols-2 gap-3 px-5 pb-8">
        {!selectedMerchantId && !loading && (
          <p className="col-span-2 text-center text-sm text-muted-foreground">
            Scan a store QR code or open a merchant link to see rewards.
          </p>
        )}
        {selectedMerchantId && loading && (
          <p className="col-span-2 text-center text-sm text-muted-foreground">Loading rewards…</p>
        )}
        {!loading && rewards.length === 0 && (
          <div className="col-span-2 glass rounded-3xl py-16 text-center">
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
              className={`glass relative flex flex-col rounded-3xl p-4 ${!affordable ? "opacity-70" : ""}`}
            >
              {!affordable && (
                <div className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-ink/80 text-primary-foreground">
                  <Lock className="h-3 w-3" />
                </div>
              )}
              <div className="grid h-24 place-items-center rounded-2xl bg-mist text-5xl">
                {r.emoji || "🎁"}
              </div>
              <h3 className="mt-3 text-sm font-semibold text-foreground">{r.name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
              {r.linked_menu_item_name && (
                <p className="mt-1 text-xs font-medium text-ember">{r.linked_menu_item_name}</p>
              )}
              <div className="mt-3 flex items-center justify-between">
                <span className="font-display text-xl text-foreground">{r.points_cost} pts</span>
                <button
                  disabled={!affordable || isRedeeming}
                  onClick={() => handleRedeem(r.id)}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest transition-all ${
                    justRedeemed
                      ? "bg-emerald-500 text-white"
                      : affordable
                      ? "bg-ink text-primary-foreground hover:opacity-90"
                      : "bg-mist text-muted-foreground"
                  }`}
                >
                  {isRedeeming ? "…" : justRedeemed ? "✓" : affordable ? "Redeem" : "Locked"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </MobileShell>
  );
}
