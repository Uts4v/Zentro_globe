// src/lib/use-anchored-popover.ts
import { useCallback, useEffect, useState, type RefObject } from "react";

export type PopoverPosition = { top: number; left: number };

type Options = {
  /** Only measure/position while open; saves work and avoids stray listeners. */
  open: boolean;
  /** The element the panel hangs off (usually the trigger's wrapper). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Preferred panel width; clamped down on narrow viewports. */
  width: number;
  /** Preferred panel height; only used to keep the panel on-screen. */
  height?: number;
  /** Gap between anchor and panel, in px. */
  gap?: number;
  /** Distance to keep from the viewport edge, in px. */
  padding?: number;
};

/**
 * Viewport-clamped position for a dropdown panel.
 *
 * A panel anchored to a trigger near the right edge overflows to the left and
 * gets clipped by the viewport (the POS bell sits in a 256px sidebar with a
 * 320px panel, so ~84px renders off-screen). This right-aligns the panel to the
 * anchor, then clamps it inside the viewport on both axes, and re-measures on
 * resize/scroll so it cannot drift out of bounds after the page moves.
 *
 * `ready` is false until the first measurement so the caller can avoid painting
 * the panel at the origin on the opening frame.
 */
export function useAnchoredPopover({
  open,
  anchorRef,
  width,
  height,
  gap = 8,
  padding = 8,
}: Options) {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const panelW = Math.min(width, viewportW - padding * 2);
    const panelH = height ? Math.min(height, viewportH - padding * 2) : 0;

    // Prefer right-aligning with the anchor (how a bell dropdown reads), then
    // clamp so neither side can leave the viewport.
    const preferredLeft = rect.right - panelW;
    const left = Math.min(
      Math.max(preferredLeft, padding),
      Math.max(padding, viewportW - panelW - padding),
    );

    const below = rect.bottom + gap;
    const above = rect.top - gap - panelH;
    // Flip above the anchor when there is not enough room below.
    const useAbove = panelH > 0 && below + panelH > viewportH - padding && above > padding;
    const top = useAbove ? above : Math.max(padding, Math.min(below, viewportH - padding));

    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
  }, [anchorRef, width, height, gap, padding]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    measure();

    window.addEventListener("resize", measure);
    // Capture phase catches scrolls in any nested container, not just the page.
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  return { position, ready: position !== null, measure };
}
