// routes/guest.merchant.$slug.tsx — Guest menu browsing & ordering (no auth required)
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Loader2, Plus, Minus, ShoppingBag, Search, X as XIcon,
  MapPin, Utensils, ArrowRight, SendHorizontal,
} from "lucide-react";
import { menuApi, merchantApi, type MerchantProfile } from "@/lib/api";
import { useStore, cartTotal, type MenuItem } from "@/lib/store";

export const Route = createFileRoute("/guest/merchant/$slug")({
  head: () => ({ meta: [{ title: "Order · Zentro" }] }),
  component: GuestMerchantMenu,
});

function GuestMenuItemCard({
  item,
  qty,
  onAdd,
  onRemove,
}: {
  item: MenuItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;
  const price = parseFloat(item.price as any);

  return (
    <article className="glass group relative flex flex-col rounded-3xl overflow-hidden">
      {hasImage ? (
        <img
          src={item.image_url ?? undefined}
          alt={item.name}
          className="h-32 w-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="mb-0 grid h-24 place-items-center rounded-t-3xl bg-mist text-5xl">
          {item.emoji || "☕"}
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-sm font-semibold text-foreground">{item.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{item.description}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-display text-xl text-foreground">
            NPR {price.toLocaleString()}
          </span>
          {qty === 0 ? (
            <button
              onClick={onAdd}
              className="grid h-9 w-9 place-items-center rounded-full bg-ink text-primary-foreground transition-transform active:scale-90"
              aria-label={`Add ${item.name}`}
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onRemove}
                className="grid h-8 w-8 place-items-center rounded-full bg-muted text-foreground transition-transform active:scale-90"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[20px] text-center text-sm font-semibold text-foreground">{qty}</span>
              <button
                onClick={onAdd}
                className="grid h-8 w-8 place-items-center rounded-full bg-ink text-primary-foreground transition-transform active:scale-90"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function GuestMerchantMenu() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const { cart, add, remove, activeTable, guestSession, setGuestName, placeGuestOrder } = useStore();

  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [showCheckout, setShowCheckout] = useState(false);
  const [guestName, setLocalGuestName] = useState(guestSession?.guestName || "");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ orderId: string; tableNum: number } | null>(null);

  // Load merchant + menu
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      merchantApi.bySlug(slug).then((m) => { if (!cancelled) setMerchant(m); }),
      merchantApi.bySlug(slug).then((m) =>
        menuApi.forMerchant(String(m.id)).then((items) => {
          if (!cancelled) setMenuItems(items.map((i) => ({
            id: String(i.id),
            name: i.name,
            description: i.description ?? "",
            price: Number(i.price),
            category: i.category ?? "",
            emoji: i.emoji ?? "☕",
            points_per_item: i.points_per_item ?? 0,
            is_available: i.is_available,
            image_url: i.image_url,
          })));
        })
      ),
    ]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const cats = useMemo(
    () => ["All", ...Array.from(new Set(menuItems.map((m) => m.category).filter(Boolean)))],
    [menuItems],
  );

  const filteredItems = useMemo(() => {
    let result = cat === "All" ? menuItems : menuItems.filter((m) => m.category === cat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (m) => m.name.toLowerCase().includes(q) || (m.description ?? "").toLowerCase().includes(q),
      );
    }
    return result;
  }, [menuItems, cat, search]);

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const total = cartTotal(cart, menuItems);

  // If no table context, redirect to home
  useEffect(() => {
    if (!loading && !activeTable) {
      navigate({ to: "/", replace: true });
    }
  }, [loading, activeTable, navigate]);

  async function handlePlaceOrder() {
    if (placing || cart.length === 0 || !activeTable) return;
    setPlacing(true);
    try {
      setGuestName(guestName);
      const orderId = await placeGuestOrder(menuItems, notes, guestName);
      setOrderSuccess({ orderId, tableNum: activeTable.tableId });
    } catch (err: any) {
      alert(err?.message || "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }

  // Order success screen
  if (orderSuccess) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-5 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="font-display text-3xl text-foreground">Order Placed!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your order has been sent to the kitchen.
        </p>
        {activeTable && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-muted/60 px-4 py-2">
            <Utensils className="h-4 w-4 text-ember" />
            <span className="text-sm font-medium">Table {activeTable.tableName}</span>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Order #{orderSuccess.orderId}</p>
        <button
          onClick={() => { setOrderSuccess(null); }}
          className="mt-8 flex h-12 items-center gap-2 rounded-2xl bg-foreground px-8 text-sm font-medium text-background active:scale-[0.98]"
        >
          Order More <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Checkout sheet
  if (showCheckout) {
    return (
      <div className="mx-auto min-h-dvh max-w-[480px] bg-background px-5 pb-10 pt-5">
        <button onClick={() => setShowCheckout(false)} className="mb-4 text-sm text-muted-foreground hover:text-foreground">
          ← Back to menu
        </button>

        <h1 className="font-display text-2xl text-foreground">Checkout</h1>

        {/* Table info */}
        {activeTable && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-3">
            <Utensils className="h-4 w-4 text-ember" />
            <span className="text-sm font-medium text-foreground">Table {activeTable.tableName}</span>
          </div>
        )}

        {/* Name field */}
        <div className="mt-5">
          <label className="text-xs font-medium text-muted-foreground">Your Name (optional)</label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setLocalGuestName(e.target.value)}
            placeholder="e.g. Alex"
            className="mt-1.5 h-12 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>

        {/* Notes */}
        <div className="mt-4">
          <label className="text-xs font-medium text-muted-foreground">Special Requests</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any allergies or special requests..."
            rows={2}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/20 resize-none"
          />
        </div>

        {/* Order summary */}
        <div className="mt-5 space-y-2 rounded-2xl bg-muted/30 p-4">
          {cart.map((c) => {
            const item = menuItems.find((m) => m.id === c.itemId);
            if (!item) return null;
            return (
              <div key={c.itemId} className="flex justify-between text-sm">
                <span className="text-foreground">{c.qty}× {item.name}</span>
                <span className="font-medium text-foreground">NPR {(item.price * c.qty).toFixed(2)}</span>
              </div>
            );
          })}
          <div className="border-t border-border pt-2 mt-2">
            <div className="flex justify-between text-base font-bold">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">NPR {total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <button
          onClick={handlePlaceOrder}
          disabled={placing || cart.length === 0}
          className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-foreground text-base font-medium text-background transition-all active:scale-[0.98] disabled:opacity-40"
        >
          {placing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <SendHorizontal className="h-5 w-5" />
              Place Order — NPR {total.toFixed(2)}
            </>
          )}
        </button>
      </div>
    );
  }

  // Main menu view
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl text-foreground">{merchant?.business_name || "Menu"}</h1>
            {activeTable && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Utensils className="h-3 w-3 text-ember" />
                <span className="text-xs font-medium text-muted-foreground">
                  Table {activeTable.tableName}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowCheckout(true)}
            disabled={cartCount === 0}
            className="relative flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
          >
            <ShoppingBag className="h-4 w-4" />
            {cartCount > 0 && (
              <>
                <span>{cartCount}</span>
                <span className="text-xs opacity-70">· NPR {total.toFixed(0)}</span>
              </>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search menu..."
            className="h-10 w-full rounded-xl bg-muted/50 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-foreground/10"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
              <XIcon className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Categories */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                cat === c
                  ? "bg-foreground text-background"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Membership banner (subtle, not blocking) */}
      <div className="mx-5 mt-2 rounded-2xl border border-amber-200 bg-amber-50/50 p-3">
        <p className="text-xs text-amber-700">
          <span className="font-semibold">Join Zentro</span> — earn points on every order, unlock rewards & member-only offers.{" "}
          <Link to="/auth/signup" search={{ redirect: `/customer/merchant/${slug}` }} className="font-semibold underline">
            Join Free →
          </Link>
        </p>
      </div>

      {/* Menu grid */}
      <div className="px-5 mt-4 pb-32">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-4xl mb-2">🍽</p>
            <p className="text-sm text-muted-foreground">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredItems.map((item) => {
              const cartEntry = cart.find((c) => c.itemId === item.id);
              return (
                <GuestMenuItemCard
                  key={item.id}
                  item={item}
                  qty={cartEntry?.qty ?? 0}
                  onAdd={() => add(item.id)}
                  onRemove={() => remove(item.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-20 flex justify-center px-5 pb-5">
          <button
            onClick={() => setShowCheckout(true)}
            className="flex w-full max-w-[460px] items-center justify-between rounded-2xl bg-foreground px-6 py-4 text-background shadow-xl transition-all active:scale-[0.98]"
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <ShoppingBag className="h-4 w-4" /> {cartCount} {cartCount === 1 ? "item" : "items"}
            </span>
            <span className="font-display text-lg">NPR {total.toLocaleString()} →</span>
          </button>
        </div>
      )}
    </div>
  );
}
