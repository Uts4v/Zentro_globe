import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { punchCardApi, type CustomerPunchCard } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  card: CustomerPunchCard;
  onClose: () => void;
  onRedeemed: () => void;
}

export function PunchCardProofModal({ card, onClose, onRedeemed }: Props) {
  const [proofData, setProofData] = useState<{
    proof_code: string;
    expires_at: string;
    reward_text: string;
    store_name: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    punchCardApi
      .generateProof(card.id)
      .then((data) => {
        setProofData(data);
        const expiresAt = new Date(data.expires_at).getTime();
        setTimeLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
      })
      .catch(() => toast.error("Failed to generate proof code"))
      .finally(() => setLoading(false));
  }, [card.id]);

  // Countdown timer
  useEffect(() => {
    if (timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [timeLeft]);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const expired = timeLeft === 0 && proofData !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-[2rem] bg-background pb-8 shadow-2xl sm:rounded-[2rem]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative bg-ink px-6 pb-8 pt-6 text-center text-primary-foreground">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">
            Show this to your merchant
          </p>
          <p className="font-display mt-2 text-3xl">Claim your reward</p>
          {proofData && <p className="mt-1 text-sm text-white/70">{proofData.store_name}</p>}
        </div>

        {/* Proof code */}
        <div className="-mt-6 mx-6 rounded-2xl bg-background p-6 shadow-lg">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : expired ? (
            <div className="py-6 text-center">
              <p className="text-4xl">⏰</p>
              <p className="mt-3 text-sm font-medium text-rose-600">Code expired</p>
              <p className="mt-1 text-xs text-muted-foreground">Ask your merchant to scan again</p>
            </div>
          ) : proofData ? (
            <>
              {/* Large proof code */}
              <div className="rounded-xl bg-mist p-4 text-center">
                <p className="font-mono text-4xl font-bold tracking-[0.3em] text-ink">
                  {proofData.proof_code}
                </p>
              </div>

              {/* Reward */}
              <div className="mt-4 rounded-xl bg-ember-soft px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">Your reward</p>
                <p className="mt-0.5 font-medium text-ink">{proofData.reward_text}</p>
              </div>

              {/* Timer */}
              <div className="mt-4 flex items-center justify-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${timeLeft > 60 ? "bg-emerald-500" : "bg-amber-500"} animate-pulse`}
                />
                <p className="text-sm text-muted-foreground">
                  Expires in{" "}
                  <span className={`font-medium ${timeLeft <= 60 ? "text-amber-600" : "text-ink"}`}>
                    {mins}:{secs.toString().padStart(2, "0")}
                  </span>
                </p>
              </div>

              <p className="mt-4 text-center text-xs text-muted-foreground">
                Show this screen to the merchant or read them the code above
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
