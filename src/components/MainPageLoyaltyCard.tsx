//C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\features\cards\components\MembershipCardDetail.tsx
import type { CSSProperties } from "react";
import {
  ArrowRight,
  Crown,
  Flame,
  Gift,
  MapPin,
  QrCode,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import type { MerchantThemePreset } from "@/lib/merchant-theme-presets";
import type { MembershipCardDesign, MembershipCard } from "@/lib/api";
import { ZentroMascot } from "@/components/brand/ZentroMascot";

function hexToRGBA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function lighten(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function nextTier(tier: string): string {
  if (tier === "bronze") return "Silver";
  if (tier === "silver") return "Gold";
  if (tier === "gold") return "Platinum";
  return "Platinum";
}

// Tier badge gradient styling
function tierBadgeStyle(tier: string): CSSProperties {
  switch (tier) {
    case "silver":
      return {
        background: "linear-gradient(135deg, #F0F0F0 0%, #D5D5D5 50%, #B0B0B0 100%)",
        color: "#2C2C2C",
      };
    case "gold":
      return {
        background: "linear-gradient(135deg, #FFE89C 0%, #FFC857 50%, #E59F00 100%)",
        color: "#3A2600",
      };
    case "platinum":
      return {
        background: "linear-gradient(135deg, #FFFFFF 0%, #E2E8F0 50%, #94A3B8 100%)",
        color: "#1E293B",
      };
    default: // bronze
      return {
        background: "linear-gradient(135deg, #F3D2B5 0%, #E6AD7A 50%, #C87D46 100%)",
        color: "#4A2306",
      };
  }
}

export interface LoyaltyCardProps {
  card?: MembershipCard | null;
  merchantName?: string;
  merchantLogo?: string | null;
  merchantCategory?: string | null;
  tier?: string;
  points?: number;
  streak?: number;
  ordersCount?: number;
  rewardsCount?: number;
  progressPercent?: number;
  pointsToNextTier?: number;
  memberName?: string;
  cardNumber?: string;
  joinedAt?: string | null;
  theme?: MerchantThemePreset | null;
  themeColor?: string;
  cardDesign?: MembershipCardDesign | null;
  joined?: boolean;
  onJoin?: () => void;
  joining?: boolean;
  compact?: boolean;
  onQrTap?: () => void;
  isActive?: boolean;
  variant?: "merchant" | "zentro";
}

export function MainPageLoyaltyCardSkeleton() {
  return (
    <div className="relative min-h-[360px] animate-pulse overflow-hidden rounded-[36px] bg-[#EEEAF8] dark:bg-white/[0.06]">
      <div className="absolute inset-0 p-6">
        <div className="h-12 w-44 rounded-2xl bg-black/[0.06] dark:bg-white/[0.07]" />
        <div className="mt-12 h-4 w-24 rounded-lg bg-black/[0.06] dark:bg-white/[0.07]" />
        <div className="mt-3 h-16 w-40 rounded-2xl bg-black/[0.06] dark:bg-white/[0.07]" />
        <div className="mt-8 h-24 rounded-[28px] bg-black/[0.06] dark:bg-white/[0.07]" />
      </div>
    </div>
  );
}

export function MainPageLoyaltyCard({
  card,
  merchantName: merchantNameProp,
  merchantLogo: merchantLogoProp,
  merchantCategory,
  tier: tierProp,
  points: pointsProp,
  streak: streakProp,
  ordersCount,
  rewardsCount = 0,
  progressPercent = 0,
  pointsToNextTier = 0,
  memberName: memberNameProp,
  cardNumber: cardNumberProp,
  joinedAt: joinedAtProp,
  theme,
  themeColor,
  cardDesign: cardDesignProp,
  joined = true,
  onJoin,
  joining,
  compact,
  onQrTap,
  variant = "merchant",
}: LoyaltyCardProps) {
  const merchantName = card?.merchant?.name || merchantNameProp || "Chiya Cafe";
  const merchantLogo = card?.merchant?.logo ?? merchantLogoProp ?? null;
  const tier = card?.wallet?.tier ?? tierProp ?? "bronze";
  const points = card?.wallet?.points_balance ?? pointsProp ?? 60;
  const streak = card?.wallet?.streak_days ?? streakProp ?? 2;
  const memberName = memberNameProp || "Utsav Shrestha";
  const cardNumber = cardNumberProp || "•••• VAD6Y9";
  const joinedAt = joinedAtProp ?? card?.membership?.joined_at ?? null;
  const cardDesign = cardDesignProp ?? card?.card_design ?? null;

  const safeProgress = Math.max(0, Math.min(100, progressPercent > 0 ? progressPercent : 45));

  // ── Theme color resolution (priority: cardDesign > theme > themeColor > fallback) ──
  const primary = cardDesign?.primary_color || theme?.primary || themeColor || "#6E57FF";
  const secondary = cardDesign?.secondary_color || theme?.secondary || lighten(primary, 0.18);
  const accent = cardDesign?.accent_color || theme?.accent || lighten(primary, 0.32);
  const textDark = cardDesign ? cardDesign.text_mode === "dark" : isLightColor(primary);

  const cardBg = `linear-gradient(155deg, ${lighten(primary, 0.62)} 0%, ${lighten(primary, 0.52)} 40%, ${lighten(primary, 0.44)} 70%, ${lighten(primary, 0.56)} 100%)`;
  const cardText = textDark ? "#18102B" : "#FFFFFF";
  const cardTextMuted = textDark ? "#66568A" : "rgba(255,255,255,.7)";
  const cardLabelColor = textDark ? primary : "rgba(255,255,255,.6)";

  // Compact card view
  if (compact) {
    return (
      <div className="flex items-center gap-3 px-5 py-3.5" style={{ color: "#FFFFFF" }}>
        {merchantLogo ? (
          <img src={merchantLogo} alt="" className="h-8 w-8 rounded-xl object-cover" />
        ) : (
          <ZentroMascot className="h-9 w-9" waving={false} celebrate={false} />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold tracking-[-0.02em]">{merchantName}</p>
          <p className="text-[10px] text-white/70">{points.toLocaleString()} points</p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em]"
          style={{
            background: "rgba(255,255,255,.17)",
            border: "1px solid rgba(255,255,255,.2)",
          }}
        >
          {tierLabel(tier)}
        </span>
      </div>
    );
  }

  // Not-joined state
  if (!joined) {
    return (
      <div className="relative pt-24">
        <div className="pointer-events-none absolute right-2 top-0 z-20 animate-mascot-bounce">
          <ZentroMascot className="h-32 w-32 drop-shadow-2xl" waving />
        </div>
        <div
          className="relative min-h-[360px] overflow-hidden rounded-[38px] p-8"
          style={{
            background: `linear-gradient(150deg, ${lighten(primary, 0.28)} 0%, ${lighten(primary, 0.1)} 45%, ${primary} 100%)`,
            color: textDark ? "#1A1A1A" : "#FFFFFF",
            boxShadow: "0 24px 48px rgba(0,0,0,.08)",
          }}
        >
          <div className="relative flex h-full min-h-[296px] flex-col">
            {/* Membership pill badge */}
            <div
              className="inline-flex items-center gap-1.5 self-start rounded-full px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.22em]"
              style={{
                background: textDark ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.16)",
                border: `1px solid ${textDark ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.26)"}`,
                backdropFilter: "blur(6px)",
              }}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Membership
            </div>

            <h2 className="mt-4 text-[30px] font-black leading-tight tracking-[-0.04em]">
              {merchantName}
            </h2>

            {/* Divider accent */}
            <div
              className="mt-5 h-px w-16"
              style={{ background: textDark ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.35)" }}
            />

            <p
              className="mt-5 max-w-[250px] text-[14px] leading-relaxed"
              style={{ color: textDark ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.8)" }}
            >
              Join free to earn points, collect rewards and make every visit count.
            </p>

            {/* Button pinned to bottom with generous spacing */}
            <div className="mt-auto pt-10">
              <button
                type="button"
                onClick={onJoin}
                disabled={joining}
                className="inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-[14px] font-bold transition-all duration-200 hover:-translate-y-0.5 active:scale-95 disabled:opacity-60"
                style={{
                  color: primary,
                  background: "linear-gradient(135deg, #FFFFFF 0%, #F2EEFF 100%)",
                  boxShadow: `0 16px 40px ${hexToRGBA("#000000", 0.22)}`,
                }}
              >
                {joining ? "Joining…" : "Join & start earning"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Hero Loyalty Card (Clean Minimalist Soft Palette)
  return (
    <div className="relative pt-24 animate-loyalty-float">
      {/* ── 3D Mascot positioned cleanly at top-0 right-4 with full 96px top clearance ── */}
      <div className="pointer-events-none absolute right-4 top-0 z-30 animate-mascot-bounce">
        <ZentroMascot className="h-[144px] w-[144px] filter drop-shadow-lg" waving celebrate />
      </div>

      {/* ── Sculpted Organic Card Container ── */}
      <div
        className="relative overflow-hidden"
        style={{
          borderRadius: "38px",
          background: cardBg,
        }}
      >
        {/* Left Semi-circular Ticket Cutouts */}
        <div className="pointer-events-none absolute -left-3.5 top-[22%] z-20 h-7 w-7 rounded-full bg-[#FAF8F4] dark:bg-[#0F0F0F]" />
        <div className="pointer-events-none absolute -left-3.5 top-[68%] z-20 h-7 w-7 rounded-full bg-[#FAF8F4] dark:bg-[#0F0F0F]" />

        {/* Ticket Dashed Divider Line */}
        <div className="pointer-events-none absolute bottom-24 left-6 top-16 z-10 w-0 border-r-2 border-dashed" style={{ borderColor: hexToRGBA(primary, 0.12) }} />

        {/* Inner Card Section */}
        <div className="relative min-h-[340px] px-6 pb-0 pt-6">
          {/* Translucent Layer Blobs */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-100" aria-hidden viewBox="0 0 400 350">
            <path d="M -10,-10 C 100,35 220,-10 380,25 C 420,35 440,-10 440,-10 Z" fill="#FFFFFF" opacity="0.25" />
            <path d="M -20,50 C 100,80 150,150 90,230 C 30,310 -30,250 -20,50 Z" fill={primary} opacity="0.08" />
            <path d="M 150,70 C 270,20 370,110 330,210 C 290,310 170,250 150,70 Z" fill="#FFFFFF" opacity="0.20" />
            <circle cx="330" cy="40" r="110" fill="#FFFFFF" opacity="0.30" style={{ filter: "blur(30px)" }} />
          </svg>

          {/* Faded Botanical Leaf Illustration Branch */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.06] mix-blend-soft-light filter blur-[0.3px]">
            <svg viewBox="0 0 200 240" className="h-52 w-52">
              <path d="M 100 20 C 95 80, 105 140, 100 220" fill="none" stroke={primary} strokeWidth="2.5" />
              <path d="M 100 50 Q 140 30, 145 20 C 130 50, 110 55, 100 50" fill={primary} />
              <path d="M 100 90 Q 145 70, 150 60 C 135 90, 110 95, 100 90" fill={primary} />
              <path d="M 100 130 Q 140 110, 145 100 C 130 130, 110 135, 100 130" fill={primary} />
              <path d="M 100 170 Q 135 150, 140 140 C 125 170, 108 175, 100 170" fill={primary} />
              <path d="M 100 70 Q 60 50, 55 40 C 70 70, 90 75, 100 70" fill={primary} />
              <path d="M 100 110 Q 55 90, 50 80 C 65 110, 90 115, 100 110" fill={primary} />
              <path d="M 100 150 Q 60 130, 55 120 C 70 150, 90 155, 100 150" fill={primary} />
            </svg>
          </div>

          {/* ── Card Content Layout ── */}
          <div className="relative z-10 flex h-full flex-col">
            {/* Top Row: BRONZE Tier Badge Pill + QR Code Button */}
            <div className="flex items-start justify-between gap-3 pl-4">
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.15em] shadow-sm"
                style={{
                  ...tierBadgeStyle(tier),
                  boxShadow: `0 4px 14px rgba(0,0,0,.08)`,
                }}
              >
                <Crown className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">{tierLabel(tier)}</span>
              </span>

              {onQrTap && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onQrTap();
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full backdrop-blur-md transition active:scale-95"
                  style={{ background: hexToRGBA(textDark ? "#000000" : "#FFFFFF", 0.4) }}
                  aria-label="Show membership QR"
                >
                  <QrCode className="h-4.5 w-4.5" style={{ color: primary }} />
                </button>
              )}
            </div>

            {/* Middle Row: Store Details vs Points */}
            <div className="mt-4 grid grid-cols-[1fr_auto] items-start gap-3 pl-4">
              {/* Left Column: Store Info & Elevated Logo */}
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.22em]" style={{ color: primary }}>
                  {cardDesign?.card_title || "MEMBERSHIP"}
                </p>
                <h2 className="mt-1 truncate text-[28px] font-black tracking-[-0.04em]" style={{ color: cardText }}>
                  {merchantName}
                </h2>
                <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] font-bold" style={{ color: cardTextMuted }}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: primary }} />
                  {merchantCategory || "Lazimpat, Kathmandu"}
                </p>

                {/* Floating Brand Logo Circle (76px Elevated White Circle) */}
                <div
                  className="mt-4 flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full bg-white p-2"
                  style={{
                    boxShadow: `0 14px 32px ${hexToRGBA(primary, 0.16)}, 0 4px 10px rgba(0,0,0,.06)`,
                  }}
                >
                  {merchantLogo ? (
                    <img src={merchantLogo} alt="" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#FAF8F5] text-center">
                      <svg viewBox="0 0 32 32" className="h-5 w-5 text-[#10B981]">
                        <path d="M16 4 C10 8 6 14 6 22 C14 22 20 18 26 12 C26 7 21 4 16 4 Z" fill="currentColor" opacity="0.85" />
                        <path d="M16 4 L16 22" stroke="#FFFFFF" strokeWidth="1.5" />
                      </svg>
                      <span className="mt-0.5 text-[9px] font-black uppercase tracking-wider text-[#18102B]">CHIYA</span>
                      <span className="text-[7.5px] font-bold text-[#7D7D9C]">CAFE</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Points & Next Tier Capsule */}
              <div className="shrink-0 text-right pr-1">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.16em]" style={{ color: cardTextMuted }}>
                  {cardDesign?.points_label || "Your Points"}
                </p>
                <div className="mt-0.5 flex items-baseline justify-end gap-1">
                  <p className="text-[62px] font-black leading-none tracking-[-0.075em]" style={{ color: primary }}>
                    {points.toLocaleString()}
                  </p>
                  <span className="text-[22px] font-extrabold" style={{ color: cardTextMuted }}>pts</span>
                </div>

                {/* Next Tier Capsule Badge */}
                <div
                  className="mt-2 inline-flex h-[46px] items-center justify-center gap-2 rounded-full px-5 text-[13px] font-black text-white"
                  style={{
                    background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
                    boxShadow: `0 12px 26px ${hexToRGBA(primary, 0.3)}`,
                  }}
                >
                  <Sparkles className="h-4 w-4 text-[#FFD700]" />
                  <span className="whitespace-nowrap">
                    {pointsToNextTier > 0 ? pointsToNextTier : 1440} pts to {nextTier(tier)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Progress Bar ── */}
            <div className="mt-5 px-1">
              <div
                className="h-[14px] w-full overflow-hidden rounded-full"
                style={{
                  background: textDark ? "#F0EDE8" : "#FFFFFF",
                  border: `1px solid ${textDark ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.5)"}`,
                  boxShadow: "inset 0 1px 3px rgba(0,0,0,.08)",
                }}
              >
                <div
                  className="animate-progress-fill relative h-full rounded-full"
                  style={{
                    width: `${safeProgress}%`,
                    background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`,
                    boxShadow: `0 4px 14px ${hexToRGBA(primary, 0.4)}`,
                  }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-[50%] rounded-full"
                    style={{ background: "linear-gradient(180deg, rgba(255,255,255,.6) 0%, transparent 100%)" }}
                  />
                </div>
              </div>
            </div>

            {/* Spacing before stats panel */}
            <div className="h-7" />
          </div>
        </div>

        {/* ── Bottom Statistics Panel (Integrated Organic White Capsule Shape) ── */}
        <div
          className="relative z-10 -mt-7 grid h-[94px] grid-cols-3 items-center px-2"
          style={{
            background: textDark ? "#FFFFFF" : "rgba(255,255,255,0.95)",
            borderTopLeftRadius: "34px",
            borderTopRightRadius: "34px",
            borderBottomLeftRadius: "36px",
            borderBottomRightRadius: "36px",
            boxShadow: `0 24px 60px ${hexToRGBA(primary, 0.12)}, 0 -4px 20px ${textDark ? "rgba(255,255,255,.8)" : "rgba(255,255,255,.4)"}`,
          }}
        >
          {/* Section 1: Day Streak */}
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#FFE2C7] shadow-sm">
              <Flame className="h-5 w-5 text-[#FF7A00]" />
            </span>
            <span className="text-[20px] font-black leading-none text-[#18102B]">{streak}</span>
            <span className="text-[10px] font-semibold text-[#7D7D9C]">Day streak</span>
          </div>

          {/* Section 2: Rewards */}
          <div className="flex flex-col items-center justify-center gap-1 border-x text-center" style={{ borderColor: hexToRGBA(primary, 0.1) }}>
            <span className="grid h-10 w-10 place-items-center rounded-full shadow-sm" style={{ background: hexToRGBA(primary, 0.1) }}>
              <Gift className="h-5 w-5" style={{ color: primary }} />
            </span>
            <span className="text-[20px] font-black leading-none text-[#18102B]">{rewardsCount}</span>
            <span className="text-[10px] font-semibold text-[#7D7D9C]">Rewards</span>
          </div>

          {/* Section 3: Orders */}
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[#DFF7EC] shadow-sm">
              <ShoppingBag className="h-5 w-5 text-[#10B981]" />
            </span>
            <span className="text-[20px] font-black leading-none text-[#18102B]">{ordersCount ?? 6}</span>
            <span className="text-[10px] font-semibold text-[#7D7D9C]">Orders</span>
          </div>
        </div>
      </div>
    </div>
  );
}