/**
 * Table label for tickets and bills.
 *
 * Staff navigate by the number, so it leads — the name alone is not enough to
 * find a table in the room. Returns null when there is nothing to show, so
 * callers can skip the row entirely for counter (table-less) orders.
 */
export function tableLabel(name?: string | null, number?: number | null): string | null {
  const trimmed = (name ?? "").trim();
  const hasNumber = number != null;

  if (hasNumber && trimmed) return `#${number} · ${trimmed}`;
  if (hasNumber) return `#${number}`;
  return trimmed || null;
}
