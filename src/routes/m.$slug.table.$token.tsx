// routes/m.$slug.table.$token.tsx — Table QR scan entry → menu + ordering (no login required)
//
// Flow: Scan QR → resolve table → show menu immediately
// Guest orders placed directly, no auth wall.
// Subtle membership banner encourages signup without blocking.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Loader2,
  Plus,
  Minus,
  ShoppingBag,
  Search,
  X as XIcon,
  Utensils,
  ArrowRight,
  SendHorizontal,
  Sparkles,
  Star,
  Gift,
  Zap,
  UserPlus,
  Sun,
  Moon,
  BellRing,
  Check,
} from "lucide-react";
import { tableApi, menuApi, orderApi, type TableResolution } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useStore, cartTotals, type CartItem } from "@/lib/store";
import { safeUuid } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import { fromPrice, baseDiscount, lineSelectionsText } from "@/lib/menu-utils";
import type { MenuItem, MenuCatalog } from "@/lib/api/types";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";

export const Route = createFileRoute("/m/$slug/table/$token")({
  head: () => ({ meta: [{ title: "Order · Zentro" }] }),
  component: TableQRScanPage,
});

function MenuItemCard({
  item,
  currencySymbol,
  inCart,
  onTap,
}: {
  item: MenuItem;
  currencySymbol: string;
  inCart: number;
  onTap: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const hasImage = !!item.image_url && !imgError;
  const price = fromPrice(item);
  const discount = baseDiscount(item);
  // A priced variant group means the card can only show a "from" price; the
  // real price depends on the tap, so the card must open the detail sheet.
  const hasOptions = (item.groups ?? []).some((g) => g.is_active !== false);
  const soldOut = !item.is_available || item.status === "archived";

  return (
    <article
      onClick={soldOut ? undefined : onTap}
      className={`glass group relative flex flex-col overflow-hidden rounded-3xl ${
        soldOut ? "opacity-50" : "cursor-pointer active:scale-[0.98]"
      }`}
    >
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-xl text-foreground">
              {hasOptions && <span className="mr-1 text-[10px] font-sans text-muted-foreground">from</span>}
              {formatCurrency(price, currencySymbol, 0)}
            </span>
            {discount && (
              <span className="text-[11px] text-muted-foreground line-through">
                {formatCurrency(discount.original, currencySymbol, 0)}
              </span>
            )}
          </span>
          {soldOut ? (
            <span className="shrink-0 rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-bold text-white">
              Sold out
            </span>
          ) : (
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-primary-foreground">
              {hasOptions ? (
                <Sparkles className="h-4 w-4" strokeWidth={2.2} />
              ) : (
                <Plus className="h-4 w-4" strokeWidth={2.4} />
              )}
              {inCart > 0 && (
                <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-ember px-1 text-[10px] font-bold text-white">
                  {inCart}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function TableQRScanPage() {
  const params = Route.useParams();
  const slug = params.slug;
  const token = params.token;
  const navigate = useNavigate();
  const { user } = useAuth();
  const { resolved: themeResolved, setTheme } = useTheme();
  const {
    cart,
    addLine,
    replaceLine,
    setQty,
    removeLine,
    setActiveTable,
    setSelectedMerchant,
    setGuestSession,
    activeTable,
    guestSession,
    setGuestName,
    placeGuestOrder,
  } = useStore();

  const [resolution, setResolution] = useState<TableResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [guestName, setLocalGuestName] = useState(guestSession?.guestName || "");
  const [notes, setNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<{ orderId: string } | null>(null);
  const [waiterStatus, setWaiterStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [waiterCooldown, setWaiterCooldown] = useState(0);

  const currencySymbol = catalog?.merchant?.currency_symbol || "Rs";

  // Resolve table token
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    tableApi
      .resolve(slug, token)
      .then((r) => {
        if (!cancelled) setResolution(r);
      })
      .catch(() => {
        if (!cancelled) setError("Invalid or expired table QR code. Please scan again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  // Set table context once resolved
  useEffect(() => {
    if (loading || !resolution) return;

    const tableCtx = {
      merchantSlug: slug,
      tableToken: token,
      tableId: resolution.table.id,
      tableName: resolution.table.name,
      scannedAt: Date.now(),
    };
    setActiveTable(tableCtx);
    setSelectedMerchant(String(resolution.merchant.id));

    // Auto-create guest session if not already initialized
    if (!guestSession) {
      setGuestSession({
        guestId: safeUuid(),
        guestName: user?.customer_profile?.full_name || user?.first_name || "",
        joinedAt: Date.now(),
      });
    }

    if (user?.role === "merchant") {
      navigate({ to: "/merchant", replace: true });
      return;
    }
  }, [
    loading,
    resolution,
    user,
    slug,
    token,
    navigate,
    setActiveTable,
    setSelectedMerchant,
    setGuestSession,
    guestSession,
  ]);

  // Load menu once resolution is ready.
  // `catalog` (not `forMerchant`) is required: it is the only public payload
  // that carries each item's variant/modifier groups.
  useEffect(() => {
    if (!resolution) return;
    let cancelled = false;
    setMenuLoading(true);

    menuApi
      .catalog(String(resolution.merchant.id))
      .then((c) => {
        if (cancelled) return;
        setCatalog(c);
        setMenuItems(c.items ?? []);
        setMenuError(null);
      })
      .catch(() => {
        if (!cancelled) setMenuError("Couldn't load this menu. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setMenuLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolution]);

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
  // Option-aware: every cart line already stores its priced unit price.
  const total = cartTotals(cart);

  const itemById = useMemo(() => {
    const m = new Map<string, MenuItem>();
    for (const i of menuItems) m.set(String(i.id), i);
    return m;
  }, [menuItems]);

  /** Total qty of an item across every distinct configuration in the cart. */
  function qtyInCart(itemId: string) {
    return cart
      .filter((c) => String(c.itemId) === String(itemId))
      .reduce((s, c) => s + c.qty, 0);
  }

  function handleCardTap(item: MenuItem) {
    const hasOptions = (item.groups ?? []).some((g) => g.is_active !== false);
    if (!hasOptions) {
      // Simple item: one tap adds it, reusing the identical cart line.
      addLine({ itemId: String(item.id), qty: 1, unitPrice: fromPrice(item) });
      return;
    }
    setEditing(null);
    setActiveItem(item);
  }

  function handleSheetAdd(draft: ProductDraft) {
    if (editing) {
      replaceLine(editing.key, {
        itemId: draft.itemId,
        qty: draft.qty,
        selections: draft.selections,
        specialInstructions: draft.specialInstructions,
        unitPrice: draft.unitPrice,
      });
      setEditing(null);
      return;
    }
    addLine({
      itemId: draft.itemId,
      qty: draft.qty,
      selections: draft.selections,
      specialInstructions: draft.specialInstructions,
      unitPrice: draft.unitPrice,
    });
  }

  function handleEditLine(line: CartItem) {
    const item = itemById.get(String(line.itemId));
    if (!item) return;
    setEditing(line);
    setActiveItem(item);
  }

  async function handlePlaceOrder() {
    if (placing || cart.length === 0 || !activeTable) return;
    setPlacing(true);
    try {
      setGuestName(guestName);
      const orderId = await placeGuestOrder(notes, guestName);
      setOrderSuccess({ orderId });
      setShowCheckout(false);
    } catch (err: any) {
      alert(err?.message || "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }

  // Count down the waiter-call cooldown, then re-enable the button.
  useEffect(() => {
    if (waiterStatus !== "sent") return;
    const timer = setInterval(() => {
      setWaiterCooldown((c) => {
        if (c <= 1) {
          setWaiterStatus("idle");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [waiterStatus]);

  async function handleCallWaiter() {
    if (waiterStatus === "sending" || waiterCooldown > 0 || !resolution) return;
    setWaiterStatus("sending");
    try {
      await orderApi.callWaiter({
        merchant_id: String(resolution.merchant.id),
        table_token: token,
        guest_name: guestName.trim() || guestSession?.guestName?.trim() || "",
      });
      setWaiterStatus("sent");
      setWaiterCooldown(60);
    } catch {
      setWaiterStatus("idle");
      alert("Couldn't reach the waiter. Please try again.");
    }
  }

  // Loading state — only block on table resolution, not auth.
  // The page handles logged-in vs guest states after resolution.
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Reserving your table...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !resolution) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center bg-background">
        <p className="text-5xl">🪑</p>
        <p className="text-sm text-muted-foreground">{error ?? "Table not found."}</p>
        <Link
          to="/"
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const merchant = resolution.merchant;
  const table = resolution.table;

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
            <span className="text-sm font-medium">
              {merchant.name} · Table {activeTable.tableName}
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Order #{orderSuccess.orderId}</p>
        <button
          onClick={() => setOrderSuccess(null)}
          className="mt-8 flex h-12 items-center gap-2 rounded-2xl bg-foreground px-8 text-sm font-medium text-background active:scale-[0.98]"
        >
          Order More <ArrowRight className="h-4 w-4" />
        </button>
        <button
          onClick={handleCallWaiter}
          disabled={waiterStatus === "sending" || waiterCooldown > 0}
          className="mt-3 flex h-12 items-center gap-2 rounded-2xl border border-border bg-background px-8 text-sm font-medium text-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {waiterStatus === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : waiterStatus === "sent" && waiterCooldown > 0 ? (
            <Check className="h-4 w-4 text-green-600" />
          ) : (
            <BellRing className="h-4 w-4" />
          )}
          {waiterStatus === "sent" && waiterCooldown > 0
            ? `Waiter notified (${waiterCooldown}s)`
            : "Call Waiter"}
        </button>
      </div>
    );
  }

  // Checkout view
  if (showCheckout) {
    return (
      <div className="mx-auto min-h-dvh max-w-[480px] bg-background px-5 pb-10 pt-5">
        <button
          onClick={() => setShowCheckout(false)}
          className="mb-4 text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to menu
        </button>

        <h1 className="font-display text-2xl text-foreground">Checkout</h1>

        {activeTable && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-muted/50 px-4 py-3">
            <Utensils className="h-4 w-4 text-ember" />
            <span className="text-sm font-medium text-foreground">
              {merchant.name} · Table {activeTable.tableName}
            </span>
          </div>
        )}

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

        <div className="mt-5 space-y-2 rounded-2xl bg-muted/30 p-4">
          {cart.map((c) => {
            const item = itemById.get(String(c.itemId));
            if (!item) return null;
            const opts = lineSelectionsText(item, c.selections);
            const lineTotal = ((c.unitPrice || 0) * c.qty).toFixed(2);
            return (
              <div key={c.key} className="rounded-xl bg-background/60 p-2.5">
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span className="min-w-0 text-foreground">
                    {c.qty}× {item.name}
                    {opts && (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{opts}</span>
                    )}
                    {c.specialInstructions && (
                      <span className="mt-0.5 block text-[11px] italic text-muted-foreground">
                        “{c.specialInstructions}”
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {currencySymbol} {lineTotal}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setQty(c.key, c.qty - 1)}
                      disabled={c.qty <= 1}
                      className="grid h-7 w-7 place-items-center rounded-full bg-muted text-foreground disabled:opacity-40"
                      aria-label="Decrease quantity"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[20px] text-center text-sm font-semibold text-foreground">
                      {c.qty}
                    </span>
                    <button
                      onClick={() => setQty(c.key, c.qty + 1)}
                      className="grid h-7 w-7 place-items-center rounded-full bg-ink text-primary-foreground"
                      aria-label="Increase quantity"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleEditLine(c)}
                      className="ml-1 text-[11px] font-medium text-ember underline underline-offset-2"
                    >
                      Edit
                    </button>
                  </div>
                  <button
                    onClick={() => removeLine(c.key)}
                    className="text-[11px] font-medium text-muted-foreground underline underline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div className="border-t border-border pt-2 mt-2">
            <div className="flex justify-between text-base font-bold">
              <span className="text-foreground">Total</span>
              <span className="text-foreground">
                {currencySymbol} {total.toFixed(2)}
              </span>
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
              Place Order — {formatCurrency(total, currencySymbol)}
            </>
          )}
        </button>

        {/* Join membership CTA at bottom of checkout */}
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-center">
          <p className="text-xs text-amber-700">
            <Sparkles className="inline h-3 w-3 mr-1" />
            <span className="font-semibold">Join Zentro</span> — earn points on every order, unlock
            rewards & member-only offers.
          </p>
          <Link
            to="/auth/signup"
            search={{ redirect: `/customer/merchant/${slug}` }}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 underline"
          >
            <UserPlus className="h-3 w-3" /> Join Free
          </Link>
        </div>
      </div>
    );
  }

  // Main menu view (the primary experience)
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-background">
      {/* Sticky header: merchant + table + cart */}
      <div className="sticky top-0 z-10 bg-background px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl text-foreground">{merchant.name}</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Utensils className="h-3 w-3 text-ember" />
              <span className="text-xs font-medium text-muted-foreground">
                Table {table.table_number}
                {table.name && table.name !== `Table ${table.table_number}`
                  ? ` · ${table.name}`
                  : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCallWaiter}
              disabled={waiterStatus === "sending" || waiterCooldown > 0}
              className="flex h-10 items-center gap-1.5 rounded-full bg-muted/50 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
              title={
                waiterStatus === "sent" && waiterCooldown > 0
                  ? `Waiter notified — re-enables in ${waiterCooldown}s`
                  : "Call a waiter to your table"
              }
            >
              {waiterStatus === "sending" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : waiterStatus === "sent" && waiterCooldown > 0 ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <BellRing className="h-4 w-4" />
              )}
              {waiterStatus === "sent" && waiterCooldown > 0
                ? `Called (${waiterCooldown}s)`
                : waiterStatus === "sending"
                  ? "Calling..."
                  : "Waiter"}
            </button>
            <button
              onClick={() => setTheme(themeResolved === "dark" ? "light" : "dark")}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 text-foreground transition-colors hover:bg-muted"
              aria-label="Toggle theme"
            >
              {themeResolved === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => setShowCheckout(true)}
              disabled={cartCount === 0}
              className="relative flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
            >
              <ShoppingBag className="h-4 w-4" />
              {cartCount > 0 && (
                <>
                  <span>{cartCount}</span>
                  <span className="text-xs opacity-70">
                    · {formatCurrency(total, currencySymbol, 0)}
                  </span>
                </>
              )}
            </button>
          </div>
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
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2"
            >
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

      {/* Membership banner (subtle, non-blocking) */}
      <div className="mx-5 mt-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50/80 to-orange-50/50 p-3.5">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100">
            <Sparkles className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-amber-800">Join Zentro — it's free</p>
            <p className="mt-0.5 text-[11px] text-amber-700/80 leading-relaxed">
              Earn points on every order, unlock rewards & member-only offers.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { icon: Star, text: "Earn points" },
                { icon: Gift, text: "Rewards" },
                { icon: Zap, text: "B2G1 deals" },
              ].map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                >
                  <Icon className="h-2.5 w-2.5" /> {text}
                </span>
              ))}
            </div>
          </div>
          <Link
            to="/auth/signup"
            search={{ redirect: `/customer/merchant/${slug}` }}
            className="shrink-0 rounded-xl bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white active:scale-95 transition-transform"
          >
            Join Free
          </Link>
        </div>
      </div>

      {/* Menu grid */}
      <div className="px-5 mt-4 pb-32">
        {menuLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : menuError ? (
          <div className="py-20 text-center">
            <p className="mb-2 text-4xl">📡</p>
            <p className="text-sm text-muted-foreground">{menuError}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-4xl mb-2">🍽</p>
            <p className="text-sm text-muted-foreground">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredItems.map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                currencySymbol={currencySymbol}
                inCart={qtyInCart(item.id)}
                onTap={() => handleCardTap(item)}
              />
            ))}
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
            <span className="font-display text-lg">
              {formatCurrency(total, currencySymbol, 0)} →
            </span>
          </button>
        </div>
      )}

      {/* Variant / modifier selection. Rendered last so it stacks above the
          sticky header and floating cart bar. */}
      <ProductDetailSheet
        open={!!activeItem}
        item={activeItem}
        currencySymbol={currencySymbol}
        onClose={() => {
          setActiveItem(null);
          setEditing(null);
        }}
        onAdd={handleSheetAdd}
        submitLabel={editing ? "Update item" : "Add to order"}
        initialQty={editing?.qty}
        initialSelections={editing?.selections}
        initialInstructions={editing?.specialInstructions}
        resetKey={editing?.key}
      />
    </div>
  );
}
