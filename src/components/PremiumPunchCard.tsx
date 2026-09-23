import { Gift, Sparkles, Ticket } from "lucide-react";
import type { CustomerPunchCard } from "@/lib/api";

interface PremiumPunchCardProps {
  card: CustomerPunchCard;
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
}

function withAlpha(color: string | undefined, alpha: number): string {
  if (!color?.startsWith("#") || color.length < 7) {
    return `rgba(15, 61, 58, ${alpha})`;
  }

  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function PremiumPunchCard({
  card,
  onRedeem,
  redeeming,
}: PremiumPunchCardProps) {
  const config = card.punch_card;
  if (!config) return null;

  const punchesNeeded = config.stamps_required;
  const punchCount = card.current_stamps;
  const freeRewardReady = card.is_completed && !card.is_redeemed;
  const remaining = Math.max(punchesNeeded - punchCount, 0);
  const accent = config.color_scheme || "#0F3D3A";
  const progress = Math.min(100, (punchCount / Math.max(punchesNeeded, 1)) * 100);

  return (
    <article
      className="relative overflow-hidden rounded-[30px] border border-black/[0.04] bg-card p-5 dark:border-white/[0.07]"
      style={{
        backgroundImage: config.animated_gif_background || config.background_image
          ? `linear-gradient(120deg, rgba(255,255,255,0.93), rgba(255,255,255,0.78)), url(${config.animated_gif_background || config.background_image})`
          : `linear-gradient(135deg, ${withAlpha(accent, 0.14)} 0%, rgba(255,255,255,0.96) 58%, ${withAlpha("#B7FF8A", 0.22)} 100%)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        boxShadow: "0 22px 55px -38px rgba(31, 26, 54, 0.55)",
      }}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-3xl"
        style={{ background: withAlpha(accent, 0.22) }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#484153] backdrop-blur-xl">
            <Ticket className="h-3 w-3" />
            Reward card
          </div>
          <h3 className="mt-3 text-[20px] font-semibold leading-tight tracking-[-0.04em] text-[#18151F]">
            {freeRewardReady ? "Your reward is ready" : `Only ${remaining} more to go`}
          </h3>
          <p className="mt-1 max-w-[235px] text-[11px] leading-relaxed text-[#6F6876]">
            {config.reward_text}
          </p>
        </div>

        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-lg"
          style={{ background: accent }}
        >
          {freeRewardReady ? (
            <Gift className="h-5 w-5" />
          ) : (
            <Sparkles className="h-5 w-5" />
          )}
        </div>
      </div>

      <div className="relative mt-5 overflow-x-auto pb-1">
        <div className="flex min-w-max items-center gap-2">
          {Array.from({ length: punchesNeeded }).map((_, index) => {
            const filled = index < punchCount || freeRewardReady;
            const finalReward = freeRewardReady && index === punchesNeeded - 1;

            return (
              <div
                key={index}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[12px] font-bold transition-all duration-300"
                style={{
                  background: filled ? accent : "rgba(255,255,255,0.68)",
                  borderColor: filled ? withAlpha(accent, 0.12) : "rgba(30,24,42,0.08)",
                  color: filled ? "#FFFFFF" : "#8A8390",
                  boxShadow: filled ? `0 8px 18px -10px ${withAlpha(accent, 0.9)}` : undefined,
                }}
              >
                {finalReward ? (
                  <Gift className="h-4 w-4" />
                ) : filled && config.stamp_gif_url ? (
                  <img
                    src={config.stamp_gif_url}
                    alt=""
                    className="h-6 w-6 rounded-full object-cover"
                  />
                ) : filled ? (
                  <span>{config.stamp_icon || "✦"}</span>
                ) : (
                  index + 1
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.07]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${progress}%`, background: accent }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-[#77707D]">
          <span>{punchCount} collected</span>
          <span>{punchesNeeded} needed</span>
        </div>
      </div>

      {freeRewardReady && onRedeem && (
        <button
          type="button"
          onClick={() => onRedeem(card.id)}
          disabled={redeeming}
          className="relative mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[12px] font-bold text-white transition hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
          style={{ background: accent }}
        >
          <Gift className="h-4 w-4" />
          {redeeming ? "Preparing reward…" : "Claim reward"}
        </button>
      )}
    </article>
  );
}
