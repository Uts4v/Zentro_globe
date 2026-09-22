import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X, ChevronRight, AlertCircle } from "lucide-react";
import type { MenuItem, MenuOptionGroup, MenuSelection } from "@/lib/api/types";
import { lineUnitPrice, optionLabel, baseDiscount } from "@/lib/menu-utils";
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
  item: MenuItem | null;
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
      const def = g.options.find((o) => o.is_default && o.is_available) ?? g.options[0];
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
  const map = new Map<string, MenuSelection>();
  for (const s of base) map.set(String(s.group_id), s);
  for (const s of incoming) map.set(String(s.group_id), s);
  const groupIds = new Set(groups.map((g) => String(g.id)));
  return Array.from(map.values()).filter((s) => groupIds.has(String(s.group_id)));
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

  const groups = useMemo(() => (item?.groups ?? []).filter((g) => g.is_active !== false), [item]);

  useEffect(() => {
    if (open && item) {
      const base = initSelections(groups);
      const merged =
        initialSelections && initialSelections.length > 0
          ? mergeSelections(base, initialSelections, groups)
          : base;
      setSelections(merged);
      setQty(initialQty ?? 1);
      setInstructions(initialInstructions ?? "");
      setError("");
    }
  }, [open, item?.id, resetKey, initialQty, initialInstructions, initialSelections]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const unit = lineUnitPrice(item, selections);
  const total = Math.round(unit * qty * 100) / 100;
  const discount = baseDiscount(item);

  const selectedIn = (g: MenuOptionGroup) =>
    selections.filter((s) => String(s.group_id) === String(g.id));

  function toggleOption(g: MenuOptionGroup, optionId: string) {
    setError("");
    if (g.kind === "variant") {
      setSelections((prev) => [
        ...prev.filter((s) => String(s.group_id) !== String(g.id)),
        { group_id: g.id, option_id: optionId },
      ]);
      return;
    }
    setSelections((prev) => {
      const current = selectedIn(g);
      const has = current.some((s) => String(s.option_id) === String(optionId));
      const rest = prev.filter(
        (s) => String(s.group_id) !== String(g.id) || String(s.option_id) !== String(optionId),
      );
      if (has) {
        if (current.length - 1 < g.min_select) {
          setError(`Keep at least ${g.min_select} for "${g.name}".`);
          return prev;
        }
        return rest;
      }
      if (current.length + 1 > g.max_select) {
        setError(`You can choose up to ${g.max_select} for "${g.name}".`);
        return prev;
      }
      return [...rest, { group_id: g.id, option_id: optionId }];
    });
  }

  function handleAdd() {
    if (!item) return;
    for (const g of groups) {
      const chosen = selectedIn(g);
      if (g.required && chosen.length === 0) {
        setError(`Please choose an option for "${g.name}".`);
        return;
      }
      if (chosen.length < g.min_select || chosen.length > g.max_select) {
        setError(
          g.min_select === g.max_select
            ? `Please select exactly ${g.min_select} for "${g.name}".`
            : `Please select between ${g.min_select} and ${g.max_select} for "${g.name}".`,
        );
        return;
      }
      if (g.kind === "variant" && chosen.length > 1) {
        setError(`Choose only one option for "${g.name}".`);
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
          <h2 className="font-display mt-1 text-3xl leading-tight text-foreground">{item.name}</h2>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-display text-xl text-foreground">
              {formatCurrency(unit, currencySymbol, 0)}
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
            {groups.map((g) => {
              const chosen = selectedIn(g);
              return (
                <section key={g.id}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <p className="text-sm font-semibold text-foreground">
                      {g.name}
                      {g.required && <span className="ml-1 text-ember">*</span>}
                      {!g.required && (
                        <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                          Optional
                        </span>
                      )}
                    </p>
                    {g.min_select > 0 && !g.required && (
                      <span className="text-[10px] text-muted-foreground">
                        up to {g.max_select}
                      </span>
                    )}
                  </div>

                  {g.kind === "variant" ? (
                    <div className="space-y-2">
                      {g.options.map((o) => {
                        const active = chosen.some((s) => String(s.option_id) === String(o.id));
                        const disabled = !o.is_available;
                        return (
                          <button
                            key={o.id}
                            disabled={disabled}
                            onClick={() => toggleOption(g, o.id)}
                            className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                              active
                                ? "border-foreground bg-foreground text-background"
                                : "border-border bg-card text-foreground"
                            } ${disabled ? "opacity-40" : ""}`}
                          >
                            <span className="text-sm font-medium">{o.name}</span>
                            <span className="flex items-center gap-2">
                              {o.price != null && (
                                <span
                                  className={`text-xs ${active ? "text-background/70" : "text-muted-foreground"}`}
                                >
                                  {formatCurrency(parseFloat(o.price), currencySymbol, 0)}
                                </span>
                              )}
                              <span
                                className={`grid h-5 w-5 place-items-center rounded-full border ${
                                  active ? "border-background/60" : "border-border"
                                }`}
                              >
                                {active && <span className="h-2 w-2 rounded-full bg-background" />}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {g.options.map((o) => {
                        const active = chosen.some((s) => String(s.option_id) === String(o.id));
                        const label = optionLabel(o);
                        return (
                          <button
                            key={o.id}
                            disabled={!o.is_available}
                            onClick={() => toggleOption(g, o.id)}
                            className={`flex flex-col items-start gap-1 rounded-2xl border px-3.5 py-3 text-left transition-colors ${
                              active
                                ? "border-foreground bg-card-foreground text-background"
                                : "border-border bg-card text-foreground"
                            } ${!o.is_available ? "opacity-40" : ""}`}
                          >
                            <span className="text-sm font-medium leading-tight">{o.name}</span>
                            {label && (
                              <span
                                className={`text-[11px] ${active ? "text-background/70" : "text-ember"}`}
                              >
                                {label}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            {hasOptions && (
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
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
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
