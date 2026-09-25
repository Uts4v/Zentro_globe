import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";

export interface RewardRedemptionDetails {
  code: string;
  expiresAt: string | null;
  rewardName: string;
  rewardEmoji?: string;
  pointsSpent?: number;
}

interface Props {
  redemption: RewardRedemptionDetails;
  onClose: () => void;
}

function secondsUntil(ms: number) {
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

/** Shown right after a points reward is redeemed: the code the merchant confirms. */
export function RewardRedemptionModal({ redemption, onClose }: Props) {
  const expiresAtMs = redemption.expiresAt ? new Date(redemption.expiresAt).getTime() : null;
  const [timeLeft, setTimeLeft] = useState<number | null>(() =>
    expiresAtMs === null ? null : secondsUntil(expiresAtMs),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (expiresAtMs === null) return;
    const t = setInterval(() => setTimeLeft(secondsUntil(expiresAtMs)), 1000);
    return () => clearInterval(t);
  }, [expiresAtMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(redemption.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the code is on screen.
    }
  }

  const expired = timeLeft === 0;
  const mins = Math.floor((timeLeft ?? 0) / 60);
  const secs = (timeLeft ?? 0) % 60;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-redemption-title"
        className="w-full max-w-sm overflow-hidden rounded-t-[2rem] bg-background pb-8 shadow-2xl sm:rounded-[2rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-ink px-6 pb-8 pt-6 text-center text-primary-foreground">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.2em] text-white/60">
            Show this to your merchant
          </p>
          <p id="reward-redemption-title" className="font-display mt-2 text-3xl">
            Reward Redeemed!
          </p>
        </div>

        <div className="-mt-6 mx-6 rounded-2xl bg-background p-6 text-center shadow-lg">
          <p className="text-4xl" style={{ filter: "grayscale(1) brightness(0)" }}>
            {redemption.rewardEmoji || "🎁"}
          </p>
          <p className="mt-3 font-medium text-foreground">{redemption.rewardName}</p>
          {redemption.pointsSpent ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {redemption.pointsSpent} points used
            </p>
          ) : null}

          <div className="mt-4 rounded-xl bg-mist p-4">
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Redemption Code
            </p>
            <p
              className={`font-mono text-4xl font-bold tracking-[0.3em] ${expired ? "text-muted-foreground line-through" : "text-ink"}`}
            >
              {redemption.code}
            </p>
            <button
              onClick={copyCode}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-ink"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>

          {timeLeft !== null && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {expired ? (
                <p className="text-sm font-medium text-rose-600">Code expired</p>
              ) : (
                <>
                  <span
                    className={`h-2 w-2 animate-pulse rounded-full ${timeLeft > 60 ? "bg-emerald-500" : "bg-amber-500"}`}
                  />
                  <p className="text-sm text-muted-foreground">
                    Expires in{" "}
                    <span
                      className={`font-medium ${timeLeft <= 60 ? "text-amber-600" : "text-ink"}`}
                    >
                      {mins}:{secs.toString().padStart(2, "0")}
                    </span>
                  </p>
                </>
              )}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Show this code to the merchant to confirm your reward
          </p>
          <button
            onClick={onClose}
            className="mt-6 w-full rounded-2xl bg-ink py-3 text-sm font-medium text-primary-foreground"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
