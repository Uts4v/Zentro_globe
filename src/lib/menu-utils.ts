import type { MenuItem, MenuOption, MenuOptionGroup, MenuSelection } from "@/lib/api/types";

/**
 * Client-side helpers that mirror the server's pricing rules (config/menu_pricing.py).
 * The server remains the price authority — these are only used for local display.
 */

export function cartKey(
  itemId: string,
  selections: MenuSelection[] = [],
  specialInstructions = "",
): string {
  const sel = [...selections]
    .sort(
      (a, b) =>
        String(a.group_id).localeCompare(String(b.group_id)) ||
        String(a.option_id).localeCompare(String(b.option_id)),
    )
    .map((s) => `${s.group_id}:${s.option_id}`)
    .join(",");
  return `${itemId}::${sel}::${(specialInstructions || "").trim()}`;
}

/** A variant that carries an absolute price replaces the base price entirely. */
function hasAbsoluteVariant(item: MenuItem): boolean {
  return (item.groups ?? []).some(
    (g) =>
      g.kind === "variant" && g.options.some((o) => Number.isFinite(parseFloat(o.price ?? ""))),
  );
}

export interface BaseDiscount {
  original: number;
  discounted: number;
  percentLabel: string | null;
}

/**
 * In-force base-price discount (mirrors the server). Returns null when the item
 * is undiscounted or when an absolute variant price means the base is ignored.
 * Discount fields come from the server, which already applies the special's
 * time window, so an expired special never shows a discount here.
 */
export function baseDiscount(item: MenuItem): BaseDiscount | null {
  const discountedRaw = parseFloat(item.discount_price ?? "");
  if (!Number.isFinite(discountedRaw) || hasAbsoluteVariant(item)) return null;
  const original = Math.round((parseFloat(item.price) || 0) * 100) / 100;
  const discounted = Math.round(discountedRaw * 100) / 100;
  if (discounted >= original) return null;
  const pct = original > 0 ? Math.round(((original - discounted) / original) * 100) : 0;
  return { original, discounted, percentLabel: pct > 0 ? `-${pct}%` : null };
}

/** Estimate the unit price for an item + selections using the same rules as the server. */
export function lineUnitPrice(item: MenuItem, selections: MenuSelection[] = []): number {
  let price = baseDiscount(item)?.discounted ?? (parseFloat(item.price) || 0);

  const byId = (groupId: string | number) =>
    (item.groups ?? []).find((g) => String(g.id) === String(groupId));

  for (const sel of selections) {
    const group = byId(sel.group_id);
    if (!group) continue;
    const opt = group.options.find((o) => String(o.id) === String(sel.option_id));
    if (!opt) continue;
    if (group.kind === "variant") {
      const abs = parseFloat(opt.price ?? "");
      if (Number.isFinite(abs)) price = abs;
    } else {
      price += parseFloat(opt.price_delta ?? "") || 0;
    }
  }
  return Math.round(price * 100) / 100;
}

/** "from" price for display — lowest variant price, else discounted base price. */
export function fromPrice(item: MenuItem): number {
  const variants = (item.groups ?? []).find((g) => g.kind === "variant");
  if (variants) {
    const prices = variants.options
      .map((o) => parseFloat(o.price ?? ""))
      .filter((p) => Number.isFinite(p));
    if (prices.length > 0) return Math.min(...prices);
  }
  return baseDiscount(item)?.discounted ?? Math.round((parseFloat(item.price) || 0) * 100) / 100;
}

export function optionLabel(option: MenuOption): string {
  if (option.price != null && option.price !== "" && option.price !== "0.00") {
    return `+${option.price}`;
  }
  const delta = parseFloat(option.price_delta ?? "");
  if (Number.isFinite(delta) && delta > 0) return `+${delta.toFixed(2)}`;
  return "";
}

/** Human-readable summary of the chosen options for a line, e.g. "Size: Large · Extras: Cheese". */
export function lineSelectionsText(item: MenuItem, selections: MenuSelection[]): string {
  if (!selections || selections.length === 0) return "";
  const groups = item.groups ?? [];
  const parts: string[] = [];
  for (const g of groups) {
    const chosen = selections.filter((s) => String(s.group_id) === String(g.id));
    if (chosen.length === 0) continue;
    const names = chosen
      .map((s) => g.options.find((o) => String(o.id) === String(s.option_id))?.name)
      .filter(Boolean);
    if (names.length > 0) parts.push(names.join(" & "));
  }
  return parts.join(" · ");
}

export function groupSelectionLabel(group: MenuOptionGroup, selections: MenuSelection[]): string {
  const chosen = selections.filter((s) => String(s.group_id) === String(group.id));
  return chosen
    .map((s) => group.options.find((o) => String(o.id) === String(s.option_id))?.name)
    .filter(Boolean)
    .join(", ");
}
