import { useEffect } from "react";
import { subscribePosOrderFeed } from "../orders/feed";
import { handleOrderEvents } from "../voice/coordinator";

/**
 * Headless coordinator: mounts once per terminal, starts the shared order feed
 * and feeds every new order/KOT event to the voice engine. Renders nothing and
 * is never on the order-creation path, so speech can never block an order.
 */
export default function PosVoiceAnnouncer() {
  useEffect(() => {
    const unsubscribe = subscribePosOrderFeed((events) => handleOrderEvents(events));
    return unsubscribe;
  }, []);

  return null;
}
