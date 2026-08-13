// C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\features\merchant-management\components\TodaySpecialPopup.tsx
import { useEffect, useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { specialApi, type TodaySpecial } from "@/lib/api";

interface Props {
  slug: string;
  onOrderItem?: (menuItemId: string) => void;
  onViewReward?: (rewardId: string) => void;
}

export function TodaySpecialPopup({ slug, onOrderItem, onViewReward }: Props) {
  const [special, setSpecial] = useState<TodaySpecial | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show once per session per merchant slug
    const seenKey = `special_seen_${slug}`;
    if (sessionStorage.getItem(seenKey)) return;

    specialApi.forSlug(slug).then((s) => {
      if (s && s.is_active) {
        setSpecial(s);
        setVisible(true);
      }
    });
  }, [slug]);

  function handleClose() {
    setVisible(false);
    sessionStorage.setItem(`special_seen_${slug}`, "1");
  }

  function handleCTA() {
    if (special?.linked_menu_item && onOrderItem) {
      onOrderItem(String(special.linked_menu_item));
    } else if (special?.linked_reward && onViewReward) {
      onViewReward(special.linked_reward);
    }
    handleClose();
  }

  if (!visible || !special) return null;

  const hasCTA = !!(special.linked_menu_item || special.linked_reward);
  const ctaLabel = special.linked_menu_item
    ? "Order now"
    : special.linked_reward
    ? "View reward"
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-[2rem] bg-background shadow-2xl">

        {/* Banner image */}
        {special.image_url && (
          <div className="relative h-52 w-full">
            <img
              src={special.image_url}
              alt={special.title}
              className="h-full w-full object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <button
              onClick={handleClose}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="p-6">
          {/* Close button when no image */}
          {!special.image_url && (
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Today's special
              </span>
              <button
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-mist"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {special.image_url && (
            <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Today's special
            </p>
          )}

          <h2 className="font-display text-3xl leading-tight text-ink">
            {special.title}
          </h2>

          {special.description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {special.description}
            </p>
          )}

          {(special.linked_menu_item_name || special.linked_reward_name) && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-ember-soft px-3 py-1.5 text-xs text-ember">
              <span>✨</span>
              {special.linked_menu_item_name ?? special.linked_reward_name}
            </div>
          )}

          <div className={`mt-5 flex gap-2 ${!hasCTA ? "justify-center" : ""}`}>
            {hasCTA && (
              <button
                onClick={handleCTA}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-ink py-3 text-sm font-medium text-primary-foreground"
              >
                {ctaLabel} <ArrowRight className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={handleClose}
              className={`rounded-2xl border border-border py-3 text-sm text-muted-foreground hover:bg-mist ${
                hasCTA ? "px-4" : "flex-1"
              }`}
            >
              {hasCTA ? "Maybe later" : "Got it"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}