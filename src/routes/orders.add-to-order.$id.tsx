// routes/orders.add-to-order.$id.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { ShoppingCart, Plus, Minus, X, Loader2, ArrowLeft, Zap, Sparkles } from "lucide-react";
import { requireAuth } from "@/lib/auth-guard";
import { orderApi, menuApi, type MenuItem, type Order } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import { cartKey, fromPrice, baseDiscount, lineSelectionsText } from "@/lib/menu-utils";
import type { MenuSelection } from "@/lib/api/types";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";

export const Route = createFileRoute("/orders/add-to-order/$id")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Add to order · Zentro" }] }),
  component: AddToOrderPage,
});

/**
 * One pending line. `key` identifies item + selections + instructions, so two
 * configurations of the same product stay separate instead of collapsing.
 */
interface CartLine {
  key: string;
  item: MenuItem;
  qty: number;
  selections: MenuSelection[];
  specialInstructions: string;
  unitPrice: number;
}

function AddToOrderPage() {
  if (typeof window === "undefined") return null;

  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [cartOpen, setCartOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [menuLoading, setMenuLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const currencySymbol = order?.merchant_profiles?.currency_symbol || "Rs";

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
        // Load merchant menu. `catalog` is the only public payload that carries
        // each item's variant/modifier groups; `forMerchant` omits them.
        setMenuLoading(true);
        try {
          const cat = await menuApi.catalog(data.merchant_id);
          setMenu(cat.items ?? []);
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

  function quickAdd(item: MenuItem) {
    // Only for items with no options, where one tap is unambiguous.
    const unitPrice = fromPrice(item);
    const key = cartKey(String(item.id), [], "");
    setCart((prev) => {
      const ex = prev.find((c) => c.key === key);
      return ex
        ? prev.map((c) => (c.key === key ? { ...c, qty: c.qty + 1 } : c))
        : [...prev, {
            key,
            item,
            qty: 1,
            selections: [],
            specialInstructions: "",
            unitPrice,
          }];
    });
  }

  function setQty(key: string, qty: number) {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((c) => c.key !== key)
        : prev.map((c) => (c.key === key ? { ...c, qty } : c)),
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((c) => c.key !== key));
  }

  function handleCardTap(item: MenuItem) {
    const hasOptions = (item.groups ?? []).some((g) => g.is_active !== false);
    if (!hasOptions) {
      quickAdd(item);
      return;
    }
    setEditingKey(null);
    setActiveItem(item);
  }

  function handleSheetAdd(draft: ProductDraft) {
    const key = cartKey(
      draft.itemId,
      draft.selections,
      draft.specialInstructions,
    );
    setCart((prev) => {
      if (editingKey) {
        const rest = prev.filter((c) => c.key !== editingKey);
        const item = prev.find((c) => c.key === editingKey)?.item
          ?? menu.find((m) => String(m.id) === draft.itemId);
        return item
          ? [
              ...rest,
              {
                key,
                item,
                qty: draft.qty,
                selections: draft.selections,
                specialInstructions: draft.specialInstructions,
                unitPrice: draft.unitPrice,
              },
            ]
          : rest;
      }
      const item = menu.find((m) => String(m.id) === draft.itemId);
      if (!item) return prev;
      const ex = prev.find((c) => c.key === key);
      return ex
        ? prev.map((c) => (c.key === key ? { ...c, qty: c.qty + draft.qty } : c))
        : [
            ...prev,
            {
              key,
              item,
              qty: draft.qty,
              selections: draft.selections,
              specialInstructions: draft.specialInstructions,
              unitPrice: draft.unitPrice,
            },
          ];
    });
    setEditingKey(null);
  }

  function handleEditLine(line: CartLine) {
    setEditingKey(line.key);
    setActiveItem(line.item);
  }

  const editingLine = editingKey ? cart.find((c) => c.key === editingKey) : undefined;

  const totalAmount = useMemo(
    () => cart.reduce((sum, c) => sum + c.unitPrice * c.qty, 0),
    [cart],
  );

  const totalPoints = useMemo(
    () => cart.reduce(
      (sum, c) =>
        sum + (c.item.loyalty_reward ? (c.item.points_per_item ?? 0) * c.qty : 0),
      0,
    ),
    [cart],
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
          menu_item_id: String(c.item.id),
          quantity: c.qty,
          selections: c.selections,
          special_instructions: c.specialInstructions,
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
            {(order.order_items ?? []).map((item, idx) => {
              const opts = (item.options ?? [])
                .map((o) => o.option_name)
                .join(" · ");
              return (
                <div key={idx} className="flex justify-between text-sm">
                  <span className="text-foreground">
                    {item.quantity}× {item.name}
                    {opts && (
                      <span className="ml-1 text-[11px] text-muted-foreground">{opts}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {formatCurrency(Number(item.subtotal), currencySymbol)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 border-t border-border pt-2 flex justify-between text-sm font-medium">
            <span className="text-muted-foreground">Current total</span>
            <span className="text-foreground">
              {formatCurrency(existingTotal, currencySymbol)}
            </span>
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
          {visibleMenu.map((item) => (
            <MenuCard
              key={item.id}
              item={item}
              currencySymbol={currencySymbol}
              qty={cart
                .filter((c) => String(c.item.id) === String(item.id))
                .reduce((s, c) => s + c.qty, 0)}
              onTap={() => handleCardTap(item)}
            />
          ))}
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
            <span>{formatCurrency(totalAmount, currencySymbol)}</span>
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
              {cart.map((line) => {
                const opts = lineSelectionsText(line.item, line.selections);
                return (
                  <div key={line.key} className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl">
                      {line.item.image_url ? (
                        <img
                          src={line.item.image_url}
                          alt={line.item.name}
                          className="h-full w-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-mist text-xl">
                          {line.item.emoji}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {line.item.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(line.unitPrice, currencySymbol)} each
                      </p>
                      {opts && (
                        <p className="truncate text-[11px] text-muted-foreground">{opts}</p>
                      )}
                      {line.specialInstructions && (
                        <p className="truncate text-[11px] italic text-muted-foreground">
                          “{line.specialInstructions}”
                        </p>
                      )}
                      <button
                        onClick={() => handleEditLine(line)}
                        className="mt-0.5 text-[11px] font-medium text-ember underline underline-offset-2"
                      >
                        Edit
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQty(line.key, line.qty - 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-mist text-foreground"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-4 text-center text-sm font-medium text-foreground">
                        {line.qty}
                      </span>
                      <button
                        onClick={() => setQty(line.key, line.qty + 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg bg-mist text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeLine(line.key)}
                        className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:text-rose-500"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="w-20 text-right text-sm text-foreground">
                      {formatCurrency(line.unitPrice * line.qty, currencySymbol)}
                    </span>
                  </div>
                );
              })}
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
                <span className="text-foreground">{formatCurrency(existingTotal, currencySymbol)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">New items</span>
                <span className="text-foreground">{formatCurrency(totalAmount, currencySymbol)}</span>
              </div>
              {totalPoints > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Additional points</span>
                  <span className="font-medium text-emerald-600">+{totalPoints} pts</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-medium">
                <span className="text-foreground">New total</span>
                <span className="font-display text-lg text-foreground">{formatCurrency(grandTotal, currencySymbol)}</span>
              </div>
            </div>

            <button
              onClick={submitAddItems}
              disabled={submitting || cart.length === 0}
              className="gradient-ember mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add to order · {formatCurrency(totalAmount, currencySymbol)}
            </button>
          </div>
        </div>
      )}

      {/* Variant / modifier selection for items being added to this order. */}
      <ProductDetailSheet
        open={!!activeItem}
        item={activeItem}
        currencySymbol={currencySymbol}
        onClose={() => {
          setActiveItem(null);
          setEditingKey(null);
        }}
        onAdd={handleSheetAdd}
        submitLabel={editingKey ? "Update item" : "Add to cart"}
        initialQty={editingLine?.qty}
        initialSelections={editingLine?.selections}
        initialInstructions={editingLine?.specialInstructions}
        resetKey={editingKey ?? undefined}
      />
    </div>
  );
}

// ── Menu item card ────────────────────────────────────────────────────────────
function MenuCard({
  item,
  currencySymbol,
  qty,
  onTap,
}: {
  item: MenuItem;
  currencySymbol: string;
  qty: number;
  onTap: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;
  const hasOptions = (item.groups ?? []).some((g) => g.is_active !== false);
  const discount = baseDiscount(item);

  return (
    <article
      onClick={onTap}
      className="glass-strong cursor-pointer overflow-hidden rounded-3xl transition-transform active:scale-[0.98]"
    >
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
          <p className="font-display shrink-0 text-right text-lg text-foreground">
            {hasOptions && (
              <span className="mr-1 font-sans text-[10px] text-muted-foreground">from</span>
            )}
            {formatCurrency(fromPrice(item), currencySymbol, 0)}
            {discount && (
              <span className="ml-1 block font-sans text-[11px] text-muted-foreground line-through">
                {formatCurrency(discount.original, currencySymbol, 0)}
              </span>
            )}
          </p>
        </div>

        {item.loyalty_reward && (
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            <Zap className="h-2.5 w-2.5" />
            +{item.points_per_item} pts per item
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onTap(); }}
          className="gradient-ember mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-white transition-transform active:scale-[0.98]"
        >
          {hasOptions ? <Sparkles className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {hasOptions ? "Customize" : "Add to cart"}
          {qty > 0 && (
            <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs font-bold">{qty}</span>
          )}
        </button>
      </div>
    </article>
  );
}
