/**
 * Pure cart → request payload mapping, kept free of runtime imports so it can
 * be unit-tested outside the browser. `store.ts` re-exports these.
 */
import type { MenuSelection } from "@/lib/api/types";
import type { PosOrderItemPayload } from "./api";

/**
 * One POS cart line. `key` identifies menu item + selections + instructions so
 * that "Small Latte" and "Large Latte" stay two lines instead of collapsing
 * into one when the cashier taps the same product twice.
 */
export type PosOrderItem = {
  key: string;
  /** Null for an ad-hoc custom line (`is_custom`), which is not in the menu. */
  menu_item_id: number | null;
  name: string;
  price: number;
  quantity: number;
  subtotal: number;
  selections: MenuSelection[];
  special_instructions: string;
  /** Given free by staff: charged nothing, `price` keeps the normal price for display. */
  is_free?: boolean;
  /** A one-off staff line with a manual price; never in the menu catalog. */
  is_custom?: boolean;
};

/**
 * Build the order payload items for a POS cart.
 *
 * Selections and instructions must travel with every line: the server prices
 * from the submitted selections, so a line sent without them would either be
 * rejected (required group) or priced as the unconfigured base variant.
 *
 * A custom line carries its own name and manual price instead of a menu item.
 */
export function cartToOrderItems(cart: PosOrderItem[]): PosOrderItemPayload[] {
  return cart.map((item) =>
    item.is_custom
      ? {
          is_custom: true,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          special_instructions: item.special_instructions,
          ...(item.is_free ? { is_free: true } : {}),
        }
      : {
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          selections: item.selections,
          special_instructions: item.special_instructions,
          ...(item.is_free ? { is_free: true } : {}),
        },
  );
}

/**
 * Cart lines an offer can be evaluated against. A custom line has no menu item,
 * so offers cannot target it; it is dropped from the availability check.
 */
export function cartToOfferLines(cart: PosOrderItem[]) {
  return cart
    .filter((item) => !item.is_custom && item.menu_item_id != null)
    .map((item) => ({
      menu_item_id: item.menu_item_id as number,
      quantity: item.quantity,
      selections: item.selections,
      special_instructions: item.special_instructions,
    }));
}
