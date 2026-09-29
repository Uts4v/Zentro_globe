import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  offerReasonText,
  posOffersApi,
  type OfferEvaluation,
  type PosOfferLookup,
} from "@/lib/api/offers";
import {
  cartFingerprint,
  cartToOrderItems,
  usePosStore,
  type PendingOffer,
  type ServerCartPricing,
} from "./store";

function toServerPricing(evaluation: OfferEvaluation): ServerCartPricing | null {
  const p = evaluation.pricing;
  if (!p) return null;
  return {
    subtotal: p.subtotal,
    discount_total: p.discount_total,
    taxable_total: p.taxable_total,
    tax_total: p.tax_total,
    charge_total: p.charge_total,
    grand_total: p.grand_total,
    prices_include_tax: p.prices_include_tax,
    taxes: p.taxes,
    charges: p.charges,
  };
}

/** Build the cart's pending offer from a server lookup that said "eligible". */
export function pendingOfferFrom(code: string, lookup: PosOfferLookup): PendingOffer {
  const { cart, fulfillmentType } = usePosStore.getState();
  return {
    code,
    claimId: lookup.claim_id,
    summary: lookup.offer.summary,
    customerFirstName: lookup.customer_first_name,
    discount: lookup.evaluation.discount_amount ?? "0",
    pricing: toServerPricing(lookup.evaluation),
    cartKey: cartFingerprint(cart, fulfillmentType),
  };
}

/**
 * Keep a scanned offer honest while the cashier edits the cart: re-ask the
 * server whenever the cart changes, and drop the offer (with the reason) if it
 * no longer applies.
 */
export function usePendingOfferRefresh() {
  const cart = usePosStore((s) => s.cart);
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const pendingOffer = usePosStore((s) => s.pendingOffer);
  const currency = usePosStore((s) => s.posSettings?.currency_symbol) || "Rs";
  const inFlight = useRef(0);

  useEffect(() => {
    if (!pendingOffer) return;
    const key = cartFingerprint(cart, fulfillmentType);
    if (pendingOffer.cartKey === key) return;
    if (cart.length === 0) {
      usePosStore.getState().setPendingOffer(null);
      return;
    }
    const ticket = ++inFlight.current;
    const timer = setTimeout(async () => {
      try {
        const lookup = await posOffersApi.lookup(pendingOffer.code, {
          items: cartToOrderItems(cart),
          fulfillment_type: fulfillmentType,
        });
        if (ticket !== inFlight.current) return;
        if (lookup.evaluation.eligible) {
          usePosStore.getState().setPendingOffer(pendingOfferFrom(pendingOffer.code, lookup));
        } else {
          usePosStore.getState().setPendingOffer(null);
          toast.warning(`Offer removed: ${offerReasonText(lookup.evaluation.reason, currency)}`);
        }
      } catch (e: unknown) {
        if (ticket !== inFlight.current) return;
        usePosStore.getState().setPendingOffer(null);
        toast.warning(`Offer removed: ${(e as Error).message || "it could not be re-checked"}`);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [cart, fulfillmentType, pendingOffer, currency]);
}
