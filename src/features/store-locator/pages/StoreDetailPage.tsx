// src/features/stores/StoreDetailPage.tsx
// (or wherever your StoreDetailPage component lives)
import { Link, useNavigate } from "@tanstack/react-router";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { ArrowLeft, Plus, ShoppingCart, Loader2, Star } from "lucide-react";
import { merchantApi, menuApi, type MerchantProfile, type MenuItem } from "@/lib/api";
import { useStore, cartTotal, cartPoints } from "@/lib/store";
import { TodaySpecialPopup } from "@/components/TodaySpecialPopup";
import { useState, useEffect, useMemo } from "react";
import { Route } from "@/routes/stores_.$id";

export function StoreDetailPage() {
  const { id } = Route.useParams();
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addedId, setAddedId] = useState<string | null>(null);

  const { cart, add, setSelectedMerchant } = useStore();
  const nav = useNavigate();

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [profile, menuItems] = await Promise.all([
        merchantApi.get(id),
        menuApi.forMerchant(id),
      ]);
      setMerchant(profile);
      setItems(menuItems);
    } catch (e: any) {
      setError(e.message || "Failed to load store");
    } finally {
      setLoading(false);
    }
  }

  const storeMenuItems = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        price: parseFloat(i.price),
        category: i.category,
        emoji: i.emoji,
        points_per_item: i.points_per_item,
        is_available: i.is_available,
        image_url: i.image_url,
      })),
    [items],
  );

  const total = cartTotal(cart, storeMenuItems);
  const points = cartPoints(cart, storeMenuItems);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  function handleAdd(item: MenuItem) {
    setSelectedMerchant(id);
    add(item.id);
    setAddedId(item.id);
    setTimeout(() => setAddedId(null), 800);
  }

  function handleOrderFromSpecial(menuItemId: string) {
    const item = items.find((i) => i.id === menuItemId);
    if (item) {
      handleAdd(item);
      // Scroll to the item in the menu
      setTimeout(() => {
        const el = document.getElementById(`menu-item-${menuItemId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }

  if (loading) {
    return (
      <MobileShell>
        <TopBar
          right={
            <Link to="/stores" className="glass grid h-9 w-9 place-items-center rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          }
        />
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </MobileShell>
    );
  }

  if (error || !merchant) {
    return (
      <MobileShell>
        <TopBar
          right={
            <Link to="/stores" className="glass grid h-9 w-9 place-items-center rounded-full">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          }
        />
        <div className="px-5">
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error || "Store not found"}
            <button onClick={load} className="ml-2 underline">
              Retry
            </button>
          </div>
        </div>
      </MobileShell>
    );
  }

  const categories = items.reduce<Record<string, MenuItem[]>>((acc, item) => {
    const cat = item.category || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {});

  return (
    <MobileShell>
      {/* Today's Special popup — shown once per session per merchant */}
      {merchant.slug && (
        <TodaySpecialPopup slug={merchant.slug} onOrderItem={handleOrderFromSpecial} />
      )}

      <TopBar
        title={merchant.business_name}
        right={
          <Link to="/stores" className="glass grid h-9 w-9 place-items-center rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />

      {/* Hero banner */}
      <div className="relative h-40 overflow-hidden bg-gradient-to-br from-ember/30 to-ember-soft">
        {merchant.banner_url ? (
          <img src={merchant.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full place-items-center text-7xl">
            {getEmoji(merchant.business_type ?? "")}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/80 to-transparent p-4">
          <h1 className="font-display text-2xl text-white drop-shadow-md">
            {merchant.business_name}
          </h1>
          <p className="text-xs text-white/80">{merchant.business_type}</p>
        </div>
        <span
          className={`absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            merchant.is_open ? "bg-emerald-500/90 text-white" : "bg-black/40 text-white/80"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${merchant.is_open ? "bg-white" : "bg-white/50"}`}
          />
          {merchant.is_open ? "Open" : "Closed"}
        </span>
      </div>

      {merchant.description && (
        <p className="px-5 pt-4 text-sm text-muted-foreground">{merchant.description}</p>
      )}
      {merchant.address && (
        <p className="px-5 pt-1 text-xs text-muted-foreground">📍 {merchant.address}</p>
      )}

      {/* Menu */}
      <div className="mt-6 px-5 pb-32">
        <h2 className="font-display text-xl text-foreground">Menu</h2>

        {items.length === 0 ? (
          <div className="glass mt-4 rounded-3xl py-16 text-center">
            <p className="text-4xl">📋</p>
            <p className="mt-3 text-sm text-muted-foreground">No items on the menu yet</p>
          </div>
        ) : (
          Object.entries(categories).map(([cat, catItems]) => (
            <div key={cat} className="mt-5">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{cat}</p>
              <div className="mt-2 space-y-2">
                {catItems.map((item) => {
                  const inCart = cart.find((c) => c.itemId === item.id);
                  const justAdded = addedId === item.id;
                  return (
                    <div
                      key={item.id}
                      id={`menu-item-${item.id}`}
                      className="glass flex items-center gap-3 rounded-2xl p-3"
                    >
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-mist text-2xl">
                        {item.emoji || "🍽️"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {item.name}
                        </p>
                        {item.description && (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-display text-base text-foreground">
                            NPR {Number(item.price).toLocaleString()}
                          </span>
                          {item.points_per_item > 0 && (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-ember-soft px-2 py-0.5 text-[10px] font-medium text-ember">
                              <Star className="h-2.5 w-2.5 fill-ember" /> {item.points_per_item} pts
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleAdd(item)}
                        className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all ${
                          justAdded
                            ? "bg-emerald-500 text-white scale-110"
                            : inCart
                              ? "bg-ink text-primary-foreground"
                              : "glass hover:bg-ink hover:text-primary-foreground"
                        }`}
                      >
                        {justAdded ? (
                          <span className="text-sm">✓</span>
                        ) : inCart ? (
                          <span className="text-xs font-bold">{inCart.qty}</span>
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-50 mx-auto max-w-[440px] px-5">
          <button
            onClick={() => nav({ to: "/cart" })}
            className="flex w-full items-center justify-between rounded-2xl bg-ink px-5 py-4 text-primary-foreground shadow-ember transition-transform active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <ShoppingCart className="h-5 w-5" />
              <span className="text-sm font-medium">
                {cartCount} item{cartCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/70">+{points} pts</span>
              <span className="font-display text-lg">NPR {total.toLocaleString()}</span>
            </div>
          </button>
        </div>
      )}
    </MobileShell>
  );
}

function getEmoji(businessType: string): string {
  const t = businessType?.toLowerCase() || "";
  if (t.includes("bakery") || t.includes("pastry")) return "🥐";
  if (t.includes("matcha") || t.includes("tea")) return "🍵";
  if (t.includes("roaster") || t.includes("coffee")) return "🫘";
  return "☕";
}
