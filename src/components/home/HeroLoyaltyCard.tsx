// src/components/home/HeroLoyaltyCard.tsx
// Premium merchant-themed loyalty card — minimalist creative gradient
import { useMemo } from "react";
import { Flame, Star, ShoppingBag, Wifi } from "lucide-react";
import { getIllustrationSVG, type MerchantThemePreset } from "@/lib/merchant-theme-presets";
import type { MembershipCardDesign } from "@/lib/api";
import simImg from "@/img/sim.png";

interface HeroLoyaltyCardProps {
  merchantName: string;
  merchantLogo?: string | null;
  merchantCategory?: string | null;
  tier: string;
  points: number;
  freeRewards: number;
  progressPercent: number;
  streak: number;
  ordersCount: number;
  memberName: string;
  cardNumber: string;
  theme?: MerchantThemePreset | null;
  themeColor?: string;
  cardTextColor?: string;
  cardBackgroundImage?: string;
  cardDesign?: MembershipCardDesign | null;
  joined: boolean;
  onJoin?: () => void;
  joining?: boolean;
}

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

export function HeroLoyaltyCard({
  merchantName,
  merchantLogo,
  merchantCategory,
  tier,
  points,
  freeRewards,
  progressPercent,
  streak,
  ordersCount,
  memberName,
  cardNumber,
  theme,
  themeColor,
  cardTextColor,
  cardBackgroundImage,
  cardDesign,
  joined,
  onJoin,
  joining,
}: HeroLoyaltyCardProps) {
  // card_design from merchant settings takes priority over theme presets
  const primary = cardDesign?.primary_color || theme?.primary || themeColor || "#1A1A1A";
  const secondary = cardDesign?.secondary_color || theme?.secondary || themeColor || "#2C2C2C";
  const accent = cardDesign?.accent_color || theme?.accent || primary;

  // Resolve text color: card_design text_mode > merchant custom > preset > auto-detect
  const resolvedTextColor = cardDesign
    ? cardDesign.text_mode === "dark"
      ? "#1A1A1A"
      : "#FFFFFF"
    : cardTextColor || "#FFFFFF";
  const isLight = cardDesign ? cardDesign.text_mode === "dark" : isLightColor(resolvedTextColor);

  // Background image: card_design > merchant profile
  const resolvedBgImage =
    (cardDesign?.background_image && cardDesign.background_image.trim()) ||
    cardBackgroundImage ||
    null;

  // Gradient — match MembershipCardStack exactly
  const cardStyle: React.CSSProperties = useMemo(() => {
    if (resolvedBgImage) {
      return {
        background: `linear-gradient(145deg, ${hexToRGBA(primary, 0.88)} 0%, ${hexToRGBA(secondary, 0.85)} 100%), url(${resolvedBgImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: resolvedTextColor,
        boxShadow: `0 20px 50px -12px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.15)`,
      };
    }
    return {
      background: `linear-gradient(145deg, ${primary} 0%, ${secondary} 100%)`,
      color: resolvedTextColor,
      boxShadow: `0 20px 50px -12px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.15)`,
    };
  }, [primary, secondary, resolvedBgImage, resolvedTextColor]);

  const textSecondary = isLight ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";
  const textTertiary = isLight ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.3)";
  const overlayBg = isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.08)";

  const illustrationSVG = useMemo(() => {
    if (!theme?.illustration) return null;
    return getIllustrationSVG(theme.illustration);
  }, [theme?.illustration]);

  // ── Not joined state ──
  if (!joined) {
    return (
      <section className="px-5">
        <div
          className="relative overflow-hidden rounded-[20px] p-6 text-center"
          style={{ ...cardStyle, aspectRatio: "1.586 / 1" }}
        >
          {resolvedBgImage && (
            <img
              src={resolvedBgImage}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15"
            />
          )}
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

  // ── Joined state ──
  return (
    <section className="px-5">
      <div
        className="relative flex flex-col overflow-hidden rounded-[20px] p-5"
        style={{ ...cardStyle, aspectRatio: "1.586 / 1" }}
      >
        {/* Background image overlay */}
        {resolvedBgImage && (
          <img
            src={resolvedBgImage}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
          />
        )}

        {/* Illustration */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ color: resolvedTextColor }}
          dangerouslySetInnerHTML={{ __html: illustrationSVG ?? "" }}
        />

        {/* Subtle decorative orb — gradient accent */}
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-20 blur-3xl"
          style={{
            background: `radial-gradient(circle, ${accent || hexToRGBA(primary, 0.4)}, transparent)`,
          }}
        />

        {/* SIM chip — right side middle */}
        <img
          src={simImg}
          alt=""
          className="pointer-events-none absolute right-4 top-1/2 h-14 w-16 -translate-y-1/2 object-contain"
          style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" }}
        />

        {/* NFC contactless icon — left of SIM */}
        <Wifi
          className="pointer-events-none absolute right-[78px] top-1/2 h-5 w-5 -translate-y-1/2 -rotate-90"
          strokeWidth={1.8}
        />

        {/* Top row: Logo + Name + Tier */}
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
                Membership
              </p>
              <p className="mt-0.5 truncate font-display text-lg leading-tight">{merchantName}</p>
            </div>
          </div>
          <span
            className="mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.15em]"
            style={{ background: overlayBg, color: resolvedTextColor }}
          >
            {tierIcon(tier)} {tierLabel(tier)}
          </span>
        </div>

        {/* Points — large, clean */}
        <div className="relative mt-3">
          <p className="text-[8px] uppercase tracking-[0.22em]" style={{ color: textTertiary }}>
            Available Points
          </p>
          <p
            className="font-display text-[40px] leading-none tracking-tight"
            style={{ letterSpacing: "-0.03em" }}
          >
            {points.toLocaleString()}
          </p>
        </div>

        {/* Streak + Orders — compact inline */}
        <div className="relative mt-2 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3 w-3" style={{ color: accent || resolvedTextColor }} />
            <span className="text-[10px] font-medium">
              {streak} <span style={{ color: textSecondary }}>day streak</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShoppingBag className="h-3 w-3" style={{ color: accent || resolvedTextColor }} />
            <span className="text-[10px] font-medium">
              {ordersCount} <span style={{ color: textSecondary }}>orders</span>
            </span>
          </div>
        </div>

        {/* Bottom row: member + card number */}
        <div className="relative mt-auto flex items-end justify-between">
          <div>
            <p className="text-[8px] uppercase tracking-widest" style={{ color: textTertiary }}>
              Member
            </p>
            <p className="mt-0.5 text-xs font-medium">{memberName}</p>
          </div>
          <p className="font-mono text-[10px] tracking-wider" style={{ color: textSecondary }}>
            {cardNumber}
          </p>
        </div>

        {/* Powered by */}
        <p className="relative text-right text-[7px] tracking-wide" style={{ color: textTertiary }}>
          Powered by Zentro
        </p>
      </div>
    </section>
  );
}
