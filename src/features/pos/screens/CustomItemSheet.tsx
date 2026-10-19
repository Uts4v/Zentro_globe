import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, X, ChevronRight, AlertCircle, Sparkles } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

/** The values a custom (ad-hoc) line carries: a name, a manual price, a quantity. */
export interface CustomItemDraft {
  name: string;
  price: number;
  quantity: number;
  special_instructions: string;
}

interface Props {
  open: boolean;
  currencySymbol: string;
  onClose: () => void;
  onSubmit: (draft: CustomItemDraft) => void;
  submitLabel?: string;
  /** Prefill when editing an existing custom line. */
  initial?: CustomItemDraft | null;
}

// The server stores OrderItem.price with max_digits=10, decimal_places=2.
const MAX_PRICE = 99999999.99;
const MAX_NAME = 255;
const MAX_INSTRUCTIONS = 500;
const MAX_QTY = 999;

/**
 * Staff-only sheet for adding a one-off item that is not on the menu: the
 * cashier types a name and a price. Never saved to the catalog; it travels as a
 * normal order line flagged `is_custom` and is priced by the server.
 */
export default function CustomItemSheet({
  open,
  currencySymbol,
  onClose,
  onSubmit,
  submitLabel = "Add to cart",
  initial,
}: Props) {
  // Mounted only while open (the parent renders it conditionally), so the
  // initial values are read once on mount. Editing a different line remounts
  // the sheet via the `key` the parent passes.
  const [name, setName] = useState(() => initial?.name ?? "");
  const [priceText, setPriceText] = useState(() => (initial ? String(initial.price) : ""));
  const [qty, setQty] = useState(() => initial?.quantity ?? 1);
  const [instructions, setInstructions] = useState(() => initial?.special_instructions ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const parsedPrice = Number(priceText);
  const priceValid = priceText.trim() !== "" && Number.isFinite(parsedPrice) && parsedPrice >= 0;
  const total = priceValid ? Math.round(parsedPrice * qty * 100) / 100 : 0;

  function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a name for this item.");
      return;
    }
    if (!priceValid) {
      setError("Enter a price of 0 or more.");
      return;
    }
    if (parsedPrice > MAX_PRICE) {
      setError("That price is too large.");
      return;
    }
    onSubmit({
      name: trimmedName.slice(0, MAX_NAME),
      price: Math.round(parsedPrice * 100) / 100,
      quantity: qty,
      special_instructions: instructions.trim().slice(0, MAX_INSTRUCTIONS),
    });
    onClose();
  }

  const sheet = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-background shadow-2xl sm:rounded-[28px]"
        style={{ border: "1px solid var(--border)" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-item-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-mist text-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 id="custom-item-title" className="text-lg font-semibold text-foreground">
                Custom item
              </h2>
              <p className="text-xs text-muted-foreground">
                A one-off item with your own price. Not saved to the menu.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-mist text-muted-foreground transition-transform active:scale-90"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <label htmlFor="custom-name" className="mb-2 block text-sm font-semibold text-foreground">
              Name
            </label>
            <input
              id="custom-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              maxLength={MAX_NAME}
              autoFocus
              placeholder="e.g. Off-menu special"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
            />
          </div>

          <div>
            <label
              htmlFor="custom-price"
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Price
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 focus-within:border-foreground">
              <span className="text-sm font-medium text-muted-foreground">{currencySymbol}</span>
              <input
                id="custom-price"
                value={priceText}
                onChange={(e) => {
                  setPriceText(e.target.value.replace(/[^0-9.]/g, ""));
                  setError("");
                }}
                inputMode="decimal"
                placeholder="0.00"
                className="numeric w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-foreground">Quantity</p>
            <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-9 w-9 place-items-center rounded-full bg-mist text-foreground active:scale-90"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-9 text-center text-sm font-semibold text-foreground">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(MAX_QTY, q + 1))}
                className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-background active:scale-90"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="custom-notes"
              className="mb-2 block text-sm font-semibold text-foreground"
            >
              Special instructions
            </label>
            <textarea
              id="custom-notes"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={MAX_INSTRUCTIONS}
              rows={2}
              placeholder="e.g. extra hot, no onions…"
              className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700"
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-card/80 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
          <button
            onClick={handleSubmit}
            className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-foreground text-sm font-semibold text-background transition-transform active:scale-[0.98]"
          >
            {submitLabel}
            <ChevronRight className="h-4 w-4" />
            {total > 0 && <span className="font-display text-base">{formatCurrency(total, currencySymbol, 2)}</span>}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(sheet, document.body);
}
