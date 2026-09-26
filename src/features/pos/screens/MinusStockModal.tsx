import { useState, useEffect, useMemo } from "react";
import {
  posGetInventoryProducts,
  posMinusStock,
  type PosInventoryProduct,
  type PosMinusStockResult,
} from "../api";
import {
  X,
  PackageMinus,
  Search,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  Minus,
  ArrowRight,
  Boxes,
  Layers,
  Sparkles,
} from "lucide-react";

interface MinusStockModalProps {
  open: boolean;
  onClose: () => void;
  orderId?: number | null;
  tableName?: string | null;
  initialItem?: {
    name: string;
    menu_item_id?: number | null;
    quantity?: number;
  } | null;
  orderItems?: Array<{
    name: string;
    menu_item_id?: number | null;
    quantity?: number;
  }>;
  onStockDeducted?: (result: PosMinusStockResult) => void;
}

const COMMON_REASONS = [
  "Dine-In Manual Deduction",
  "Kitchen Spoilage / Taste Test",
  "Customer Return / Spill",
  "Kitchen Mistake / Over-prep",
  "Damaged / Broken Item",
  "Staff Complimentary",
  "Other",
];

export default function MinusStockModal({
  open,
  onClose,
  orderId,
  tableName,
  initialItem,
  orderItems = [],
  onStockDeducted,
}: MinusStockModalProps) {
  const [products, setProducts] = useState<PosInventoryProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<PosInventoryProduct | null>(null);
  const [quantity, setQuantity] = useState<number | string>(1);
  const [reason, setReason] = useState(COMMON_REASONS[0]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<PosMinusStockResult | null>(null);

  // Fetch live inventory products on open
  useEffect(() => {
    if (!open) {
      setSelectedProduct(null);
      setQuantity(1);
      setError(null);
      setSuccessResult(null);
      setSearch("");
      return;
    }

    let isMounted = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await posGetInventoryProducts();
        if (!isMounted) return;
        setProducts(data);

        // Auto-select initialItem or first matching item from orderItems if available
        const targetItem = initialItem || (orderItems.length > 0 ? orderItems[0] : null);
        if (targetItem) {
          const matched = data.find(
            (p) =>
              (targetItem.menu_item_id && p.menu_item_ids?.includes(targetItem.menu_item_id)) ||
              p.name.trim().toLowerCase() === targetItem.name.trim().toLowerCase()
          );
          if (matched) {
            setSelectedProduct(matched);
            if (targetItem.quantity && targetItem.quantity > 0) {
              setQuantity(Math.min(targetItem.quantity, Math.max(1, matched.available_stock)));
            }
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || "Failed to load inventory products.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [open, initialItem]);

  // Filtered products by search
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q)
    );
  }, [products, search]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const numQty = typeof quantity === "string" ? parseFloat(quantity) || 0 : quantity;
  const currentStock = selectedProduct ? selectedProduct.available_stock : 0;
  const remainingStock = currentStock - numQty;
  const isOutOfStock = currentStock <= 0;
  const isExceeding = numQty > currentStock;
  const isValid = selectedProduct !== null && numQty > 0 && !isExceeding && !isOutOfStock;

  async function handleConfirm() {
    if (!selectedProduct || !isValid || submitting) return;

    setSubmitting(true);
    setError(null);

    const idempotencyKey = `minus-stock-${selectedProduct.inventory_item_id}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const result = await posMinusStock({
        inventory_item_id: selectedProduct.inventory_item_id,
        quantity: numQty,
        reason,
        note: note.trim() || undefined,
        order_id: orderId || undefined,
        idempotency_key: idempotencyKey,
      });

      // Update local state immediately
      setProducts((prev) =>
        prev.map((p) =>
          p.inventory_item_id === result.inventory_item_id
            ? { ...p, available_stock: result.available_stock }
            : p
        )
      );

      setSelectedProduct((prev) =>
        prev && prev.inventory_item_id === result.inventory_item_id
          ? { ...prev, available_stock: result.available_stock }
          : prev
      );

      setSuccessResult(result);
      if (onStockDeducted) {
        onStockDeducted(result);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to deduct stock. Please verify available quantity.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleResetForAnother() {
    setSuccessResult(null);
    setQuantity(1);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="minus-stock-title"
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col rounded-3xl border border-border bg-card shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-muted/40">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20">
              <PackageMinus className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="minus-stock-title" className="text-lg font-bold text-foreground">
                  Minus Stock
                </h2>
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-bold text-destructive border border-destructive/20">
                  Dine-In Flow
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {tableName ? `${tableName} · ` : ""}
                {orderId ? `Order #${orderId} · ` : ""}
                Decrease stock quantity in inventory
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Success Screen */}
          {successResult ? (
            <div className="py-6 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success border border-success/20 animate-in zoom-in duration-300">
                <CheckCircle2 className="h-10 w-10" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-foreground">Stock Deducted Successfully</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Deducted{" "}
                  <span className="font-bold text-destructive">
                    -{successResult.deducted_quantity} {successResult.unit}
                  </span>{" "}
                  from <span className="font-semibold text-foreground">{successResult.item_name}</span>.
                </p>
              </div>

              <div className="mx-auto max-w-xs rounded-2xl border border-border bg-mist p-4 text-left space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Previous Stock:</span>
                  <span className="font-medium text-foreground">
                    {parseFloat(successResult.balance_before)} {successResult.unit}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Deduction:</span>
                  <span className="font-bold text-destructive">
                    -{successResult.deducted_quantity} {successResult.unit}
                  </span>
                </div>
                <div className="flex justify-between border-t border-border/80 pt-2 text-sm font-bold text-foreground">
                  <span>Remaining Stock:</span>
                  <span className="text-success">
                    {successResult.available_stock} {successResult.unit}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Storage Location:</span>
                  <span>{successResult.location_name || "Main Storage"}</span>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleResetForAnother}
                  className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm font-semibold text-foreground hover:bg-mist transition-colors"
                >
                  Deduct Another Item
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl bg-ink py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Order items quick picker */}
              {orderItems.length > 0 && (
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Layers className="h-3.5 w-3.5 text-ember" />
                    Items in This Order (Quick Pick)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {orderItems.map((item, idx) => {
                      const matched = products.find(
                        (p) =>
                          (item.menu_item_id && p.menu_item_ids?.includes(item.menu_item_id)) ||
                          p.name.trim().toLowerCase() === item.name.trim().toLowerCase()
                      );
                      const isSelected = selectedProduct?.inventory_item_id === matched?.inventory_item_id;

                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (matched) {
                              setSelectedProduct(matched);
                              if (item.quantity && item.quantity > 0) {
                                setQuantity(Math.min(item.quantity, Math.max(1, matched.available_stock)));
                              }
                            }
                          }}
                          className={`flex min-h-[36px] items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                            isSelected
                              ? "bg-destructive text-destructive-foreground shadow-sm ring-2 ring-destructive/20"
                              : "border border-border bg-muted/50 text-foreground hover:bg-muted"
                          }`}
                        >
                          <span>{item.name}</span>
                          {item.quantity && (
                            <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-xs font-bold">
                              ×{item.quantity}
                            </span>
                          )}
                          {matched && (
                            <span
                              className={`text-xs ${
                                isSelected
                                  ? "text-destructive-foreground/80"
                                  : matched.available_stock > 0
                                  ? "text-success"
                                  : "text-destructive"
                              }`}
                            >
                              ({matched.available_stock} {matched.unit})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Product selector / Search */}
              <div className="space-y-2">
                <label className="flex items-center justify-between text-xs font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    <Boxes className="h-3.5 w-3.5 text-ember" />
                    Select Product to Deduct
                  </span>
                  {selectedProduct && (
                    <span className="text-[11px] font-normal text-muted-foreground">
                      Category: {selectedProduct.category}
                    </span>
                  )}
                </label>

                {/* Search Box */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search menu or stock products..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Product List */}
                <div className="max-h-40 overflow-y-auto rounded-xl border border-border divide-y divide-border bg-background">
                  {loading ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground mb-1" />
                      Loading inventory products...
                    </div>
                  ) : filteredProducts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No products found matching &ldquo;{search}&rdquo;.
                    </div>
                  ) : (
                    filteredProducts.map((p) => {
                      const isSelected = selectedProduct?.inventory_item_id === p.inventory_item_id;
                      const isZero = p.available_stock <= 0;

                      return (
                        <button
                          key={p.inventory_item_id}
                          type="button"
                          onClick={() => {
                            setSelectedProduct(p);
                            if (p.available_stock > 0 && numQty > p.available_stock) {
                              setQuantity(p.available_stock);
                            }
                          }}
                          className={`flex w-full items-center justify-between p-3 text-left transition-colors ${
                            isSelected
                              ? "bg-rose-500/10 border-l-4 border-l-rose-500"
                              : "hover:bg-muted/40"
                          }`}
                        >
                          <div className="min-w-0 pr-3">
                            <p className="text-sm font-semibold text-foreground truncate">{p.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {p.category} · {p.location_name}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span
                              className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold ${
                                isZero
                                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                                  : p.available_stock <= 5
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              }`}
                            >
                              {p.available_stock} {p.unit}
                            </span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {isZero ? "Out of stock" : "Available"}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Selected Product Summary & Stock Calculation */}
              {selectedProduct && (
                <div className="rounded-2xl border border-border bg-mist/60 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Selected Product
                      </span>
                      <p className="text-base font-bold text-foreground">{selectedProduct.name}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Current Available
                      </span>
                      <p
                        className={`text-base font-black ${
                          isOutOfStock ? "text-rose-600" : "text-foreground"
                        }`}
                      >
                        {selectedProduct.available_stock} {selectedProduct.unit}
                      </p>
                    </div>
                  </div>

                  {/* Quantity Stepper & Input */}
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">
                      Quantity to Deduct ({selectedProduct.unit})
                    </label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setQuantity(Math.max(1, numQty - 1))}
                        disabled={numQty <= 1 || isOutOfStock}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                      >
                        <Minus className="h-4 w-4" />
                      </button>

                      <div className="relative flex-1">
                        <input
                          type="number"
                          step="any"
                          min="0.001"
                          max={selectedProduct.available_stock}
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          disabled={isOutOfStock}
                          className={`w-full text-center rounded-xl border bg-background py-2.5 text-lg font-bold text-foreground focus:outline-none focus:ring-2 ${
                            isExceeding
                              ? "border-rose-500 focus:ring-rose-500 text-rose-600"
                              : "border-border focus:border-rose-500 focus:ring-rose-500/20"
                          }`}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setQuantity(
                            Math.min(selectedProduct.available_stock, numQty + 1)
                          )
                        }
                        disabled={isExceeding || numQty >= selectedProduct.available_stock || isOutOfStock}
                        className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-background text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
                      >
                        <Plus className="h-4 w-4" />
                      </button>

                      {/* Max button */}
                      <button
                        type="button"
                        onClick={() => setQuantity(selectedProduct.available_stock)}
                        disabled={isOutOfStock}
                        className="rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                      >
                        Max
                      </button>
                    </div>

                    {/* Quick quantity shortcuts */}
                    {selectedProduct.available_stock > 1 && (
                      <div className="mt-2 flex gap-1.5">
                        {[1, 2, 5, 10]
                          .filter((val) => val <= selectedProduct.available_stock)
                          .map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setQuantity(val)}
                              className="rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-border"
                            >
                              {val} {selectedProduct.unit}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>

                  {/* Live Calculation preview bar */}
                  <div className="flex items-center justify-between rounded-xl bg-card border border-border/80 px-4 py-2.5 text-xs">
                    <span className="text-muted-foreground">Stock Projection:</span>
                    <div className="flex items-center gap-2 font-medium">
                      <span>{selectedProduct.available_stock}</span>
                      <span className="text-rose-500 font-bold">- {numQty}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span
                        className={`font-bold ${
                          remainingStock < 0
                            ? "text-rose-600"
                            : remainingStock === 0
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {Math.max(0, remainingStock)} {selectedProduct.unit} remaining
                      </span>
                    </div>
                  </div>

                  {/* Exceed / Out of stock warning */}
                  {isExceeding && (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                      <span>
                        Cannot deduct <strong>{numQty} {selectedProduct.unit}</strong>. Only{" "}
                        <strong>{selectedProduct.available_stock} {selectedProduct.unit}</strong> available in stock.
                      </span>
                    </div>
                  )}

                  {isOutOfStock && (
                    <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                      <span>This product is currently out of stock. Cannot deduct.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Reason & Notes */}
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    Reason for Deduction
                  </label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  >
                    {COMMON_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Optional Note (recorded in inventory audit log)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Table 1 guest requested modification, taste test, spill..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* Error Banner */}
              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="flex-1 rounded-xl border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-mist transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!isValid || submitting}
                  className="flex-2 flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deducting Stock...
                    </>
                  ) : (
                    <>
                      <PackageMinus className="h-4 w-4" />
                      Confirm Deduction
                      {selectedProduct && isValid && (
                        <span>
                          (-{numQty} {selectedProduct.unit})
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
