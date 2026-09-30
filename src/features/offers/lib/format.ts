import type { OfferClaim, PublicOffer } from "@/lib/api/offers";

const DAY = 86_400_000;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
}

export function formatDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${formatDate(iso)} · ${time}`;
}

/** Short expiry for cards: "Ends today", "Ends in 3 days", "Ends Sep 30". */
export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return "No end date";
  const days = daysUntil(iso);
  if (days <= 0) return "Expired";
  if (days === 1) return "Ends today";
  if (days <= 7) return `Ends in ${days} days`;
  return `Ends ${formatDate(iso, false)}`;
}

export function isEndingSoon(iso: string | null | undefined, withinDays = 3): boolean {
  if (!iso) return false;
  const days = daysUntil(iso);
  return days > 0 && days <= withinDays;
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km === null || km === undefined) return null;
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/**
 * Card/ticket copy: the merchant's own description when there is one, else the
 * benefit sentence. The raw benefit sentence is never used as the headline.
 */
export function offerDescription(offer: { description?: string; summary: string }): string {
  return offer.description?.trim() || sentence(offer.summary);
}

const KIND_FALLBACK: Record<PublicOffer["benefit_kind"], string> = {
  percent_off: "DISCOUNT",
  amount_off: "DISCOUNT",
  free_item: "FREE ITEM",
  buy_x_get_y: "BUY & GET",
};

export function offerBadge(offer: { badge?: string; benefit_kind: PublicOffer["benefit_kind"] }) {
  return offer.badge || KIND_FALLBACK[offer.benefit_kind];
}

export function offerPlace(merchant: PublicOffer["merchant"]): string {
  return [merchant.area, merchant.city].filter(Boolean).join(", ");
}

export type ClaimTone = "ready" | "reserved" | "expiring" | "used" | "expired" | "withdrawn";

/** Customer-facing voucher state; never exposes raw backend enums. */
export function claimState(claim: OfferClaim): { tone: ClaimTone; label: string } {
  if (claim.tab === "used") return { tone: "used", label: "Used" };
  if (claim.status === "revoked") return { tone: "withdrawn", label: "Withdrawn by the store" };
  if (claim.tab === "expired") return { tone: "expired", label: "Expired" };
  if (claim.status === "reserved") return { tone: "reserved", label: "Applied to an order" };
  if (isEndingSoon(claim.expires_at, 7)) return { tone: "expiring", label: "Expiring soon" };
  return { tone: "ready", label: "Ready to use" };
}

export const TONE_DOT: Record<ClaimTone, string> = {
  ready: "bg-success",
  reserved: "bg-info",
  expiring: "bg-warning",
  used: "bg-muted-foreground",
  expired: "bg-muted-foreground",
  withdrawn: "bg-danger",
};
