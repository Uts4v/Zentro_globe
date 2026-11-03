/**
 * Map selected cart line keys to the server order-line ids they became.
 *
 * New lines are appended in cart order, both on a fresh order and when they
 * are consolidated into an existing dine-in bill, so the tail of the server's
 * item list lines up with the cart.
 */
export function mapCartLineKeysToOrderItemIds(
  orderItems: Array<{ id: number }>,
  cart: Array<{ key: string }>,
  lineKeys: string[],
): { ids: number[]; missing: string[] } {
  const offset = orderItems.length - cart.length;
  const ids: number[] = [];
  const missing: string[] = [];

  for (const key of new Set(lineKeys)) {
    const index = cart.findIndex((line) => line.key === key);
    const serverIndex = index + offset;
    const serverItem = index >= 0 && serverIndex >= 0 ? orderItems[serverIndex] : undefined;
    if (serverItem) ids.push(serverItem.id);
    else missing.push(key);
  }

  return { ids, missing };
}
