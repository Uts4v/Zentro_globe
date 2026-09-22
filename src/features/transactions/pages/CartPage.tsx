import { Link, useNavigate } from "@tanstack/react-router";
import { useStore, type CartItem } from "@/lib/store";
import { TopBar, MobileShell } from "@/components/MobileShell";
import {
  Minus,
  Plus,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Utensils,
  ShoppingBag,
  Truck,
  Scan,
  Pencil,
  Trash2,
} from "lucide-react";
import { menuApi, merchantApi, orderApi } from "@/lib/api";
import type { MenuCatalog, MenuItem, OrderPreview } from "@/lib/api";
import ProductDetailSheet, {
  type ProductDraft,
} from "@/features/catalog/components/ProductDetailSheet";
import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency } from "@/lib/currency";
import { lineSelectionsText } from "@/lib/menu-utils";

export function CartPage() {
  const {
    cart,
    setQty,
    replaceLine,
    removeLine,
    placeOrder,
    selectedMerchantId,
    activeTable,
    fulfillmentType,
    setFulfillmentType,
  } = useStore();
  const nav = useNavigate();
  const [catalog, setCatalog] = useState<MenuCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState("");
  const [sym, setSym] = useState("Rs");
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [editing, setEditing] = useState<{ line: CartItem; item: MenuItem } | null>(null);

  const symFromCatalog = catalog?.merchant.currency_symbol || sym;

  useEffect(() => {
    loadMenu();
  }, [selectedMerchantId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMenu() {
    if (!selectedMerchantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await menuApi.catalog(selectedMerchantId);
      setCatalog(data);
      if (data.merchant.currency_symbol) setSym(data.merchant.currency_symbol);
    } catch {
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }

  const itemsById = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const i of catalog?.items ?? []) map.set(String(i.id), i);
    return map;
  }, [catalog]);

  const previewPayload = useMemo(
    () => ({
      merchant_id: String(selectedMerchantId ?? ""),
      items: cart.map((c) => ({
        menu_item_id: c.itemId,
        quantity: c.qty,
        selections: c.selections,
        special_instructions: c.specialInstructions,
        name: "",
        price: c.unitPrice,
        points_per_item: 0,
      })),
    }),
    [cart, selectedMerchantId],
  );

  const runPreview = useCallback(async () => {
    if (!selectedMerchantId || cart.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    try {
      const p = await orderApi.preview(previewPayload);
      setPreview(p);
      setError("");
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message;
      if (msg && /sold out|unavailable|no longer active/i.test(msg)) {
        setError(msg);
      } else {
        setPreview(null);
      }
    } finally {
      setPreviewing(false);
    }
  }, [previewPayload, cart.length, selectedMerchantId]);

  useEffect(() => {
    if (cart.length === 0) {
      setPreview(null);
      return;
    }
    const t = setTimeout(runPreview, 350);
    return () => clearTimeout(t);
  }, [runPreview, cart]);

  const clientSubtotal = cart.reduce((s, c) => s + (c.unitPrice || 0) * c.qty, 0);
  const subtotal = preview ? parseFloat(preview.subtotal) : clientSubtotal;
  const taxValue = preview ? parseFloat(preview.tax_amount) : 0;
  const total = preview ? parseFloat(preview.total_amount) : clientSubtotal;
  const points = preview?.points_earned ?? cart.reduce((s, c) => s + c.qty, 0);

  async function handlePlaceOrder() {
    if (placing) return;
    if (fulfillmentType === "dine_in" && !activeTable) {
      setError("Scan a table QR code to place a dine-in order.");
      return;
    }
    setPlacing(true);
    setError("");
    try {
      const id = await placeOrder();
      nav({ to: "/orders/$id", params: { id } });
    } catch (e: unknown) {
      setError((e as { message?: string }).message || "Failed to place order");
    } finally {
      setPlacing(false);
    }
  }

  return (
    <MobileShell>
      <TopBar
        right={
          <Link to="/menu" className="glass grid h-9 w-9 place-items-center rounded-full">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
      />
      <div className="px-5">
        <h1 className="font-display text-4xl text-foreground">Your bag</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {cart.length === 0
            ? "Quiet for now. Add something lovely."
            : `${cart.reduce((s, c) => s + c.qty, 0)} item${
                cart.reduce((s, c) => s + c.qty, 0) !== 1 ? "s" : ""
              } ready to brew.`}
        </p>
      </div>

      {/* Fulfillment type selector */}
      <div className="mt-4 px-5">
        <div className="glass-strong rounded-2xl p-4">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Order type
          </p>
          <div className="flex gap-2">
            {[
              { key: "dine_in" as const, label: "Dine-in", icon: Utensils, needsTable: true },
              { key: "pickup" as const, label: "Pickup", icon: ShoppingBag, needsTable: false },
              { key: "delivery" as const, label: "Delivery", icon: Truck, needsTable: false },
            ].map((opt) => {
              const isActive = fulfillmentType === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setFulfillmentType(opt.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors ${
                    isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground"
                  }`}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          {fulfillmentType === "dine_in" && (
            <div className="mt-3">
              {activeTable ? (
                <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                    <Utensils className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800">{activeTable.tableName}</p>
                    <p className="text-xs text-blue-500">Scanned · Table order</p>
                  </div>
                  <button
                    onClick={() => setFulfillmentType("pickup")}
                    className="text-xs text-blue-600 underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <Link
                  to="/"
                  className="flex items-center gap-3 rounded-xl border border-dashed border-blue-200 bg-blue-50/50 p-3"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                    <Scan className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-blue-800">Scan your table QR</p>
                    <p className="text-xs text-blue-500">Required for dine-in orders</p>
                  </div>
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3 px-5">
        {cart.map((c) => {
          const item = itemsById.get(String(c.itemId));
          const optionsText = item ? lineSelectionsText(item, c.selections) : "";
          return (
            <div key={c.key} className="glass flex items-center gap-3 rounded-2xl p-3">
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-mist text-2xl">
                {item?.emoji || "🍽️"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {item?.name || "Unknown item"}
                  </p>
                  <button
                    onClick={() => item && setEditing({ line: c, item })}
                    aria-label="Edit item"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                {optionsText && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {optionsText}
                  </p>
                )}
                {c.specialInstructions && (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-ember">
                    “{c.specialInstructions}”
                  </p>
                )}
                <p className="font-display text-base text-foreground">
                  {c.unitPrice === 0 ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-700">
                      FREE
                    </span>
                  ) : (
                    `${formatCurrency(c.unitPrice * c.qty, symFromCatalog, 0)}`
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <div className="glass flex items-center gap-1 rounded-full p-1">
                  <button
                    onClick={() => setQty(c.key, c.qty - 1)}
                    className="grid h-7 w-7 place-items-center rounded-full bg-white"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-5 text-center text-sm font-medium">{c.qty}</span>
                  <button
                    onClick={() => setQty(c.key, c.qty + 1)}
                    className="grid h-7 w-7 place-items-center rounded-full bg-ink text-primary-foreground"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <button
                  onClick={() => removeLine(c.key)}
                  className="text-[11px] text-rose-400 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {cart.length > 0 && (
        <div className="mt-8 px-5">
          <div className="glass-strong rounded-3xl p-5">
            <div className="flex items-center gap-2 mb-3">
              {fulfillmentType === "dine_in" && activeTable && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-medium text-blue-700">
                  <Utensils className="h-3 w-3" /> {activeTable.tableName}
                </span>
              )}
              {fulfillmentType === "pickup" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-medium text-green-700">
                  <ShoppingBag className="h-3 w-3" /> Pickup
                </span>
              )}
              {fulfillmentType === "delivery" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-medium text-orange-700">
                  <Truck className="h-3 w-3" /> Delivery
                </span>
              )}
              {previewing && (
                <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>

            <Row label="Subtotal" value={formatCurrency(subtotal, symFromCatalog, 0)} />
            {preview && taxValue > 0 && (
              <>
                {preview.tax_breakdown.map((t) => (
                  <Row
                    key={t.name}
                    label={`${t.name || "Tax"} (${t.rate}%)`}
                    value={formatCurrency(t.amount, symFromCatalog, 0)}
                  />
                ))}
                {preview.tax_breakdown.length === 0 && (
                  <Row label="Tax" value={formatCurrency(taxValue, symFromCatalog, 0)} />
                )}
              </>
            )}
            <div className="my-3 border-t border-border" />
            <Row label="Total" value={formatCurrency(total, symFromCatalog, 0)} bold />
            <div className="mt-3 flex items-center justify-between rounded-2xl bg-ember-soft px-4 py-3">
              <span className="text-xs text-foreground">You&apos;ll earn</span>
              <span className="font-display text-lg text-ember">+{points} pts</span>
            </div>

            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={handlePlaceOrder}
              disabled={placing || !!error}
              className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-base font-medium text-primary-foreground shadow-ember transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {placing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Placing order…
                </>
              ) : (
                `Place order · ${formatCurrency(total, symFromCatalog, 0)}`
              )}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <ProductDetailSheet
          open
          item={editing.item}
          currencySymbol={symFromCatalog}
          resetKey={editing.line.key}
          initialQty={editing.line.qty}
          initialSelections={editing.line.selections}
          initialInstructions={editing.line.specialInstructions}
          submitLabel="Update item"
          onClose={() => setEditing(null)}
          onAdd={(draft: ProductDraft) => {
            replaceLine(editing.line.key, {
              itemId: draft.itemId,
              qty: draft.qty,
              selections: draft.selections,
              specialInstructions: draft.specialInstructions,
              unitPrice: draft.unitPrice,
            });
          }}
        />
      )}
    </MobileShell>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-sm ${bold ? "font-medium text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span
        className={`numeric ${bold ? "text-2xl font-bold tracking-tight text-foreground" : "text-sm text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
