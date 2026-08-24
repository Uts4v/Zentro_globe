// src/features/merchant-management/components/TodaySpecialPopup.tsx
import { useEffect, useState, useRef, useCallback } from "react";
import { X, ArrowRight, ChevronLeft, ChevronRight, Tag } from "lucide-react";
import { specialApi, type TodaySpecial } from "@/lib/api";

interface Props {
  slug: string;
  onOrderItem?: (menuItemId: string) => void;
  onViewReward?: (rewardId: string) => void;
}

export function TodaySpecialPopup({ slug, onOrderItem, onViewReward }: Props) {
  const [specials, setSpecials] = useState<TodaySpecial[]>([]);
  const [visible, setVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const seenKey = `special_seen_${slug}`;
    if (sessionStorage.getItem(seenKey)) return;

    specialApi.forSlug(slug).then((list) => {
      const active = list.filter((s) => s.is_active);
      if (active.length > 0) {
        setSpecials(active);
        setVisible(true);
      }
    });
  }, [slug]);

  function handleClose() {
    setVisible(false);
    sessionStorage.setItem(`special_seen_${slug}`, "1");
  }

  const scrollToIndex = useCallback((index: number) => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const card = container.children[index] as HTMLElement;
    if (card) {
      container.scrollTo({ left: card.offsetLeft, behavior: "smooth" });
      setActiveIndex(index);
    }
  }, []);

  function handleScroll() {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const scrollLeft = container.scrollLeft;
    const cardWidth = container.firstElementChild?.clientWidth || 1;
    const index = Math.round(scrollLeft / cardWidth);
    setActiveIndex(Math.min(Math.max(index, 0), specials.length - 1));
  }

  function handlePrev() {
    if (activeIndex > 0) scrollToIndex(activeIndex - 1);
  }

  function handleNext() {
    if (activeIndex < specials.length - 1) scrollToIndex(activeIndex + 1);
  }

  function handleCTA(special: TodaySpecial) {
    if (special.linked_menu_item && onOrderItem) {
      onOrderItem(String(special.linked_menu_item));
    } else if (special.linked_reward && onViewReward) {
      onViewReward(special.linked_reward);
    }
    handleClose();
  }

  function getDiscountLabel(special: TodaySpecial): string | null {
    if (special.discount_type === "none" || special.discount_value == null) return null;
    if (special.discount_type === "percentage") return `${special.discount_value}% OFF`;
    return `Rs. ${special.discount_value} OFF`;
  }

  function getDiscountedPrice(special: TodaySpecial): string | null {
    if (
      special.discount_type === "none" ||
      special.discount_value == null ||
      !special.linked_menu_item_price
    )
      return null;
    const price = parseFloat(special.linked_menu_item_price);
    if (special.discount_type === "percentage") {
      const discounted = price * (1 - special.discount_value / 100);
      return discounted.toFixed(0);
    }
    return Math.max(0, price - special.discount_value).toFixed(0);
  }

  if (!visible || specials.length === 0) return null;

  const isCarousel = specials.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-[2rem] bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <span className="text-[11px] uppercase tracking-[0.2em] font-semibold text-muted-foreground">
            Today's Special{isCarousel ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            {isCarousel && (
              <span className="text-[11px] text-muted-foreground">
                {activeIndex + 1}/{specials.length}
              </span>
            )}
            <button
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-mist"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Carousel / Single card */}
        {isCarousel ? (
          <div className="relative">
            <style>{`.today-special-carousel::-webkit-scrollbar { display: none; }`}</style>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
              style={{
                scrollSnapType: "x mandatory",
                scrollbarWidth: "none",
                msOverflowStyle: "none",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {specials.map((special) => (
                <SpecialCard
                  key={special.id}
                  special={special}
                  onCTA={() => handleCTA(special)}
                  discountLabel={getDiscountLabel(special)}
                  discountedPrice={getDiscountedPrice(special)}
                  carousel
                />
              ))}
            </div>

            {/* Nav arrows */}
            {activeIndex > 0 && (
              <button
                onClick={handlePrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 backdrop-blur-sm"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {activeIndex < specials.length - 1 && (
              <button
                onClick={handleNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 backdrop-blur-sm"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            {/* Dots */}
            <div className="flex justify-center gap-1.5 pb-4">
              {specials.map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollToIndex(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === activeIndex ? "w-5 bg-ink" : "w-1.5 bg-border"
                  }`}
                />
              ))}
            </div>
          </div>
        ) : (
          <SpecialCard
            special={specials[0]}
            onCTA={() => handleCTA(specials[0])}
            discountLabel={getDiscountLabel(specials[0])}
            discountedPrice={getDiscountedPrice(specials[0])}
          />
        )}
      </div>
    </div>
  );
}

// ── Single Special Card ──────────────────────────────────────────────────────
function SpecialCard({
  special,
  onCTA,
  discountLabel,
  discountedPrice,
  carousel,
}: {
  special: TodaySpecial;
  onCTA: () => void;
  discountLabel: string | null;
  discountedPrice: string | null;
  carousel?: boolean;
}) {
  const hasCTA = !!(special.linked_menu_item || special.linked_reward);
  const ctaLabel = special.linked_menu_item
    ? "Order now"
    : special.linked_reward
      ? "View reward"
      : null;

  return (
    <div
      className={`shrink-0 snap-start ${carousel ? "w-full" : ""}`}
      style={carousel ? { scrollSnapAlign: "start" } : undefined}
    >
      {/* Banner image */}
      {special.image_url && (
        <div className="relative h-52 w-full">
          <img src={special.image_url} alt={special.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

          {/* Discount badge on image */}
          {discountLabel && (
            <div className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
              <Tag className="h-3 w-3" />
              {discountLabel}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-6">
        {!special.image_url && discountLabel && (
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            <Tag className="h-3 w-3" />
            {discountLabel}
          </div>
        )}

        <h2 className="font-display text-3xl leading-tight text-ink">{special.title}</h2>

        {special.description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {special.description}
          </p>
        )}

        {(special.linked_menu_item_name || special.linked_reward_name) && (
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ember-soft px-3 py-1.5 text-xs text-ember">
            <span>{special.linked_menu_item_name ?? special.linked_reward_name}</span>
            {discountedPrice && special.linked_menu_item_price && (
              <span className="ml-1">
                <span className="line-through opacity-50">
                  Rs. {special.linked_menu_item_price}
                </span>{" "}
                <span className="font-bold text-emerald-600">Rs. {discountedPrice}</span>
              </span>
            )}
          </div>
        )}

        <div className={`mt-5 flex gap-2 ${!hasCTA ? "justify-center" : ""}`}>
          {hasCTA && (
            <button
              onClick={onCTA}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-ink py-3 text-sm font-medium text-primary-foreground"
            >
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={onCTA}
            className={`rounded-2xl border border-border py-3 text-sm text-muted-foreground hover:bg-mist ${
              hasCTA ? "px-4" : "flex-1"
            }`}
          >
            {hasCTA ? "Maybe later" : "Got it"}
          </button>
        </div>
      </div>
    </div>
  );
}
