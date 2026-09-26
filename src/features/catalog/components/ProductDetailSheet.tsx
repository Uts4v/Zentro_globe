import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X, ChevronRight, AlertCircle } from "lucide-react";
import type { MenuOptionGroup, MenuSelection, MenuItemSelectable } from "@/lib/api/types";
import { lineUnitPrice, fromPrice, baseDiscount } from "@/lib/menu-utils";
import { formatCurrency } from "@/lib/currency";

export interface ProductDraft {
  itemId: string;
  qty: number;
  selections: MenuSelection[];
  specialInstructions: string;
  unitPrice: number;
}

interface Props {
  open: boolean;
  item: MenuItemSelectable | null;
  currencySymbol: string;
  onClose: () => void;
  onAdd: (draft: ProductDraft) => void;
  submitLabel?: string;
  initialQty?: number;
  initialSelections?: MenuSelection[];
  initialInstructions?: string;
  /** Bump this (e.g. the cart line key) to force state re-init for a different edit. */
  resetKey?: string;
}

function initSelections(groups: MenuOptionGroup[]): MenuSelection[] {
  const out: MenuSelection[] = [];
  for (const g of groups) {
    if (g.kind === "variant") {
      const def = g.options.find((o) => o.is_default && o.is_available);
      if (def) out.push({ group_id: g.id, option_id: def.id });
    } else if (g.min_select > 0) {
      const pre = g.options.filter((o) => o.is_default && o.is_available).slice(0, g.min_select);
      for (const o of pre) out.push({ group_id: g.id, option_id: o.id });
    }
  }
  return out;
}

function mergeSelections(
  base: MenuSelection[],
  incoming: MenuSelection[],
  groups: MenuOptionGroup[],
): MenuSelection[] {
  const groupById = new Map(groups.map((g) => [String(g.id), g]));
  const incomingGroups = new Set(incoming.map((s) => String(s.group_id)));
  const merged = base.filter((s) => !incomingGroups.has(String(s.group_id)));
  for (const selection of incoming) {
    const group = groupById.get(String(selection.group_id));
    if (
      group?.options.some(
        (option) => String(option.id) === String(selection.option_id) && option.is_available,
      )
    ) {
      merged.push(selection);
    }
  }
  return merged;
}

export default function ProductDetailSheet({
  open,
  item,
  currencySymbol,
  onClose,
  onAdd,
  submitLabel = "Add to bag",
  initialQty,
  initialSelections,
  initialInstructions,
  resetKey,
}: Props) {
  const [qty, setQty] = useState(1);
  const [selections, setSelections] = useState<MenuSelection[]>([]);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");

  const groups = useMemo(
    () =>
      (item?.groups ?? [])
        .filter((g) => g.is_active !== false && g.options.length > 0)
        .slice()
        .sort(
          (a, b) =>
            (a.kind === b.kind ? 0 : a.kind === "variant" ? -1 : 1) ||
            a.display_order - b.display_order,
        ),
    [item?.groups],
  );

  useEffect(() => {
    if (open && item) {
      const base = initSelections(groups);
      const merged =
        initialSelections !== undefined ? mergeSelections(base, initialSelections, groups) : base;
      setSelections(merged);
      setQty(initialQty ?? 1);
      setInstructions(initialInstructions ?? "");
      setError("");
    }
  }, [open, item, groups, resetKey, initialQty, initialInstructions, initialSelections]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !item) return null;

  const soldOut = !item.is_available || item.status === "draft" || item.status === "archived";
  const selectedIn = (g: MenuOptionGroup) =>
    selections.filter((s) => String(s.group_id) === String(g.id));

  const unit = lineUnitPrice(item, selections);
  const total = Math.round(unit * qty * 100) / 100;
  const discount = baseDiscount(item);
  const hasVariant = groups.some((group) => group.kind === "variant");
  const selectedVariant = groups
    .filter((group) => group.kind === "variant")
    .some((group) => selectedIn(group).length > 0);
  const shownPrice = hasVariant && !selectedVariant ? fromPrice(item) : unit;

  function toggleOption(g: MenuOptionGroup, optionId: string) {
    setError("");
    if (g.kind === "variant") {
      setSelections((prev) => [
        ...prev.filter((s) => String(s.group_id) !== String(g.id)),
        { group_id: g.id, option_id: optionId },
      ]);
      return;
    }
    const current = selectedIn(g);
    const has = current.some((s) => String(s.option_id) === String(optionId));
    if (has && current.length - 1 < g.min_select) {
      setError(`Choose at least ${g.min_select} for "${g.name}".`);
      return;
    }
    if (!has && current.length >= g.max_select) {
      setError(`You can choose up to ${g.max_select} for "${g.name}".`);
      return;
    }
    setSelections((prev) => [
      ...prev.filter(
        (s) => String(s.group_id) !== String(g.id) || String(s.option_id) !== String(optionId),
      ),
      ...(!has ? [{ group_id: g.id, option_id: optionId }] : []),
    ]);
  }

  function handleAdd() {
    if (!item) return;
    for (const g of groups) {
      const chosen = selectedIn(g);
      if (chosen.length < g.min_select || (g.required && chosen.length === 0)) {
        setError(
          g.max_select === 1
            ? `Choose an option for ${g.name} to continue.`
            : `Choose at least ${g.min_select} for ${g.name}.`,
        );
        return;
      }
      if (chosen.length > g.max_select) {
        setError(`You can choose up to ${g.max_select} for ${g.name}.`);
        return;
      }
    }
    onAdd({
      itemId: String(item.id),
      qty,
      selections,
      specialInstructions: instructions.trim(),
      unitPrice: unit,
    });
    onClose();
  }

  const hasOptions = groups.length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-background shadow-2xl sm:rounded-[28px]"
        style={{ border: "1px solid var(--border)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative">
          {item.image_url ? (
            <div className="relative h-52 w-full sm:h-56">
              <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
            </div>
          ) : (
            <div className="relative grid h-40 w-full place-items-center bg-mist text-7xl">
              {item.emoji || "☕"}
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-transform active:scale-90"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          {soldOut && (
            <span className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              Sold out
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {item.category || "Menu"}
          </p>
          <h2
            id="product-detail-title"
            className="font-display mt-1 text-3xl leading-tight text-foreground"
          >
            {item.name}
          </h2>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-display text-xl text-foreground">
              {hasVariant && !selectedVariant ? "From " : ""}
              {formatCurrency(shownPrice, currencySymbol, 0)}
            </span>
            {discount && (
              <span className="text-sm text-muted-foreground line-through">
                {formatCurrency(discount.original, currencySymbol, 0)}
              </span>
            )}
            {discount?.percentLabel && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                {discount.percentLabel}
              </span>
            )}
            {(item.dietary_tags?.length ?? 0) > 0 && (
              <span className="flex flex-wrap gap-1">
                {item.dietary_tags!.slice(0, 3).map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-mist px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </span>
                ))}
              </span>
            )}
          </div>
          {item.short_description || item.description ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.short_description || item.description}
            </p>
          ) : null}

          <div className="mt-5 space-y-5">
            {groups.some((g) => g.kind === "variant") && (
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Variants
              </p>
            )}
            {groups.map((g, index) => {
              const previous = groups[index - 1];
              const startsAddOns = g.kind === "modifier" && previous?.kind !== "modifier";
              const chosen = selectedIn(g);
              return (
                <div key={g.id}>
                  {startsAddOns && (
                    <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Add-ons
                    </p>
                  )}
                  <fieldset className="min-w-0">
                    <legend className="mb-1 text-sm font-semibold text-foreground">{g.name}</legend>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {g.required || g.min_select > 0 ? "Required" : "Optional"}
                      {" · "}
                      {g.max_select === 1
                        ? "Choose one"
                        : g.min_select > 0
                          ? `Choose ${g.min_select}-${g.max_select}`
                          : `Choose up to ${g.max_select}`}
                    </p>

                    {g.kind === "variant" ? (
                      <div className="space-y-2">
                        {g.options.map((o) => {
                          const active = chosen.some((s) => String(s.option_id) === String(o.id));
                          const disabled = !o.is_available;
                          const optionPrice = o.price == null ? null : Number(o.price);
                          return (
                            <label
                              key={o.id}
                              className={`relative flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                                active
                                  ? "border-[#0F3D3A] bg-[#EAF2EF] text-[#172A2B]"
                                  : "border-border bg-card text-foreground"
                              } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                            >
                              <input
                                className="peer sr-only"
                                type="radio"
                                name={`variant-${g.id}`}
                                checked={active}
                                disabled={disabled}
                                onChange={() => toggleOption(g, o.id)}
                              />
                              <span className="flex items-center gap-3">
                                <span
                                  className={`grid h-5 w-5 place-items-center rounded-full border ${active ? "border-[#0F3D3A]" : "border-muted-foreground"}`}
                                  aria-hidden="true"
                                >
                                  {active && (
                                    <span className="h-2.5 w-2.5 rounded-full bg-[#0F3D3A]" />
                                  )}
                                </span>
                                <span className="text-sm font-semibold">{o.name}</span>
                              </span>
                              <span className="flex items-center gap-2">
                                {optionPrice != null && Number.isFinite(optionPrice) && (
                                  <span className="text-sm font-semibold">
                                    {formatCurrency(optionPrice, currencySymbol, 0)}
                                  </span>
                                )}
                              </span>
                              <span
                                className="pointer-events-none absolute inset-0 rounded-xl ring-0 peer-focus-visible:ring-2 peer-focus-visible:ring-[#0F3D3A]"
                                aria-hidden="true"
                              />
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {g.options.map((o) => {
                          const active = chosen.some((s) => String(s.option_id) === String(o.id));
                          const singleChoice = g.max_select === 1;
                          const delta = Number(o.price_delta ?? 0);
                          return (
                            <label
                              key={o.id}
                              className={`relative flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                                active
                                  ? "border-[#0F3D3A] bg-[#EAF2EF] text-[#172A2B]"
                                  : "border-border bg-card text-foreground"
                              } ${!o.is_available ? "cursor-not-allowed opacity-45" : ""}`}
                            >
                              <input
                                className="peer sr-only"
                                type={singleChoice ? "radio" : "checkbox"}
                                name={singleChoice ? `modifier-${g.id}` : undefined}
                                checked={active}
                                disabled={!o.is_available}
                                onChange={() => toggleOption(g, o.id)}
                              />
                              <span className="flex items-center gap-3">
                                <span
                                  className={`grid h-5 w-5 shrink-0 place-items-center border ${singleChoice ? "rounded-full" : "rounded"} ${active ? "border-[#0F3D3A] bg-[#0F3D3A] text-white" : "border-muted-foreground"}`}
                                  aria-hidden="true"
                                >
                                  {active && <span className="text-xs leading-none">✓</span>}
                                </span>
                                <span className="text-sm font-medium">{o.name}</span>
                              </span>
                              {Number.isFinite(delta) && delta > 0 && (
                                <span className="text-sm font-medium">
                                  +{formatCurrency(delta, currencySymbol, 0)}
                                </span>
                              )}
                              <span
                                className="pointer-events-none absolute inset-0 rounded-xl ring-0 peer-focus-visible:ring-2 peer-focus-visible:ring-[#0F3D3A]"
                                aria-hidden="true"
                              />
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </fieldset>
                </div>
              );
            })}

            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Special instructions</p>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="e.g. extra hot, no onions…"
                className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
              </div>
            )}
          </div>
        </div>

        {/* Sticky add-to-cart */}
        <div className="border-t border-border bg-card/80 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-9 w-9 place-items-center rounded-full bg-mist text-foreground active:scale-90"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-7 text-center text-sm font-semibold text-foreground">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background active:scale-90"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={handleAdd}
              disabled={soldOut}
              className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-foreground text-sm font-semibold text-background transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {submitLabel}
              <ChevronRight className="h-4 w-4" />
              <span className="font-display text-base">
                {formatCurrency(total, currencySymbol, 0)}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
