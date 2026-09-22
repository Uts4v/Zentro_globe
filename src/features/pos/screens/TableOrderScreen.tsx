import { useEffect, useState } from "react";
import { posTableMenu, posTableOrder, PosTableMenu, PosTableGroup } from "../api";
import { formatCurrency } from "@/lib/currency";
import { Loader2, Plus, Minus, ShoppingCart, Check, AlertCircle, Sliders } from "lucide-react";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";
import { lineSelectionsText, lineUnitPrice, baseDiscount } from "@/lib/menu-utils";
import type { MenuItem } from "@/lib/api";

interface CartLine {
  key: string;
  id: number;
  name: string;
  price: string;
  quantity: number;
  emoji: string;
  selections: Array<{ group_id: number | string; option_id: number | string }>;
  selectionsText: string;
  groups: PosTableGroup[];
  unitPrice: number;
  specialInstructions: string;
  discount_type?: "none" | "percentage" | "fixed";
  discount_value?: string | null;
  discount_price?: string | null;
  discount_amount?: string | null;
}

interface SheetSource {
  id: number;
  name: string;
  description: string;
  price: string;
  image_url: string;
  emoji: string;
  is_featured: boolean;
  groups: PosTableGroup[];
  discount_type?: "none" | "percentage" | "fixed";
  discount_value?: string | null;
  discount_price?: string | null;
  discount_amount?: string | null;
}

function toSheetItem(item: SheetSource): MenuItem {
  return {
    id: String(item.id),
    merchant_id: "",
    name: item.name,
    description: item.description,
    short_description: "",
    price: item.price,
    image_url: item.image_url,
    category: "",
    emoji: item.emoji || "🍽️",
    dietary_tags: [] as string[],
    allergens: [] as string[],
    is_available: true,
    is_featured: item.is_featured,
    category_id: null as number | null,
    from_price: item.price,
    discount_type: item.discount_type,
    discount_value: item.discount_value ?? null,
    discount_price: item.discount_price ?? null,
    discount_amount: item.discount_amount ?? null,
    points_per_item: 0,
    loyalty_reward: false,
    created_at: "",
    updated_at: "",
    groups: (item.groups || []).map((g) => ({
      id: String(g.id),
      merchant_id: "",
      menu_item: null,
      name: g.name,
      kind: g.kind,
      required: g.required,
      min_select: g.min_select,
      max_select: g.max_select,
      is_active: true,
      display_order: 0,
      options: g.options.map((o) => ({
        id: String(o.id),
        merchant_id: "",
        group: null,
        name: o.name,
        sku: null,
        price: o.price,
        price_delta: o.price_delta ?? null,
        is_default: o.is_default,
        is_available: true,
        display_order: 0,
      })),
    })),
  };
}

function keyFor(
  id: number,
  selections: Array<{ group_id: number | string; option_id: number | string }>,
): string {
  return `${id}:${selections
    .map((s) => `${s.group_id}x${s.option_id}`)
    .sort()
    .join(",")}`;
}

export default function TableOrderScreen() {
  const token = window.location.pathname.split("/")[2];
  const [menu, setMenu] = useState<PosTableMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [notes, setNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("");
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [customising, setCustomising] = useState<{
    item: SheetSource;
    lineKey: string | null;
  } | null>(null);
  const currencySymbol = "Rs";

  useEffect(() => {
    loadMenu();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMenu() {
    try {
      const data = await posTableMenu(token);
      setMenu(data);
      const cats = Object.keys(data.categories);
      if (cats.length > 0) setActiveCategory(cats[0]);
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "Failed to load menu");
    } finally {
      setLoading(false);
    }
  }

  function addSimple(item: PosTableMenu["categories"][string][0]) {
    setCart((prev) => {
      const existing = prev.find((c) => c.key === keyFor(item.id, []));
      if (existing) {
        return prev.map((c) => (c.key === existing.key ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [
        ...prev,
        {
          key: keyFor(item.id, []),
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          emoji: item.emoji || "🍽️",
          selections: [],
          selectionsText: "",
          groups: item.groups || [],
          unitPrice: lineUnitPrice(toSheetItem(item), []),
          specialInstructions: "",
          discount_type: item.discount_type,
          discount_value: item.discount_value ?? null,
          discount_price: item.discount_price ?? null,
          discount_amount: item.discount_amount ?? null,
        },
      ];
    });
  }

  function handleItemTap(item: PosTableMenu["categories"][string][0]) {
    if ((item.groups || []).length > 0) {
      setCustomising({ item, lineKey: null });
    } else {
      addSimple(item);
    }
  }

  function handleEditTap(line: CartLine) {
    setCustomising({
      item: {
        id: line.id,
        name: line.name,
        description: "",
        price: line.price,
        image_url: "",
        emoji: line.emoji,
        is_featured: false,
        groups: line.groups,
        discount_type: line.discount_type,
        discount_value: line.discount_value ?? null,
        discount_price: line.discount_price ?? null,
        discount_amount: line.discount_amount ?? null,
      },
      lineKey: line.key,
    });
  }

  function handleDraft(draft: ProductDraft) {
    if (!customising) return;
    setCart((prev) => {
      const sels = draft.selections;
      const key = keyFor(Number(draft.itemId), sels);
      const existing = prev.find((c) => c.key === key);
      if (existing) {
        return prev.map((c) => (c.key === key ? { ...c, quantity: c.quantity + draft.qty } : c));
      }
      const item = customising.item;
      const groups = item.groups || [];
      return [
        ...prev,
        {
          key,
          id: Number(draft.itemId),
          name: item.name,
          price: String(draft.unitPrice),
          quantity: draft.qty,
          emoji: item.emoji || "🍽️",
          selections: sels,
          selectionsText: lineSelectionsText(toSheetItem(item), draft.selections),
          groups,
          unitPrice: draft.unitPrice,
          specialInstructions: draft.specialInstructions,
          discount_type: item.discount_type,
          discount_value: item.discount_value ?? null,
          discount_price: item.discount_price ?? null,
          discount_amount: item.discount_amount ?? null,
        },
      ];
    });
    setCustomising(null);
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) => {
      const item = prev.find((c) => c.key === key);
      if (!item) return prev;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return prev.filter((c) => c.key !== key);
      return prev.map((c) => (c.key === key ? { ...c, quantity: newQty } : c));
    });
  }

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  async function placeOrder() {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    try {
      await posTableOrder(token, {
        items: cart.map((c) => ({
          menu_item_id: c.id,
          quantity: c.quantity,
          selections: c.selections,
          special_instructions: c.specialInstructions,
        })),
        notes,
        customer_name: customerName,
      });
      setOrderPlaced(true);
    } catch (err: unknown) {
      setError((err as { message?: string }).message || "Failed to place order");
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
          onClick={() => {
            setCart([]);
            setOrderPlaced(false);
            setNotes("");
          }}
          className="mt-8 rounded-2xl bg-ink px-8 py-3 text-sm font-bold text-white hover:opacity-90"
        >
          Order More
        </button>
      </div>
    );
  }

  if (!menu) return null;

  const allItems = Array.from(
    new Map(
      Object.values(menu.categories)
        .flat()
        .map((item) => [item.id, item]),
    ).values(),
  );
  const filteredItems = searchQuery
    ? allItems.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : activeCategory
      ? menu.categories[activeCategory] || []
      : allItems;

  return (
    <div className="flex min-h-dvh flex-col bg-background pb-28">
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
            const lines = cart.filter((c) => c.id === item.id);
            const hasOptions = (item.groups || []).length > 0;
            const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
            return (
              <button
                key={item.id}
                onClick={() => handleItemTap(item)}
                className={`rounded-2xl border bg-card p-3 text-left transition-all ${
                  totalQty > 0 ? "border-ink ring-1 ring-ink" : "border-border"
                }`}
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="text-2xl">{item.emoji || "🍽️"}</div>
                  {hasOptions && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">
                      <Sliders className="h-3 w-3" /> Customise
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground line-clamp-2">{item.name}</p>
                {(() => {
                  const discount = baseDiscount(toSheetItem(item));
                  return (
                    <p className="mt-1 flex items-baseline gap-1.5 text-sm font-bold text-ink">
                      <span>
                        {formatCurrency(
                          discount?.discounted ?? parseFloat(item.price),
                          currencySymbol,
                        )}
                      </span>
                      {discount && (
                        <span className="text-[11px] font-normal text-muted-foreground line-through">
                          {formatCurrency(discount.original, currencySymbol)}
                        </span>
                      )}
                    </p>
                  );
                })()}
                {totalQty > 0 && (
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (lines.length === 1) updateQty(lines[0].key, -1);
                          else setCustomising({ item, lineKey: lines[lines.length - 1].key });
                        }}
                        className="grid h-6 w-6 place-items-center rounded-full bg-muted text-foreground"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-bold">{totalQty}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasOptions) {
                            setCustomising({ item, lineKey: null });
                          } else {
                            addSimple(item);
                          }
                        }}
                        className="grid h-6 w-6 place-items-center rounded-full bg-ink text-white"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="text-xs font-bold text-ink">
                      {formatCurrency(
                        lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
                        currencySymbol,
                      )}
                    </span>
                  </div>
                )}
                {lines.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {lines.length} variants in bag
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cart footer */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-4 space-y-3">
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {cart.map((c) => (
              <div
                key={c.key}
                className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5"
              >
                <span className="text-xs font-medium text-foreground">
                  {c.quantity}× {c.name}
                </span>
                {c.selectionsText && (
                  <span className="truncate text-[10px] text-muted-foreground">
                    {c.selectionsText}
                  </span>
                )}
                <button
                  onClick={() => handleEditTap(c)}
                  className="ml-auto shrink-0 text-[10px] text-teal-700 underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => updateQty(c.key, -1)}
                  className="shrink-0 text-[10px] text-rose-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm"
          />
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Special requests for the kitchen (optional)"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm"
          />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{cartCount} items</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(cartTotal, currencySymbol)}
              </p>
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

      {customising && (
        <ProductDetailSheet
          open
          item={toSheetItem(customising.item)}
          currencySymbol={currencySymbol}
          resetKey={customising.lineKey ?? `new:${customising.item.id}`}
          submitLabel={customising.lineKey ? "Update item" : "Add to order"}
          onClose={() => setCustomising(null)}
          onAdd={handleDraft}
        />
      )}
    </div>
  );
}
