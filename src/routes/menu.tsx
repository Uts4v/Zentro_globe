// routes/menu.tsx — Premium menu browsing page (spec 1-21)
import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore, cartTotals, cartCount, type CartItem } from "@/lib/store";
import { menuApi, merchantApi, specialApi } from "@/lib/api";
import type { MenuCatalog, MenuItem, TodaySpecial } from "@/lib/api";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { Plus, ShoppingBag, ArrowRight, Loader2, Search, X } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { useState, useEffect, useMemo } from "react";
import { formatCurrency } from "@/lib/currency";
import { fromPrice, baseDiscount } from "@/lib/menu-utils";

export const Route = createFileRoute("/menu")({
  beforeLoad: requireAuth,
  head: () => ({
    meta: [
      { title: "Zentro — Menu" },
      { name: "description", content: "Browse the menu and add items to your cart." },
    ],
  }),
  component: MenuPage,
});

function MenuItemCard({
  item,
  currencySymbol,
  onTap,
}: {
  item: MenuItem;
  currencySymbol: string;
  onTap: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;
  const soldOut = !item.is_available;
  const price = fromPrice(item);
  const discount = baseDiscount(item);

  return (
    <article
      onClick={onTap}
      className="group relative cursor-pointer overflow-hidden rounded-[20px] bg-mist transition-transform active:scale-[0.97]"
    >
      {hasImage ? (
        <div className="relative aspect-[4/3] overflow-hidden">
          <img
            src={item.image_url ?? undefined}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        </div>
      ) : (
        <div className="relative grid aspect-[4/3] place-items-center text-6xl">
          {item.emoji || "☕"}
        </div>
      )}
      <div className="flex flex-col p-3">
        <h3 className="line-clamp-1 text-[13px] font-semibold text-foreground">{item.name}</h3>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="flex items-baseline gap-1.5">
            <span className="font-display text-[15px] text-foreground">
              {formatCurrency(price, currencySymbol, 0)}
            </span>
            {discount && (
              <span className="text-[11px] text-muted-foreground line-through">
                {formatCurrency(discount.original, currencySymbol, 0)}
              </span>
            )}
          </span>
          {soldOut ? (
            <span className="rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white">
              Sold out
            </span>
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-foreground text-background">
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
            </span>
          )}
        </div>
      </div>
      {discount?.percentLabel && (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">
          {discount.percentLabel}
        </span>
      )}
      {(item.is_featured ||
        (item.status && item.status !== "active" && item.status !== "draft")) && (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-[#E85D3A] px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">
          {item.status === "archived" ? "Archived" : "Featured"}
        </span>
      )}
    </article>
  );
}

function SpecialBanner({
  special,
  currencySymbol,
  onOrder,
}: {
  special: TodaySpecial;
  currencySymbol: string;
  onOrder: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const cta = special.cta_label || (special.linked_menu_item ? "Order now" : "View special");
  const price = special.linked_menu_item_price ? parseFloat(special.linked_menu_item_price) : null;
  const discounted =
    !price || !special.discount_value
      ? null
      : special.discount_type === "percentage"
        ? Math.max(0, price * (1 - special.discount_value / 100))
        : Math.max(0, price - special.discount_value);

  return (
    <section
      onClick={onOrder}
      className="relative cursor-pointer overflow-hidden rounded-[24px]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {special.image_url && !imgError ? (
        <img
          src={special.image_url}
          alt={special.title}
          className="h-40 w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="grid h-40 w-full place-items-center bg-gradient-to-br from-ember to-[#E85D3A] text-6xl">
          {special.linked_menu_item_name ? "⭐" : "✨"}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
          Today&apos;s special
        </p>
        <h2 className="font-display mt-1 text-2xl leading-tight text-white">{special.title}</h2>
        {special.description && (
          <p className="mt-1 line-clamp-1 text-xs text-white/70">{special.description}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          {price != null && (
            <div className="flex items-baseline gap-2">
              {discounted != null && (
                <span className="text-lg font-bold text-emerald-300">
                  {formatCurrency(discounted, currencySymbol, 0)}
                </span>
              )}
              <span
                className={
                  discounted != null ? "text-xs text-white/60 line-through" : "text-sm text-white"
                }
              >
                {formatCurrency(price, currencySymbol, 0)}
              </span>
            </div>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black">
            {cta} <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
    </section>
  );
}

function MenuPage() {
  const { cart, addLine } = useStore();
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [specials, setSpecials] = useState<TodaySpecial[]>([]);

  useEffect(() => {
    const stored = useStore.getState().selectedMerchantId;
    setSelectedMerchantId(stored);

    const unsub = useStore.subscribe((s) => {
      setSelectedMerchantId(s.selectedMerchantId);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!selectedMerchantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      menuApi
        .catalog(selectedMerchantId)
        .then(setCatalog)
        .catch(() => setCatalog(null)),
      merchantApi
        .get(selectedMerchantId)
        .then((m) => {
          if (m.slug)
            specialApi
              .forSlug(m.slug)
              .then(setSpecials)
              .catch(() => setSpecials([]));
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [selectedMerchantId]);

  const merchant = catalog?.merchant;
  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const currencySymbol = merchant?.currency_symbol || "Rs";

  const cats = useMemo(() => {
    if (!catalog) return [{ name: "All", emoji: "✦" }];
    const fromCategories = catalog.categories
      .filter((c) => c.is_active !== false)
      .map((c) => ({ name: c.name, emoji: c.emoji || "🍽️" }));
    const names = new Set<string>();
    for (const it of items) if (it.category) names.add(it.category);
    const extra = Array.from(names)
      .filter((n) => !fromCategories.some((c) => c.name === n))
      .map((n) => ({ name: n, emoji: "🍽️" }));
    return [{ name: "All", emoji: "✦" }, ...fromCategories, ...extra];
  }, [catalog, items]);

  const filteredItems = useMemo(() => {
    let result = cat === "All" ? items : items.filter((m) => m.category === cat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q) ||
          (m.short_description ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [items, cat, search]);

  const merchantColor = merchant?.store_theme_color;

  const count = cartCount(cart);
  const total = cartTotals(cart);

  function openItem(item: MenuItem) {
    setActiveItem(item);
  }

  function handleAdd(draft: ProductDraft) {
    addLine({
      itemId: draft.itemId,
      qty: draft.qty,
      selections: draft.selections,
      specialInstructions: draft.specialInstructions,
      unitPrice: draft.unitPrice,
    });
  }

  return (
    <MobileShell>
      <TopBar title="Menu" />

      <div className="flex flex-col gap-4 pb-6">
        {!selectedMerchantId ? (
          <section className="px-5">
            <div className="rounded-[24px] bg-mist p-8 text-center">
              <p className="text-sm font-semibold text-foreground">No store selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a store from the map to view its menu.
              </p>
              <Link
                to="/map"
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-6 text-xs font-medium text-background transition-all active:scale-95"
              >
                Discover stores
              </Link>
            </div>
          </section>
        ) : (
          <>
            {/* Today's Special banner */}
            {specials.length > 0 && (
              <section className="px-5">
                <SpecialBanner
                  special={specials[0]}
                  currencySymbol={currencySymbol}
                  onOrder={() => {
                    const linked = specials[0].linked_menu_item
                      ? items.find((i) => String(i.id) === String(specials[0].linked_menu_item))
                      : undefined;
                    if (linked) openItem(linked);
                  }}
                />
              </section>
            )}

            {/* Search */}
            <section className="px-5">
              <div className="flex h-12 items-center gap-2 rounded-2xl bg-mist px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={merchant ? `Search ${merchant.name}…` : "Search menu…"}
                  className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="Clear search">
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
            </section>

            {/* Category pills */}
            <section className="flex gap-2 overflow-x-auto px-5 pb-1">
              {cats.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setCat(c.name)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                    cat === c.name ? "text-background" : "bg-mist text-foreground"
                  }`}
                  style={
                    cat === c.name
                      ? { backgroundColor: merchantColor || "var(--foreground)" }
                      : undefined
                  }
                >
                  {c.emoji} {c.name}
                </button>
              ))}
            </section>

            {search && (
              <p className="px-5 text-xs text-muted-foreground">
                {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""} for &quot;
                {search}&quot;
              </p>
            )}

            <section className="px-5">
              {loading && (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && !catalog && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Couldn&apos;t load this menu right now.
                </p>
              )}
              {!loading && catalog && filteredItems.length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  {search ? `No items match "${search}"` : "No menu items available."}
                </p>
              )}
              {catalog && filteredItems.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {filteredItems.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      currencySymbol={currencySymbol}
                      onTap={() => openItem(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Sticky cart bar */}
      {count > 0 && (
        <Link
          to="/cart"
          className="fixed inset-x-0 bottom-24 z-40 mx-auto flex max-w-[400px] items-center justify-between rounded-full px-5 py-3.5 text-background transition-colors"
          style={{
            backgroundColor: merchantColor || "var(--foreground)",
            boxShadow: "0 8px 32px -4px rgba(0,0,0,0.25)",
            width: "calc(100% - 40px)",
          }}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShoppingBag className="h-4 w-4" /> {count} {count === 1 ? "item" : "items"}
          </span>
          <span className="font-display text-lg">{formatCurrency(total, currencySymbol, 0)} →</span>
        </Link>
      )}

      <ProductDetailSheet
        open={!!activeItem}
        item={activeItem}
        currencySymbol={currencySymbol}
        onClose={() => setActiveItem(null)}
        onAdd={handleAdd}
      />
    </MobileShell>
  );
}
