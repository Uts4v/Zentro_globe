// src/features/cards/components/MembershipCardStack.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { membershipCardApi, type MembershipCard } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { QRCodeSVG } from "qrcode.react";
import { LoyaltyCard } from "@/components/LoyaltyCard";
import { QrCode, ChevronRight, Sparkles, X } from "lucide-react";

/* ── Card peek height constants (px) ───────────────────────────────────── */

const PEEK_1 = 28;
const PEEK_2 = 22;
const STACK_GAP = 6;

/* ── QR Modal ──────────────────────────────────────────────────────────── */

function QrModal({
  merchantSlug,
  merchantName,
  onClose,
}: {
  merchantSlug: string;
  merchantName: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const transferCode = user?.customer_profile?.transfer_code;

  const overlay = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong relative w-full max-w-sm rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:bg-muted/70"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-center text-sm font-medium text-foreground">{merchantName}</p>
        <p className="mt-0.5 text-center text-xs text-muted-foreground">
          Show this to earn or redeem points
        </p>

        <div className="mt-5 flex flex-col items-center">
          {transferCode ? (
            <div className="rounded-2xl bg-white p-4">
              <QRCodeSVG
                value={`zentro-transfer:${transferCode}`}
                size={180}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-muted-foreground">No transfer code available</p>
              <button
                onClick={onClose}
                className="rounded-full bg-ember px-4 py-2 text-xs font-medium text-white active:scale-95"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Portal to <body> so this escapes MobileShell's `relative z-10` stacking
  // context, which would otherwise trap z-[100] below the fixed bottom nav.
  return typeof document === "undefined" ? null : createPortal(overlay, document.body);
}

/* ── Skeleton ──────────────────────────────────────────────────────────── */

function CardSkeletonStack() {
  return (
    <div className="relative" style={{ height: 250 }}>
      <div className="absolute left-0 right-0 top-0 h-[44px] animate-pulse rounded-t-[20px] bg-muted opacity-60" />
      <div className="absolute left-0 right-0 top-[36px] h-[44px] animate-pulse rounded-t-[20px] bg-muted opacity-40" />
      <div className="absolute inset-x-0 top-[68px] bottom-0 animate-pulse rounded-[20px] bg-muted" />
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────────────── */

export function MembershipCardStack() {
  const [cards, setCards] = useState<MembershipCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [qrModal, setQrModal] = useState<{ slug: string; name: string } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const navigate = useNavigate();

  const dragRef = useRef({ startY: 0, active: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelCooldown = useRef(false);

  useEffect(() => {
    let cancelled = false;
    membershipCardApi
      .list()
      .then((data) => {
        if (!cancelled) setCards(data);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message || "Failed to load cards");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeIdx >= cards.length) setActiveIdx(Math.max(0, cards.length - 1));
  }, [cards.length, activeIdx]);

  const goTo = useCallback(
    (idx: number) => {
      setActiveIdx(Math.max(0, Math.min(idx, cards.length - 1)));
    },
    [cards.length],
  );

  const prev = useCallback(() => goTo(activeIdx - 1), [activeIdx, goTo]);
  const next = useCallback(() => goTo(activeIdx + 1), [activeIdx, goTo]);

  const openDetail = useCallback(
    (slug: string) => {
      navigate({ to: "/cards/$merchantSlug", params: { merchantSlug: slug } });
    },
    [navigate],
  );

  const openQr = useCallback((slug: string, name: string) => {
    setQrModal({ slug, name });
  }, []);

  /* ── Touch drag ── */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, active: true };
    setDragOffset(0);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragRef.current.active) return;
    const dy = e.touches[0].clientY - dragRef.current.startY;
    setDragOffset(dy * 0.4); // dampened drag
  }, []);

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      const dy = e.changedTouches[0].clientY - dragRef.current.startY;
      setDragOffset(0);
      if (dy < -40) next();
      else if (dy > 40) prev();
    },
    [next, prev],
  );

  /* ── Mouse wheel to cycle through cards ── */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (wheelCooldown.current) return;
      const absY = Math.abs(e.deltaY);
      if (absY < 15) return;
      wheelCooldown.current = true;
      if (e.deltaY > 0) next();
      else prev();
      setTimeout(() => {
        wheelCooldown.current = false;
      }, 300);
    },
    [next, prev],
  );

  /* ── Keyboard ── */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const card = cards[activeIdx];
        if (card) openQr(card.merchant.slug, card.merchant.name);
      }
    },
    [prev, next, cards, activeIdx, openQr],
  );

  /* ── Stack layout ── */
  function stackStyle(idx: number): React.CSSProperties {
    const dist = idx - activeIdx;
    if (dist < 0) return { display: "none" };
    if (dist === 0) {
      return {
        transform: `translateY(${dragOffset}px) scale(1)`,
        opacity: 1,
        zIndex: 100 - dist,
        boxShadow: "0 20px 50px -12px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.15)",
        transition:
          dragOffset !== 0
            ? "none"
            : `transform 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease`,
      };
    }
    if (dist === 1) {
      return {
        transform: `translateY(${PEEK_1}px) scale(0.97)`,
        opacity: 1,
        zIndex: 100 - dist,
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)",
        transition: `transform 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease`,
      };
    }
    if (dist === 2) {
      return {
        transform: `translateY(${PEEK_1 + PEEK_2}px) scale(0.94)`,
        opacity: 0.9,
        zIndex: 100 - dist,
        boxShadow: "0 4px 16px -6px rgba(0,0,0,0.2)",
        transition: `transform 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.4s ease`,
      };
    }
    return {
      transform: `translateY(${PEEK_1 + PEEK_2 + STACK_GAP + 20}px) scale(0.92)`,
      opacity: 0,
      zIndex: 0,
      pointerEvents: "none",
      transition: `transform 0.4s cubic-bezier(0.16,1,0.3,1), opacity 0.3s ease`,
    };
  }

  const walletHeight =
    cards.length <= 1
      ? 250
      : cards.length === 2
        ? 250 + PEEK_1 + 8
        : 250 + PEEK_1 + PEEK_2 + STACK_GAP + 8;

  const activeCard = cards[activeIdx];

  return (
    <section className="flex flex-col">
      {/* Header */}
      <div className="flex items-baseline justify-between px-1">
        <div>
          <h1 className="font-display text-[28px] leading-tight text-foreground">My Cards</h1>
          {!loading && !error && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {cards.length === 0 ? "No memberships yet" : `${cards.length} joined`}
            </p>
          )}
        </div>
        {cards.length > 1 && (
          <p className="text-[11px] text-muted-foreground">
            {activeIdx + 1} / {cards.length}
          </p>
        )}
      </div>

      {error && (
        <div className="mt-4 glass rounded-2xl p-5 text-center">
          <p className="text-sm text-rose-500">{error}</p>
        </div>
      )}

      {!loading && !error && cards.length === 0 && (
        <div className="mt-6 glass rounded-3xl px-6 py-14 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ember-soft">
            <Sparkles className="h-6 w-6 text-ember" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">No cards yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Join a merchant to start collecting points.
          </p>
          <Link
            to="/map"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 text-xs font-medium text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
          >
            Discover merchants
          </Link>
        </div>
      )}

      {loading && (
        <div className="mt-4">
          <CardSkeletonStack />
        </div>
      )}

      {/* ── Wallet Stack ────────────────────────────────────────────── */}
      {!loading && !error && cards.length > 0 && (
        <>
          <div
            ref={containerRef}
            className="relative mt-5 w-full select-none outline-none"
            style={{ height: walletHeight }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
            onKeyDown={onKeyDown}
            tabIndex={0}
            role="listbox"
            aria-label="Membership cards — swipe or use arrow keys to browse"
            aria-activedescendant={
              activeCard ? `wallet-card-${activeCard.merchant.slug}` : undefined
            }
          >
            {cards.map((card, idx) => {
              const dist = idx - activeIdx;
              const s = stackStyle(idx);
              const isActive = dist === 0;
              const merchantName = card.merchant?.name || "Zentro";

              return (
                <div
                  key={card.merchant.slug}
                  id={`wallet-card-${card.merchant.slug}`}
                  role="option"
                  aria-label={`${merchantName} membership card — ${card.wallet?.points_balance ?? 0} points, ${card.wallet?.tier ?? "bronze"} tier`}
                  aria-selected={isActive}
                  className="absolute left-0 right-0 cursor-pointer overflow-hidden rounded-[20px]"
                  style={{
                    top: 0,
                    aspectRatio: "1.586 / 1",
                    ...s,
                  }}
                  onClick={() => {
                    if (isActive) {
                      navigate({ to: "/m/$slug", params: { slug: card.merchant.slug } });
                    } else {
                      goTo(idx);
                    }
                  }}
                >
                  <LoyaltyCard
                    card={card}
                    compact={false}
                    isActive={isActive}
                    onQrTap={isActive ? () => openQr(card.merchant.slug, merchantName) : undefined}
                  />
                </div>
              );
            })}
          </div>

          {/* Dot indicator */}
          {cards.length > 1 && (
            <div
              className="mt-3 flex items-center justify-center gap-2"
              role="tablist"
              aria-label="Card position"
            >
              {cards.map((c, i) => (
                <button
                  key={c.merchant.slug}
                  onClick={() => goTo(i)}
                  className="rounded-full"
                  role="tab"
                  aria-selected={i === activeIdx}
                  aria-label={c.merchant?.name || `Card ${i + 1}`}
                  style={{
                    width: i === activeIdx ? 20 : 7,
                    height: 7,
                    background: i === activeIdx ? "var(--ember)" : "var(--muted-foreground)",
                    opacity: i === activeIdx ? 1 : 0.35,
                    transition:
                      "width 0.3s cubic-bezier(0.16,1,0.3,1), background 0.3s, opacity 0.3s",
                  }}
                />
              ))}
            </div>
          )}

          {/* Hint */}
          {activeCard && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Tap card to visit store
            </p>
          )}
        </>
      )}

      {qrModal && (
        <QrModal
          merchantSlug={qrModal.slug}
          merchantName={qrModal.name}
          onClose={() => setQrModal(null)}
        />
      )}
    </section>
  );
}
