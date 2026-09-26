import { usePosStore } from "../store";
import { useState, useEffect, useRef } from "react";
import { formatCurrency } from "@/lib/currency";
import { fromPrice } from "@/lib/menu-utils";
import type { MenuItemSelectable } from "@/lib/api/types";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";
import {
  Search,
  Plus,
  Star,
  Coffee,
  Check,
  SlidersHorizontal,
  Command,
  Gift,
  Sliders,
} from "lucide-react";

/** A product as the POS menu snapshot describes it. */
type PosMenuItem = MenuItemSelectable & {
  id: number;
  is_featured: boolean;
  loyalty_reward: boolean;
  points_per_item: number;
};

export default function MenuGrid() {
  const menu = usePosStore((s) => s.menu);
  const addItemToCart = usePosStore((s) => s.addItemToCart);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [detailItem, setDetailItem] = useState<PosMenuItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!menu) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p>Loading menu...</p>
      </div>
    );
  }

  const categories = Object.keys(menu.categories);
  const allItems = Array.from(
    new Map(
      Object.values(menu.categories)
        .flat()
        .map((item) => [item.id, item]),
    ).values(),
  );

  function isVisible(item: PosMenuItem) {
    return showUnavailable || item.is_available;
  }

  function matchesSearch(item: PosMenuItem) {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) || (item.description ?? "").toLowerCase().includes(q)
    );
  }

  const searchResults = allItems.filter((item) => isVisible(item) && matchesSearch(item));

  function hasOptions(item: PosMenuItem) {
    return (item.groups ?? []).some((g) => g.is_active !== false);
  }

  function flashAdded(id: number) {
    setLastAddedId(id);
    window.setTimeout(() => {
      setLastAddedId((cur) => (cur === id ? null : cur));
    }, 650);
  }

  function handleAdd(item: PosMenuItem) {
    // Items with variant/modifier groups must go through the detail sheet:
    // the server rejects an unselected required group, and guessing a default
    // here would silently bill the wrong configuration.
    if (hasOptions(item)) {
      setDetailItem(item);
      return;
    }
    const price = fromPrice(item);
    addItemToCart({
      menu_item_id: item.id,
      name: item.name,
      price,
      quantity: 1,
      subtotal: price,
      selections: [],
      special_instructions: "",
    });
    flashAdded(item.id);
  }

  function handleSheetAdd(draft: ProductDraft) {
    addItemToCart({
      menu_item_id: Number(draft.itemId),
      name: detailItem?.name ?? "",
      price: draft.unitPrice,
      quantity: draft.qty,
      subtotal: draft.unitPrice * draft.qty,
      selections: draft.selections,
      special_instructions: draft.specialInstructions,
    });
    if (detailItem) flashAdded(detailItem.id);
  }

  // Sections when browsing (no search, no specific category)
  const sections = selectedCategory
    ? selectedCategory === "All"
      ? categories
      : [selectedCategory]
    : categories;

  const showSections = !search;

  return (
    <div className="flex h-full flex-col">
      {/* ── Search bar ── */}
      <div className="shrink-0 px-5 pb-2 pt-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search menu items..."
            aria-label="Search menu"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-2xl border border-border bg-card py-3.5 pl-12 pr-24 text-[15px] text-foreground shadow-[var(--shadow-card)] placeholder:text-muted-foreground focus:border-ember focus:outline-none focus:ring-2 focus:ring-ember/20"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
<<<<<<< HEAD
            <span className="hidden items-center gap-1 rounded-lg border border-border bg-mist px-2 py-1 text-[10px] font-medium text-muted-foreground sm:flex">
              <Command className="h-3 w-3" />K
=======
            <span className="hidden items-center gap-1 rounded-lg border border-border bg-mist px-2 py-1 text-xs font-medium text-muted-foreground sm:flex">
              <Command className="h-3 w-3" />
              K
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
            </span>
            <button
              onClick={() => setShowUnavailable((v) => !v)}
              title="Toggle unavailable items"
<<<<<<< HEAD
              className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${
                showUnavailable ? "bg-ember-soft text-ember" : "text-muted-foreground hover:bg-mist"
=======
              aria-label="Toggle unavailable items"
              className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
                showUnavailable
                  ? "bg-ember-soft text-ember"
                  : "text-muted-foreground hover:bg-mist"
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Category pills ── */}
      <div className="flex shrink-0 gap-2 overflow-x-auto px-5 py-3 scrollbar-none">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
            selectedCategory === null
              ? "bg-ink text-white shadow-sm"
              : "bg-mist text-muted-foreground hover:bg-border hover:text-foreground"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
              selectedCategory === cat
                ? "bg-ink text-white shadow-sm"
                : "bg-mist text-muted-foreground hover:bg-border hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* ── Menu content ── */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {search ? (
          <ProductGrid
            items={searchResults}
            onAdd={handleAdd}
            lastAddedId={lastAddedId}
            emptyText="No items match your search"
            currencySymbol={currencySymbol}
          />
        ) : (
          <div className="space-y-8">
            {sections.map((cat) => {
              const items = allItems.filter((item) => isVisible(item) && item.category === cat);
              if (items.length === 0) return null;
              return (
                <section key={cat}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-foreground">{cat}</h3>
                    <button
                      onClick={() => setSelectedCategory(cat)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-ember hover:bg-ember-soft"
                    >
                      View all
                    </button>
                  </div>
                  <ProductGrid
                    items={items}
                    onAdd={handleAdd}
                    lastAddedId={lastAddedId}
                    currencySymbol={currencySymbol}
                  />
                </section>
              );
            })}
            {sections.every(
              (cat) =>
                allItems.filter((item) => isVisible(item) && item.category === cat).length === 0,
            ) && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Coffee className="mb-3 h-10 w-10 opacity-40" />
                <p className="text-sm">No items found</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Variant / modifier capture for products that publish option groups. */}
      <ProductDetailSheet
        open={!!detailItem}
        item={detailItem}
        currencySymbol={currencySymbol}
        onClose={() => setDetailItem(null)}
        onAdd={handleSheetAdd}
        submitLabel="Add to order"
      />
    </div>
  );
}

function ProductGrid({
  items,
  onAdd,
  lastAddedId,
  emptyText,
  currencySymbol,
}: {
  items: PosMenuItem[];
  onAdd: (item: PosMenuItem) => void;
  lastAddedId: number | null;
  emptyText?: string;
  currencySymbol: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Coffee className="mb-3 h-10 w-10 opacity-40" />
        <p className="text-sm">{emptyText ?? "No items found"}</p>
      </div>
    );
  }

  return (
<<<<<<< HEAD
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 2xl:grid-cols-4">
=======
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
      {items.map((item) => {
        const justAdded = lastAddedId === item.id;
        const customizable = (item.groups ?? []).some((g) => g.is_active !== false);
        return (
          <button
            key={item.id}
            onClick={() => onAdd(item)}
            className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-ember/40 hover:shadow-[var(--shadow-card-hover)] active:scale-[0.98]"
          >
            {/* Image */}
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  crossOrigin="anonymous"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-4xl">
                  {item.emoji || "☕"}
                </div>
              )}

              {/* Badges */}
              <div className="absolute left-2 top-2 flex gap-1.5">
                {Number(item.price) === 0 && (
                  <span className="flex items-center gap-0.5 rounded-full bg-success px-2 py-0.5 text-xs font-bold text-white">
                    <Gift className="h-2.5 w-2.5" />
                    Free
                  </span>
                )}
                {item.is_featured && (
                  <span className="rounded-full bg-black/70 px-2 py-0.5 text-xs font-bold text-white backdrop-blur-sm">
                    Popular
                  </span>
                )}
                {customizable && (
                  <span className="flex items-center gap-0.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
                    <Sliders className="h-2.5 w-2.5" />
                    Options
                  </span>
                )}
                {item.loyalty_reward && (
                  <span className="rounded-full bg-ember px-2 py-0.5 text-xs font-bold text-white">
                    Loyalty
                  </span>
                )}
              </div>

              {/* Unavailable overlay */}
              {!item.is_available && (
                <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-[1px]">
                  <span className="rounded-full bg-black/70 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    Unavailable
                  </span>
                </div>
              )}

              {/* Big add button */}
              <div
                className={`absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full text-white shadow-lg transition-all ${
                  justAdded ? "scale-110 bg-success" : "bg-ember group-hover:scale-110"
                } ${!item.is_available ? "bg-muted-foreground" : ""}`}
              >
                {justAdded ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : customizable ? (
                  <Sliders className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex flex-1 flex-col gap-1 p-3">
              <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
              {item.description && (
                <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                  {item.description}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between pt-1">
<<<<<<< HEAD
                {Number(item.price) === 0 && !customizable ? (
                  <span className="text-sm font-bold text-emerald-600">FREE</span>
                ) : customizable ? (
                  <p className="text-sm font-bold text-foreground">
                    <span className="mr-1 text-[10px] font-medium text-muted-foreground">from</span>
                    {formatCurrency(fromPrice(item), currencySymbol)}
                  </p>
=======
                {Number(item.price) === 0 ? (
                  <span className="text-sm font-bold text-success">FREE</span>
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
                ) : (
                  <p className="numeric text-sm font-bold text-foreground">
                    {formatCurrency(Number(item.price), currencySymbol)}
                  </p>
                )}
                {item.points_per_item > 0 && (
                  <span className="flex items-center gap-0.5 text-xs font-medium text-amber-600">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {item.points_per_item} pts
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
