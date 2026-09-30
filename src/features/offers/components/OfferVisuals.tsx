import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ClaimTone } from "../lib/format";
import { TONE_DOT } from "../lib/format";
import { categoryIcon } from "../lib/categories";

/**
 * One badge style for every offer type. `muted` for used / expired vouchers;
 * `paper` on the voucher ticket, which stays light in dark mode.
 */
export function OfferBadge({
  label,
  muted = false,
  paper = false,
  className,
}: {
  label: string;
  muted?: boolean;
  paper?: boolean;
  className?: string;
}) {
  const tone = muted
    ? paper
      ? "bg-black/[0.06] text-[#5f625f]"
      : "bg-muted text-muted-foreground"
    : paper
      ? "bg-[#f3d98b]/70 text-[#6b4f0e] ring-1 ring-[#d7b04a]/40 ring-inset"
      : "bg-gold-soft/70 text-[#6b4f0e] ring-1 ring-gold/40 ring-inset dark:bg-gold-soft dark:text-gold";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase leading-none tracking-[0.08em]",
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}

/** Small pill for card states: "In wallet", "Ending soon". */
export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "teal" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
        tone === "teal" && "bg-primary/10 text-primary",
        tone === "warning" && "bg-warning/12 text-warning",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Coloured dot + label; the label keeps state readable without colour. */
export function StateLabel({
  tone,
  label,
  className,
}: {
  tone: ClaimTone;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", className)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "Z"
  );
}

/** Merchant logo, or their initials on deep teal when there is none / it fails. */
export function MerchantMark({
  name,
  logoUrl,
  size = 36,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showLogo = Boolean(logoUrl) && failed !== logoUrl;
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-primary-foreground",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {showLogo ? (
        <img
          src={logoUrl!}
          alt=""
          loading="lazy"
          className="h-full w-full bg-card object-cover"
          onError={() => setFailed(logoUrl!)}
        />
      ) : (
        <span className="font-bold tracking-tight">{initials(name)}</span>
      )}
    </span>
  );
}

/**
 * Offer / product photo with a calm branded placeholder when the offer has no
 * image or it fails to load. Never shows a broken-image icon.
 */
export function OfferImage({
  src,
  categorySlug,
  className,
  sizes,
  eager = false,
}: {
  src?: string | null;
  categorySlug?: string | null;
  className?: string;
  sizes?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt=""
        sizes={sizes}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(src)}
        className={cn("bg-oat object-cover", className)}
      />
    );
  }
  const Icon = categoryIcon(categorySlug);
  return (
    <div
      className={cn("relative grid place-items-center overflow-hidden bg-oat", className)}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(15,61,58,0.07)_1px,transparent_0)] [background-size:14px_14px]" />
      <div className="absolute -right-8 -top-10 h-36 w-36 rounded-full bg-gold-soft/40 blur-2xl" />
      <span className="relative grid h-14 w-14 place-items-center rounded-full bg-card/80 text-primary ring-1 ring-border">
        <Icon className="h-6 w-6" strokeWidth={1.6} />
      </span>
    </div>
  );
}
