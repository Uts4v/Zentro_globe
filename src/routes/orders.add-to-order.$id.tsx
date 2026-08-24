// routes/orders.add-to-order.$id.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { ShoppingCart, Plus, Minus, X, Loader2, ArrowLeft, Zap } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { orderApi, menuApi, type MenuItem, type Order } from "@/lib/api";

export const Route = createFileRoute("/orders/add-to-order/$id")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Add to order · Zentro" }] }),
  component: AddToOrderPage,
});

interface CartItem {
  item: Pick<MenuItem, "id" | "name" | "price" | "description" | "category"> & {
    image_url?: string | null;
    emoji?: string;
    loyalty_reward?: boolean;
    points_per_item?: number;
  };
  qty: number;
}

function AddToOrderPage() {
  if (typeof window === "undefined") return null;

  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuLoading, setMenuLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Load existing order
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await orderApi.get(id);
        if (!data.can_add_items) {
          setError("Items can no longer be added to this order.");
          return;
        }
        setOrder(data);
        // Load merchant menu
        setMenuLoading(true);
        try {
          const items = await menuApi.forMerchant(data.merchant_id);
          setMenu(items);
        } catch (e: any) {
          setError(e.message);
        } finally {
          setMenuLoading(false);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load order");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  function addToCart(item: CartItem["item"]) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) return prev.map((c) => c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { item, qty: 1 }];
    });
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === itemId);
      if (!existing) return prev;
      if (existing.qty === 1) return prev.filter((c) => c.item.id !== itemId);
      return prev.map((c) => c.item.id === itemId ? { ...c, qty: c.qty - 1 } : c);
    });
  }

  function clearFromCart(itemId: string) {
    setCart((prev) => prev.filter((c) => c.item.id !== itemId));
  }

  const totalAmount = useMemo(
    () => cart.reduce((sum, c) => sum + Number(c.item.price) * c.qty, 0),
    [cart]
  );

  const totalPoints = useMemo(
    () => cart.reduce((sum, c) => sum + (c.item.loyalty_reward ? (c.item.points_per_item ?? 0) * c.qty : 0), 0),
    [cart]
  );

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(menu.map((i) => i.category).filter(Boolean)))],
    [menu]
  );

  const visibleMenu = filterCat === "All" ? menu : menu.filter((i) => i.category === filterCat);

  const existingTotal = order ? Number(order.total_amount) : 0;
  const grandTotal = existingTotal + totalAmount;

  async function submitAddItems() {
    if (cart.length === 0 || !order) return;
    setSubmitting(true);
    setError("");
    try {
      await orderApi.addToOrder(
        order.id,
        cart.map((c) => ({
          menu_item_id: c.item.id,
          quantity: c.qty,
        })),
        notes,
      );
      setSuccess(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Success screen
  if (success) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 text-center px-5">
        <div className="glass-strong rounded-3xl p-10">
          <p className="text-6xl">✅</p>
          <h2 className="font-display mt-4 text-3xl text-foreground">Items added!</h2>
          <p className="mt-2 text-muted-foreground">
            Your order <span className="font-medium text-foreground">#{String(order?.id).slice(0, 8)}</span> has been updated
          </p>
          {totalPoints > 0 && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-700">
              <Zap className="h-4 w-4" />
              +{totalPoints} additional points
            </div>
          )}
          <button
            onClick={() => navigate({ to: "/orders/$id", params: { id: order?.id ?? id } })}
            className="gradient-ember mt-8 h-11 w-full rounded-2xl text-sm font-medium text-white"
          >
            Back to order
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="space-y-6 px-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/orders/$id", params: { id } })} className="glass grid h-9 w-9 place-items-center rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Add items</p>
        </div>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Error / not found
  if (error && !order) {
    return (
      <div className="space-y-6 px-5">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate({ to: "/orders/$id", params: { id } })} className="glass grid h-9 w-9 place-items-center rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Add items</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button onClick={() => navigate({ to: "/orders/$id", params: { id } })} className="ml-2 underline">Go back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 px-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <button
            onClick={() => navigate({ to: "/orders/$id", params: { id: order?.id ?? id } })}
            className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            ← Back to order
          </button>
          <h1 className="font-display mt-1 text-4xl text-foreground">Add items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order #{String(order?.id).slice(0, 8)} · {order?.merchant_profiles?.business_name}
          </p>
        </div>

        {/* Cart button */}
        <button
          onClick={() => setCartOpen(true)}
          className="relative inline-flex h-11 items-center gap-2 rounded-2xl bg-ink px-5 text-sm font-medium text-primary-foreground"
        >
          <ShoppingCart className="h-4 w-4" />
          Cart
          {cartCount > 0 && (
            <span className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          )}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {/* Existing order items summary */}
      {order && (
        <div className="glass rounded-2xl p-4">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">Current order</p>
          <div className="space-y-1">
            {(order.order_items ?? []).map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-foreground">{item.quantity}× {item.name}</span>
                <span className="text-muted-foreground">NPR {Number(item.subtotal).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-border pt-2 flex justify-between text-sm font-medium">
            <span className="text-muted-foreground">Current total</span>
            <span className="text-foreground">NPR {existingTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === cat
                  ? "bg-ink text-primary-foreground"
                  : "bg-mist text-foreground hover:bg-ink/10"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Menu grid */}
      {menuLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : visibleMenu.length === 0 ? (
        <div className="glass rounded-3xl py-16 text-center text-sm text-muted-foreground">
          No items available
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleMenu.map((item) => {
            const inCart = cart.find((c) => c.item.id === item.id);
            return (
              <MenuCard
                key={item.id}
                item={item}
                qty={inCart?.qty ?? 0}
                onAdd={() => addToCart(item)}
                onRemove={() => removeFromCart(item.id)}
              />
            );
          })}
        </div>
      )}

      {/* Floating cart summary bar */}
      {cartCount > 0 && !cartOpen && (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
          <button
            onClick={() => setCartOpen(true)}
            className="gradient-ember inline-flex items-center gap-4 rounded-2xl px-6 py-3.5 text-sm font-medium text-white shadow-lg"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white/20 text-xs font-bold">
              {cartCount}
            </span>
            Add to order
            <span>NPR {totalAmount.toLocaleString()}</span>
          </button>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && setCartOpen(false)}
        >
          <div className="glass-strong w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-display text-2xl text-foreground">Add items</h2>
              <button
                onClick={() => setCartOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-60 space-y-3 overflow-y-auto pr-1">
              {cart.map(({ item, qty }) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-mist text-xl">
                        {item.emoji}
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      NPR {Number(item.price).toLocaleString()} each
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-mist text-foreground"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-4 text-center text-sm font-medium text-foreground">{qty}</span>
                    <button
                      onClick={() => addToCart(item)}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-mist text-foreground"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => clearFromCart(item.id)}
                      className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:text-rose-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="w-20 text-right text-sm text-foreground">
                    NPR {(Number(item.price) * qty).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Notes */}
            <div className="mt-4">
              <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">
                Notes for new items (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Extra hot, no sugar…"
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-white/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
              />
            </div>

            {/* Summary */}
            <div className="mt-4 space-y-1.5 rounded-2xl bg-mist p-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current order</span>
                <span className="text-foreground">NPR {existingTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">New items</span>
                <span className="text-foreground">NPR {totalAmount.toLocaleString()}</span>
              </div>
              {totalPoints > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Additional points</span>
                  <span className="font-medium text-emerald-600">+{totalPoints} pts</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span className="text-foreground">New total</span>
                <span className="font-display text-lg text-foreground">NPR {grandTotal.toLocaleString()}</span>
              </div>
            </div>

            <button
              onClick={submitAddItems}
              disabled={submitting || cart.length === 0}
              className="gradient-ember mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to order · NPR {totalAmount.toLocaleString()}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Menu item card ────────────────────────────────────────────────────────────
function MenuCard({
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

  return (
    <article className="glass-strong rounded-3xl overflow-hidden">
      {hasImage ? (
        <img
          src={item.image_url}
          alt={item.name}
          className="h-40 w-full object-cover"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      ) : (
        <div className="flex h-32 items-center justify-center bg-mist text-5xl">
          {item.emoji}
        </div>
      )}

      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              {hasImage && <span className="text-lg">{item.emoji}</span>}
              <h3 className="font-display text-lg leading-tight text-foreground">{item.name}</h3>
            </div>
            {item.description && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{item.description}</p>
            )}
          </div>
          <p className="font-display shrink-0 text-lg text-foreground">
            NPR {Number(item.price).toLocaleString()}
          </p>
        </div>

        {item.loyalty_reward && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <Zap className="h-2.5 w-2.5" />
            +{item.points_per_item} pts per item
          </div>
        )}

        <div className="mt-4">
          {qty === 0 ? (
            <button
              onClick={onAdd}
              className="gradient-ember h-10 w-full rounded-xl text-sm font-medium text-white transition-transform active:scale-[0.98]"
            >
              Add to cart
            </button>
          ) : (
            <div className="flex items-center justify-between rounded-xl bg-mist px-2 py-1.5">
              <button
                onClick={onRemove}
                className="grid h-8 w-8 place-items-center rounded-lg bg-white text-foreground shadow-sm"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="font-display text-lg text-foreground">{qty}</span>
              <button
                onClick={onAdd}
                className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-primary-foreground shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
