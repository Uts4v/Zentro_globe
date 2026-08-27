import { useEffect, useState } from "react";
import { posTableMenu, posTableOrder, PosTableMenu } from "../api";
import { formatCurrency } from "@/lib/currency";
import { Loader2, Plus, Minus, ShoppingCart, Check, AlertCircle } from "lucide-react";

interface CartItem {
  id: number;
  name: string;
  price: string;
  quantity: number;
  emoji: string;
}

export default function TableOrderScreen() {
  // Extract token from URL path: /table/:token/order
  const token = window.location.pathname.split("/")[2];
  const [menu, setMenu] = useState<PosTableMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const currencySymbol = "Rs";

  useEffect(() => {
    loadMenu();
  }, []);

  async function loadMenu() {
    try {
      const data = await posTableMenu(token);
      setMenu(data);
      const cats = Object.keys(data.categories);
      if (cats.length > 0) setActiveCategory(cats[0]);
    } catch (err: any) {
      setError(err?.message || "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }

  function addToCart(item: PosTableMenu["categories"][string][0]) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { id: item.id, name: item.name, price: item.price, quantity: 1, emoji: item.emoji }];
    });
  }

  function updateQty(id: number, delta: number) {
    setCart((prev) => {
      const item = prev.find((c) => c.id === id);
      if (!item) return prev;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return prev.filter((c) => c.id !== id);
      return prev.map((c) => (c.id === id ? { ...c, quantity: newQty } : c));
    });
  }

  const cartTotal = cart.reduce((sum, item) => sum + parseFloat(item.price) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  async function placeOrder() {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    try {
      await posTableOrder(token, {
        items: cart.map((c) => ({ menu_item_id: c.id, quantity: c.quantity })),
        notes,
        customer_name: customerName,
      });
      setOrderPlaced(true);
    } catch (err: any) {
      setError(err?.message || "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-background px-4">
        <AlertCircle className="h-10 w-10 text-red-500 mb-4" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (orderPlaced) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center bg-background px-4">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-green-100">
          <Check className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Order Placed!</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your order has been sent to the kitchen
        </p>
        <p className="mt-1 text-lg font-bold text-foreground">
          Table {menu?.table.table_number} &middot; {menu?.table.name}
        </p>
        <button
          onClick={() => { setCart([]); setOrderPlaced(false); setNotes(""); }}
          className="mt-8 rounded-2xl bg-ink px-8 py-3 text-sm font-bold text-white hover:opacity-90"
        >
          Order More
        </button>
      </div>
    );
  }

  if (!menu) return null;

  const allItems = Array.from(
    new Map(Object.values(menu.categories).flat().map((item) => [item.id, item])).values()
  );
  const filteredItems = searchQuery
    ? allItems.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeCategory
    ? menu.categories[activeCategory] || []
    : allItems;

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">
              {menu.merchant.name} &middot; Table {menu.table.table_number}
            </p>
            <h1 className="text-lg font-bold text-foreground">{menu.table.name}</h1>
          </div>
          {cartCount > 0 && (
            <div className="relative">
              <ShoppingCart className="h-5 w-5 text-ink" />
              <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white">
                {cartCount}
              </span>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="mt-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search menu..."
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-ink focus:outline-none"
          />
        </div>
      </div>

      {/* Category tabs */}
      {!searchQuery && (
        <div className="flex gap-2 overflow-x-auto border-b border-border bg-card px-4 py-2">
          {Object.keys(menu.categories).map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                activeCategory === cat ? "bg-ink text-white" : "bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Menu items */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          {filteredItems.map((item) => {
            const inCart = cart.find((c) => c.id === item.id);
            return (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className={`rounded-2xl border bg-card p-3 text-left transition-all ${
                  inCart ? "border-ink ring-1 ring-ink" : "border-border"
                }`}
              >
                <div className="mb-2 text-2xl">{item.emoji || "🍽️"}</div>
                <p className="text-sm font-medium text-foreground line-clamp-2">{item.name}</p>
                <p className="mt-1 text-sm font-bold text-ink">{formatCurrency(item.price, currencySymbol)}</p>
                {inCart && (
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); updateQty(item.id, -1); }}
                        className="grid h-6 w-6 place-items-center rounded-full bg-muted text-foreground"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-bold">{inCart.quantity}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); updateQty(item.id, 1); }}
                        className="grid h-6 w-6 place-items-center rounded-full bg-ink text-white"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="text-xs font-bold text-ink">
                      {formatCurrency(parseFloat(item.price) * inCart.quantity, currencySymbol)}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cart footer */}
      {cartCount > 0 && (
        <div className="border-t border-border bg-card p-4 space-y-3">
          {/* Customer name */}
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm"
          />

          {/* Notes */}
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Special requests (optional)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm"
          />

          {/* Cart summary + order button */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{cartCount} items</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(cartTotal, currencySymbol)}</p>
            </div>
            <button
              onClick={placeOrder}
              disabled={placing}
              className="flex items-center gap-2 rounded-2xl bg-ink px-6 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
            >
              {placing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Place Order
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
