// routes/menu.tsx — Dedicated menu browsing page
import { createFileRoute } from "@tanstack/react-router";
import { useStore, cartTotal, type MenuItem } from "@/lib/store";
import { menuApi, merchantApi } from "@/lib/api";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { Plus } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { useState, useEffect, useMemo } from "react";
import { SearchBar } from "@/components/home/SearchBar";
import { CategoryChips } from "@/components/home/CategoryChips";
import { resolveMerchantPreset, type MerchantThemePreset } from "@/lib/merchant-theme-presets";
import { Link } from "@tanstack/react-router";
import { ShoppingBag } from "lucide-react";

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
  onAdd,
  disabled,
  merchantColor,
}: {
  item: MenuItem;
  onAdd: () => void;
  disabled: boolean;
  merchantColor?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;
  const price = parseFloat(item.price as any);

  return (
    <article
      className="group overflow-hidden rounded-[20px] bg-card transition-all active:scale-[0.97]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {hasImage ? (
        <div className="relative h-[120px] overflow-hidden bg-mist">
          <img
            src={item.image_url ?? undefined}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
            loading="lazy"
          />
          {item.is_featured && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-[#E85D3A] px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">
              Featured
            </span>
          )}
        </div>
      ) : (
        <div className="relative grid h-24 place-items-center bg-mist text-4xl">
          {item.emoji || "☕"}
          {item.is_featured && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-[#E85D3A] px-2.5 py-0.5 text-[9px] font-bold tracking-wide text-white shadow-sm">
              Featured
            </span>
          )}
        </div>
      )}
      <div className="flex flex-col p-3.5">
        <h3 className="text-[13px] font-semibold text-foreground line-clamp-1">{item.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{item.description}</p>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-display text-lg text-foreground">NPR {price.toLocaleString()}</span>
          <button
            onClick={onAdd}
            disabled={disabled}
            className="grid h-8 w-8 place-items-center rounded-full bg-foreground text-background transition-all active:scale-90 disabled:opacity-40"
            aria-label={`Add ${item.name}`}
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </article>
  );
}

function MenuPage() {
  const { cart, add, selectedMerchantId } = useStore();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [merchantName, setMerchantName] = useState("");
  const [merchantThemeColor, setMerchantThemeColor] = useState("");
  const [merchantBusinessType, setMerchantBusinessType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState<string>("All");
  const [search, setSearch] = useState("");

  const themePreset: MerchantThemePreset | null = useMemo(
    () => resolveMerchantPreset(merchantBusinessType),
    [merchantBusinessType]
  );

  useEffect(() => {
    if (!selectedMerchantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      menuApi
        .forMerchant(selectedMerchantId)
        .then((items) =>
          setMenuItems(
            items.map((i) => ({
              ...i,
              price: parseFloat(i.price as any),
              is_featured: (i as any).is_featured,
            }))
          )
        )
        .catch(() => setMenuItems([])),
      merchantApi
        .get(selectedMerchantId)
        .then((m) => {
          setMerchantName(m.business_name);
          setMerchantThemeColor(m.store_theme_color || "");
          setMerchantBusinessType(m.business_type ?? null);
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [selectedMerchantId]);

  const cats = useMemo(
    () => ["All", ...Array.from(new Set(menuItems.map((m) => m.category).filter(Boolean)))],
    [menuItems]
  );

  const filteredItems = useMemo(() => {
    let result = cat === "All" ? menuItems : menuItems.filter((m) => m.category === cat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [menuItems, cat, search]);

  const merchantColor = themePreset?.primary || merchantThemeColor || undefined;

  const count = cart.reduce((s, c) => s + c.qty, 0);
  const storeItems = menuItems.map((m) => ({ ...m, price: parseFloat(m.price as any) }));
  const total = cartTotal(cart, storeItems);

  return (
    <MobileShell>
      <TopBar title="Menu" />

      <div className="flex flex-col gap-4 pb-6">
        {!selectedMerchantId ? (
          <section className="px-5">
            <div className="rounded-[24px] bg-card p-8 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
              <p className="text-sm font-semibold text-foreground">No store selected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a store from the map to view its menu.
              </p>
              <Link
                to="/map"
                className="mt-5 inline-flex h-10 items-center justify-center rounded-full bg-foreground px-6 text-xs font-medium text-primary-foreground transition-all active:scale-95"
              >
                Discover stores
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="px-5">
              <SearchBar value={search} onChange={setSearch} merchantName={merchantName} />
            </section>

            <CategoryChips
              categories={cats}
              active={cat}
              onSelect={setCat}
              merchantColor={merchantColor}
            />

            {search && (
              <p className="px-5 text-xs text-muted-foreground">
                {filteredItems.length} result{filteredItems.length !== 1 ? "s" : ""} for &quot;{search}&quot;
              </p>
            )}

            <section className="px-5">
              <div className="grid grid-cols-2 gap-3">
                {loading && (
                  <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                    Loading menu…
                  </p>
                )}
                {!loading && filteredItems.length === 0 && (
                  <p className="col-span-2 py-8 text-center text-sm text-muted-foreground">
                    {search ? `No items match "${search}"` : "No menu items available."}
                  </p>
                )}
                {filteredItems.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    onAdd={() => add(item.id)}
                    disabled={!selectedMerchantId}
                    merchantColor={merchantColor}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {count > 0 && (
        <Link
          to="/cart"
          className="fixed inset-x-0 bottom-24 z-40 mx-auto flex max-w-[400px] items-center justify-between rounded-full bg-foreground px-5 py-3.5 text-primary-foreground transition-colors"
          style={{
            boxShadow: "0 8px 32px -4px rgba(0,0,0,0.25)",
            width: "calc(100% - 40px)",
          }}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <ShoppingBag className="h-4 w-4" /> {count} {count === 1 ? "item" : "items"}
          </span>
          <span className="font-display text-lg">NPR {total.toLocaleString()} →</span>
        </Link>
      )}
    </MobileShell>
  );
}
