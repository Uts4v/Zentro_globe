import { Gift, CheckCircle2 } from "lucide-react";
import type { CustomerPunchCard } from "@/lib/api";

interface FullBackgroundPunchCardProps {
  card: CustomerPunchCard;
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
}

export function FullBackgroundPunchCard({
  card,
  onRedeem,
  redeeming,
}: FullBackgroundPunchCardProps) {
  const config = card.punch_card;
  if (!config) return null;

  const punchesNeeded = config.stamps_required;
  const punchCount = card.current_stamps;
  const freeRewardReady = card.is_completed && !card.is_redeemed;
  const remaining = Math.max(punchesNeeded - punchCount, 0);

  const bgImage = config.animated_gif_background || config.background_image || null;
  const themeColor = config.color_scheme || "#1e293b";

  return (
    <div className="relative overflow-hidden rounded-[32px] shadow-xl">
      {/* Full background image / GIF */}
      {bgImage && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${bgImage})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      {/* Gradient overlay for readability */}
      <div
        className="absolute inset-0"
        style={{
          background: bgImage
            ? "linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.65) 100%)"
            : `linear-gradient(135deg, ${themeColor} 0%, ${themeColor}dd 100%)`,
        }}
      />

      <div className="relative p-6 pb-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/60">Punch Card</p>
            <h3 className="font-display mt-0.5 text-2xl text-white">{config.name}</h3>
          </div>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {punchCount} / {punchesNeeded}
          </span>
        </div>

        {/* Reward text */}
        <p className="mt-3 text-sm text-white/80">
          Reward: <span className="font-semibold text-white">{config.reward_text}</span>
        </p>

        {/* Big stamps grid */}
        <div className="mt-5 grid grid-cols-5 gap-3">
          {Array.from({ length: punchesNeeded }).map((_, i) => {
            const filled = i < punchCount || freeRewardReady;
            const isFreeSlot = freeRewardReady && i === punchesNeeded - 1;

            return (
              <div
                key={i}
                className="aspect-square flex items-center justify-center rounded-2xl transition-all duration-300"
                style={{
                  background: filled
                    ? isFreeSlot
                      ? "rgba(16, 185, 129, 0.9)"
                      : "rgba(255,255,255,0.95)"
                    : "rgba(255,255,255,0.15)",
                  backdropFilter: filled ? undefined : "blur(8px)",
                  border: filled ? "none" : "1px solid rgba(255,255,255,0.25)",
                  boxShadow: filled ? "0 4px 12px rgba(0,0,0,0.2)" : undefined,
                }}
              >
                {isFreeSlot ? (
                  <Gift className="h-6 w-6 text-white" />
                ) : filled ? (
                  config.stamp_gif_url ? (
                    <img
                      src={config.stamp_gif_url}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-2xl">{config.stamp_icon || "✨"}</span>
                  )
                ) : (
                  <span className="text-sm font-semibold text-white/50">{i + 1}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-white transition-all duration-500"
            style={{ width: `${(punchCount / punchesNeeded) * 100}%` }}
          />
        </div>

        {/* Bottom info */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">
              {remaining > 0 ? `${remaining} more to go` : "Reward ready!"}
            </p>
            <p className="mt-0.5 text-xs text-white/60">
              {punchesNeeded} punches → 🎁 {config.reward_text}
            </p>
          </div>
          {freeRewardReady && onRedeem && (
            <button
              onClick={() => onRedeem(card.id)}
              disabled={redeeming}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition-all active:scale-95 disabled:opacity-50"
            >
              {redeeming ? "Redeeming..." : "Claim Reward"}
            </button>
          )}
          {freeRewardReady && !onRedeem && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-medium text-white">
              <CheckCircle2 className="h-4 w-4" /> Ready
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
