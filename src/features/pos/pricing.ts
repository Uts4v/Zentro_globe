import { useMemo } from "react";
import { previewPricing, resolveTaxComponents, type PreviewResult } from "@/lib/pricing/preview";
import { usePosStore } from "./store";

export type PosCartPricing = PreviewResult & {
  /** Numeric copies for UI arithmetic (cash change, validation). */
  subtotalValue: number;
  discountValue: number;
  taxValue: number;
  chargeValue: number;
  totalValue: number;
};

/**
 * Preview of what the server will charge for the current POS cart, using the
 * same rules as the backend pricing engine (tax policy, exempt items, service
 * charge, the pending manual discount). The order itself is always priced on
 * the server; payments use the server's total once the order exists.
 */
export function usePosCartPricing(): PosCartPricing {
  const cart = usePosStore((s) => s.cart);
  const menu = usePosStore((s) => s.menu);
  const settings = usePosStore((s) => s.posSettings);
  const fulfillmentType = usePosStore((s) => s.fulfillmentType);
  const pendingDiscount = usePosStore((s) => s.pendingDiscount);

  return useMemo(() => {
    const taxClassById = new Map<number, string>();
    for (const items of Object.values(menu?.categories ?? {})) {
      for (const item of items) taxClassById.set(item.id, item.tax_class ?? "standard");
    }

    const isDineIn = fulfillmentType === "dine-in" || fulfillmentType === "dine_in";
    const servicePct = Number(settings?.service_charge_percent ?? 0);
    const chargesService =
      servicePct > 0 && (isDineIn || settings?.service_charge_dine_in_only === false);

    const result = previewPricing({
      currency: settings?.currency_code || "NPR",
      policy: settings?.tax_policy || "legacy",
      taxComponents: settings ? resolveTaxComponents(settings) : [],
      lines: cart.map((item) => ({
        key: item.key,
        quantity: item.quantity,
        unitPrice: item.price,
        taxClass: taxClassById.get(item.menu_item_id) ?? "standard",
      })),
      adjustment: pendingDiscount
        ? { calcType: pendingDiscount.type, value: pendingDiscount.value }
        : null,
      charges: chargesService
        ? [
            {
              kind: "service",
              label: "Service charge",
              calcType: "percentage",
              value: settings?.service_charge_percent ?? 0,
            },
          ]
        : [],
    });

    return {
      ...result,
      subtotalValue: Number(result.subtotal),
      discountValue: Number(result.discountTotal),
      taxValue: Number(result.taxTotal),
      chargeValue: Number(result.chargeTotal),
      totalValue: Number(result.grandTotal),
    };
  }, [cart, menu, settings, fulfillmentType, pendingDiscount]);
}
