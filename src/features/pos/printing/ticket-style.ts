/**
 * Shared typography for the printed tickets.
 *
 * Both the KOT and the bill/receipt are thermal prints on narrow paper, so the
 * type scale is the single thing that decides whether a ticket is readable or a
 * smear of 10px monospace. It lives here rather than in either component because:
 *
 *   - a 48mm roll (58mm paper, minus margins) fits roughly 30 characters of
 *     Courier New at 11px, and about 24 at 14px. Every step up trades characters
 *     per line for legibility, so the trade-off has to be made once and
 *     consistently across both documents.
 *   - the preview shown in the browser and the page sent to the printer were
 *     previously separate implementations that had already drifted apart.
 *     Both now render the same markup, so they cannot disagree again.
 *
 * Sizes are plain pixel numbers (not Tailwind classes) because the printer is
 * fed a standalone HTML document that never loads the app stylesheet.
 */

export type TicketPaper = "58mm" | "80mm" | "a4";

/** Printable width for each paper size, after margins. */
export const TICKET_WIDTH: Record<TicketPaper, string> = {
  "58mm": "48mm",
  "80mm": "72mm",
  a4: "190mm",
};

/** Page margin for each paper size. */
export const TICKET_MARGIN: Record<TicketPaper, string> = {
  "58mm": "3mm",
  "80mm": "3mm",
  a4: "10mm",
};

export interface TicketTypeScale {
  /** Merchant name at the head of the ticket. */
  merchant: number;
  /** The document's own title, e.g. KITCHEN ORDER TICKET. */
  title: number;
  /** Metadata rows: Order, Date, Type, Table. */
  meta: number;
  /** Item name — the thing the reader is actually looking for. */
  item: number;
  /** Modifiers and instructions, nested under an item. */
  sub: number;
  /** Block headings such as NOTES. */
  heading: number;
  /** The boxed KOT number. */
  badge: number;
  /** Trailing legal/handling line. */
  foot: number;
}

/**
 * Type scale for the 58mm roll, which is the tightest case and therefore the
 * one that sets the ceiling for the others.
 *
 * Modest by design: at 58mm, 13px body still fits ~26 characters per line.
 * Going to 15px drops to ~22 and starts wrapping dish names mid-word.
 */
const SCALE_58: TicketTypeScale = {
  merchant: 14,
  title: 11,
  meta: 13,
  item: 15,
  sub: 11,
  heading: 11,
  badge: 18,
  foot: 9,
};

/** 80mm and A4 have room to breathe, so they read a step larger. */
const SCALE_WIDE: TicketTypeScale = {
  merchant: 17,
  title: 12,
  meta: 14,
  item: 17,
  sub: 12,
  heading: 12,
  badge: 20,
  foot: 10,
};

export function typeScale(paper: TicketPaper): TicketTypeScale {
  return paper === "58mm" ? SCALE_58 : SCALE_WIDE;
}

/**
 * Merchant logo size, in px.
 *
 * Deliberately small. The logo is identification, not content — the kitchen
 * reads the dish names — and a large image on a narrow roll pushes real content
 * onto a second page of paper.
 */
export const LOGO_PX = 18;

/** Monospace stack shared by every printed document. */
export const TICKET_FONT = '"Courier New","Lucida Console","Consolas",monospace';

/**
 * Escape text for interpolation into the print document.
 *
 * Item names, customer names and notes are all merchant- or cashier-authored
 * free text, and this markup is injected with innerHTML, so an unescaped `</div>`
 * in a dish name would otherwise corrupt the whole ticket.
 */
export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
