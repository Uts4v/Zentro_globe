import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, Ticket, X } from "lucide-react";
import { toast } from "sonner";
import { safeUuid } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import {
  offerReasonText,
  posOffersApi,
  type PosOfferLookup,
  type RewardOption,
} from "@/lib/api/offers";
import { QrCameraScanner } from "@/features/offers/components/QrCameraScanner";
import { cartToOrderItems, usePosStore } from "../store";
import { pendingOfferFrom } from "../offers";

/**
 * Staff scan or type a customer's offer code. The server says whether it is
 * valid here and what it is worth on this cart; nothing is redeemed until the
 * order is paid (or the cashier confirms an in-store use with no order).
 */
export default function RedeemOfferModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cart = usePosStore((s) => s.cart);
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const addItemToCart = usePosStore((s) => s.addItemToCart);
  const setPendingOffer = usePosStore((s) => s.setPendingOffer);
  const currencySymbol = usePosStore((s) => s.posSettings?.currency_symbol) || "Rs";

  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PosOfferLookup | null>(null);
  const [bill, setBill] = useState("");
  const attemptKey = useRef(safeUuid());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCode("");
    setResult(null);
    setBill("");
    setError(null);
    setScanning(false);
    setTimeout(() => inputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function check(raw = code) {
    const value = raw.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    setScanning(false);
    try {
      const lookup = await posOffersApi.lookup(
        value,
        cart.length
          ? {
              items: cartToOrderItems(usePosStore.getState().cart),
              fulfillment_type: fulfillmentType,
            }
          : {},
      );
      setCode(value);
      setResult(lookup);
      attemptKey.current = safeUuid();
    } catch (e: unknown) {
      setResult(null);
      setError((e as Error).message || "Couldn't check that code.");
    } finally {
      setBusy(false);
    }
  }

  function addReward(option: RewardOption) {
    const price = Number(option.price) || 0;
    addItemToCart({
      menu_item_id: option.menu_item_id,
      name: option.name,
      price,
      quantity: 1,
      subtotal: price,
      selections: option.selections,
      special_instructions: "",
    });
    // Re-check with the reward now in the cart.
    setTimeout(() => check(code), 0);
  }

  function apply() {
    if (!result) return;
    setPendingOffer(pendingOfferFrom(code, result));
    toast.success("Offer added. It's applied when the order is placed.");
    onClose();
  }

  async function confirmInStore() {
    if (!result || !currentWorker) return;
    if (result.needs_bill_amount && !(Number(bill) > 0)) {
      setError(`Enter the ${result.bill_label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const done = await posOffersApi.redeemInStore({
        code,
        worker_id: currentWorker.id,
        // Stable per lookup so a double tap or retry can't redeem twice.
        idempotency_key: attemptKey.current,
        ...(result.needs_bill_amount ? { bill_amount: bill } : {}),
      });
      toast.success(
        done.discount_amount
          ? `Offer confirmed: give ${formatCurrency(done.discount_amount, currencySymbol)} off.`
          : "Offer confirmed.",
      );
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't confirm the offer.");
    } finally {
      setBusy(false);
    }
  }

  const evaluation = result?.evaluation;
  const eligible = Boolean(evaluation?.eligible);
  const rewardOptions = evaluation?.reward_options ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="redeem-offer-title"
        className="mx-0 w-full max-w-md rounded-t-3xl bg-card p-6 shadow-2xl sm:mx-4 sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3
            id="redeem-offer-title"
            className="flex items-center gap-2 text-base font-bold text-foreground"
          >
            <Ticket className="h-5 w-5 text-ember" /> Redeem Offer
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {scanning ? (
          <QrCameraScanner onResult={(text) => check(text)} />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              check();
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ZNT-XXXX-XXXXX or scan"
              aria-label="Offer code"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3 font-mono text-sm uppercase tracking-wider focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setScanning(true)}
              aria-label="Scan with camera"
              className="grid h-11 w-11 place-items-center rounded-xl bg-mist text-foreground"
            >
              <Camera className="h-4 w-4" />
            </button>
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl bg-ember-soft p-4">
              <p className="text-xs text-muted-foreground">
                {result.customer_first_name
                  ? `${result.customer_first_name}'s offer`
                  : "Customer offer"}{" "}
                · {result.code}
              </p>
              <p className="font-display text-xl text-ember">{result.offer.summary}</p>
              {result.offer.conditions.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.offer.conditions.join(" · ")}
                </p>
              )}
            </div>

            {cart.length > 0 && eligible && (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <Check className="h-4 w-4" /> Valid:{" "}
                {formatCurrency(evaluation?.discount_amount ?? 0, currencySymbol)} off this order
              </p>
            )}
            {!eligible && evaluation?.reason && (
              <p className="text-sm text-ember">
                {offerReasonText(evaluation.reason, currencySymbol)}
              </p>
            )}
            {rewardOptions.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Add the customer's free item:
                </p>
                <div className="flex flex-wrap gap-2">
                  {rewardOptions.map((o) => (
                    <button
                      key={`${o.menu_item_id}-${o.selections.map((x) => x.option_id).join(".")}`}
                      onClick={() => addReward(o)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground"
                    >
                      + {o.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {cart.length === 0 && eligible && result.needs_bill_amount && (
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  {result.bill_label} ({currencySymbol})
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={bill}
                  onChange={(e) => setBill(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-muted/50 px-3 text-sm focus:border-ink focus:outline-none"
                />
              </label>
            )}

            <div className="flex gap-2 pt-1">
              {cart.length > 0 ? (
                <button
                  onClick={apply}
                  disabled={!eligible}
                  className="h-11 flex-1 rounded-xl bg-ink text-sm font-bold text-primary-foreground disabled:opacity-40"
                >
                  Apply to this order
                </button>
              ) : (
                <button
                  onClick={confirmInStore}
                  disabled={!eligible || busy || !currentWorker}
                  className="h-11 flex-1 rounded-xl bg-ink text-sm font-bold text-primary-foreground disabled:opacity-40"
                >
                  Confirm use (no order)
                </button>
              )}
            </div>
            {cart.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No items in the cart: confirming records the offer as used at the counter. Add items
                first to discount a sale.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
