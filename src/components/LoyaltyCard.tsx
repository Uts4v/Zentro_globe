// src/components/LoyaltyCard.tsx
// Single shared loyalty card — used on homepage + membership cards page
import { useMemo } from "react";
import { Flame, ShoppingBag, Wifi, QrCode } from "lucide-react";
import { getIllustrationSVG, type MerchantThemePreset } from "@/lib/merchant-theme-presets";
import type { MembershipCardDesign } from "@/lib/api";
import type { MembershipCard } from "@/lib/api";
import simImg from "@/img/sim.png";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function tierLabel(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function tierIcon(tier: string): string {
  switch (tier) {
    case "platinum":
      return "✦";
    case "gold":
      return "★";
    case "silver":
      return "◆";
    default:
      return "●";
  }
}

function hexToRGBA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isLightColor(hex: string): boolean {
  if (!hex || !hex.startsWith("#")) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

function tierBadgeBg(tier: string, isDark: boolean) {
  if (isDark) {
    switch (tier) {
      case "platinum":
        return "rgba(255,255,255,0.18)";
      case "gold":
        return "rgba(217,169,78,0.25)";
      case "silver":
        return "rgba(255,255,255,0.12)";
      default:
        return "rgba(255,255,255,0.08)";
    }
  }
  switch (tier) {
    case "platinum":
      return "rgba(255,255,255,0.22)";
    case "gold":
      return "rgba(180,130,40,0.18)";
    case "silver":
      return "rgba(255,255,255,0.15)";
    default:
      return "rgba(255,255,255,0.10)";
  }
}

/* ── Props ──────────────────────────────────────────────────────────────── */

export interface LoyaltyCardProps {
  /** MembershipCard from API (cards page) — drives everything */
  card?: MembershipCard | null;
  /** Flat props override (homepage) — used when card object isn't available */
  merchantName?: string;
  merchantLogo?: string | null;
  merchantCategory?: string | null;
  tier?: string;
  points?: number;
  streak?: number;
  ordersCount?: number;
  memberName?: string;
  cardNumber?: string;
  joinedAt?: string | null;
  /** Theme preset from business type */
  theme?: MerchantThemePreset | null;
  /** Fallback theme color from store settings */
  themeColor?: string;
  /** Card design from merchant settings */
  cardDesign?: MembershipCardDesign | null;
  /** Joined state (homepage only) */
  joined?: boolean;
  onJoin?: () => void;
  joining?: boolean;
  /** Cards page: compact stack row */
  compact?: boolean;
  /** Cards page: QR tap */
  onQrTap?: () => void;
  /** Cards page: active state styling */
  isActive?: boolean;
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

export function LoyaltyCardSkeleton() {
  return (
    <div
      className="relative animate-pulse overflow-hidden rounded-[20px] bg-muted"
      style={{ aspectRatio: "1.586 / 1" }}
    >
      <div className="absolute inset-0 p-5">
        <div className="h-9 w-24 rounded-lg bg-muted-foreground/10" />
        <div className="mt-8 h-4 w-20 rounded bg-muted-foreground/10" />
        <div className="mt-2 h-10 w-32 rounded bg-muted-foreground/10" />
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────────────────────── */

export function LoyaltyCard({
  card,
  merchantName: merchantNameProp,
  merchantLogo: merchantLogoProp,
  merchantCategory,
  tier: tierProp,
  points: pointsProp,
  streak: streakProp,
  ordersCount,
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
  isActive,
}: LoyaltyCardProps) {
  // Extract from card object if available, else use flat props
  const merchantName = card?.merchant?.name || merchantNameProp || "Zentro";
  const merchantLogo = card?.merchant?.logo ?? merchantLogoProp ?? null;
  const tier = card?.wallet?.tier ?? tierProp ?? "bronze";
  const points = card?.wallet?.points_balance ?? pointsProp ?? 0;
  const streak = card?.wallet?.streak_days ?? streakProp ?? 0;
  const memberName = memberNameProp || "Member";
  const cardNumber = cardNumberProp || "•••• 0000";
  const joinedAt = joinedAtProp ?? card?.membership?.joined_at ?? null;
  const transferEnabled = card?.transfer_enabled ?? false;
  const designFromCard = card?.card_design ?? null;
  const cardDesign = cardDesignProp ?? designFromCard;

  // Resolve colors from card_design > theme > fallback
  const primary = cardDesign?.primary_color || theme?.primary || themeColor || "#1A1A1A";
  const secondary = cardDesign?.secondary_color || theme?.secondary || themeColor || "#2C2C2C";
  const accent = cardDesign?.accent_color || theme?.accent || primary;
  const isLight = cardDesign ? cardDesign.text_mode === "dark" : isLightColor(primary);
  const resolvedTextColor = isLight ? "#1A1A1A" : "#FFFFFF";

  // Background image + overlay toggle
  const resolvedBgImage =
    (cardDesign?.background_image && cardDesign.background_image.trim()) || null;
  const showOverlay = cardDesign?.show_color_overlay !== false;

  // Card background style — single source of truth
  const cardStyle: React.CSSProperties = useMemo(() => {
    if (resolvedBgImage) {
      if (showOverlay) {
        return {
          background: `linear-gradient(145deg, ${hexToRGBA(primary, 0.88)} 0%, ${hexToRGBA(secondary, 0.85)} 100%), url(${resolvedBgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          color: resolvedTextColor,
        };
      }
      return {
        background: `url(${resolvedBgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: resolvedTextColor,
      };
    }
    return {
      background: `linear-gradient(145deg, ${primary} 0%, ${secondary} 100%)`,
      color: resolvedTextColor,
    };
  }, [primary, secondary, resolvedBgImage, resolvedTextColor, showOverlay]);

  const textSecondary = isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
  const textTertiary = isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)";
  const overlayBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";

  const illustrationSVG = useMemo(() => {
    if (!theme?.illustration) return null;
    return getIllustrationSVG(theme.illustration);
  }, [theme?.illustration]);

  const cardTitle = cardDesign?.card_title || "Membership";

  /* ── Compact row (stack peek) ── */
  if (compact) {
    return (
      <div className="flex items-center gap-3 px-5 py-3.5" style={{ color: resolvedTextColor }}>
        {merchantLogo ? (
          <img src={merchantLogo} alt="" className="h-7 w-7 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-7 w-7 shrink-0 rounded-lg" style={{ background: overlayBg }} />
        )}
        <p className="min-w-0 flex-1 truncate font-display text-[17px]">{merchantName}</p>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest"
          style={{ background: tierBadgeBg(tier, isLight), color: resolvedTextColor }}
        >
          {tierLabel(tier)}
        </span>
      </div>
    );
  }

  /* ── Not joined state (homepage) ── */
  if (!joined) {
    return (
      <section className="px-5">
        <div
          className="relative overflow-hidden rounded-[20px] p-6 text-center"
          style={{ ...cardStyle, aspectRatio: "1.586 / 1" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            style={{ color: resolvedTextColor }}
            dangerouslySetInnerHTML={{ __html: illustrationSVG ?? "" }}
          />
          <div className="relative">
            {merchantLogo && (
              <img
                src={merchantLogo}
                alt=""
                className="mx-auto h-12 w-12 rounded-2xl object-cover mb-3"
              />
            )}
            <p className="font-display text-2xl">{merchantName}</p>
            {merchantCategory && (
              <p className="mt-1 text-xs" style={{ color: textSecondary }}>
                {merchantCategory}
              </p>
            )}
            <p className="mt-4 text-sm" style={{ color: textSecondary }}>
              Join this store to earn points, track orders, and redeem rewards.
            </p>
            <button
              onClick={onJoin}
              disabled={joining}
              className="mt-5 inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-60"
              style={{
                background: isLight ? primary : "#FFFFFF",
                color: isLight ? "#FFFFFF" : primary,
              }}
            >
              {joining ? "Joining…" : "Join & Start Earning"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ── Full card (joined) ── */
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-5"
      style={{ ...cardStyle, aspectRatio: isActive === undefined ? "1.586 / 1" : undefined }}
    >
      {/* Illustration */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ color: resolvedTextColor }}
        dangerouslySetInnerHTML={{ __html: illustrationSVG ?? "" }}
      />

      {/* Decorative orb */}
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-20 blur-3xl"
        style={{
          background: `radial-gradient(circle, ${accent || hexToRGBA(primary, 0.4)}, transparent)`,
        }}
      />

      {/* SIM chip */}
      <img
        src={simImg}
        alt=""
        className="pointer-events-none absolute right-4 top-1/2 h-14 w-16 -translate-y-1/2 object-contain"
        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }}
      />

      {/* NFC */}
      <Wifi
        className="pointer-events-none absolute right-[78px] top-1/2 h-5 w-5 -translate-y-1/2 -rotate-90"
        strokeWidth={1.8}
        style={{ color: resolvedTextColor, opacity: 0.5 }}
      />

      {/* Top row */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {merchantLogo ? (
            <img
              src={merchantLogo}
              alt=""
              className="h-9 w-9 shrink-0 rounded-xl object-cover"
              style={{ background: overlayBg }}
            />
          ) : (
            <div className="h-9 w-9 shrink-0 rounded-xl" style={{ background: overlayBg }} />
          )}
          <div className="min-w-0">
            <p className="text-[8px] uppercase tracking-[0.22em]" style={{ color: textTertiary }}>
              {cardTitle}
            </p>
            <p className="mt-0.5 truncate font-display text-lg leading-tight">{merchantName}</p>
          </div>
        </div>
        <span
          className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[8px] font-semibold uppercase tracking-widest"
          style={{ background: tierBadgeBg(tier, isLight), color: resolvedTextColor }}
        >
          {tierIcon(tier)} {tierLabel(tier)}
        </span>
      </div>

      {/* Points */}
      <div className="relative mt-3">
        <p className="text-[8px] uppercase tracking-[0.22em]" style={{ color: textTertiary }}>
          {cardDesign?.points_label || "Available Points"}
        </p>
        <p
          className="font-display text-[40px] leading-none tracking-tight"
          style={{ letterSpacing: "-0.03em" }}
        >
          {points.toLocaleString()}
        </p>
      </div>

      {/* Streak + Orders / Transfer */}
      <div className="relative mt-2 flex items-center gap-3 pl-px">
        {streak > 0 && (
          <div className="flex items-center gap-1.5">
            <Flame className="h-3 w-3" style={{ color: resolvedTextColor, opacity: 0.7 }} />
            <span className="text-[10px] font-medium">
              {streak} <span style={{ color: textSecondary }}>day streak</span>
            </span>
          </div>
        )}
        {ordersCount !== undefined && ordersCount > 0 && (
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3 w-3" style={{ color: resolvedTextColor, opacity: 0.7 }} />
            <span className="text-[10px] font-medium">
              {ordersCount} <span style={{ color: textSecondary }}>orders</span>
            </span>
          </div>
        )}
        {transferEnabled && (
          <div className="flex items-center gap-1.5">
            <Wifi className="h-3 w-3" style={{ color: resolvedTextColor, opacity: 0.5 }} />
            <span className="text-[10px] font-medium opacity-60">Transfer</span>
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="relative mt-auto flex items-end justify-between">
        <div>
          <p className="text-[8px] uppercase tracking-widest" style={{ color: textTertiary }}>
            {cardDesign?.membership_label || "Member"}
          </p>
          <p
            className="mt-0.5 font-mono text-[10px] tracking-wider"
            style={{ color: textSecondary }}
          >
            {cardNumber}
          </p>
          {cardDesign?.show_joined_date && joinedAt && (
            <p className="mt-0.5 text-[10px]" style={{ color: textSecondary }}>
              Joined{" "}
              {new Date(joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </p>
          )}
        </div>
        {onQrTap && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQrTap();
            }}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-medium uppercase tracking-wider active:scale-95 transition-transform"
            style={{ background: overlayBg }}
          >
            <QrCode className="h-3 w-3" /> QR
          </button>
        )}
      </div>

      {/* Powered by */}
      <p
        className="relative mt-2 text-right text-[7px] tracking-wide"
        style={{ color: textTertiary }}
      >
        Powered by Zentro
      </p>
    </div>
  );
}
