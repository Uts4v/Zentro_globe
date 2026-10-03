// C:\Users\ACER\Desktop\NTE Loyalty\zentro-glow-loyalty\src\routes\merchant.loyalty.tsx
import { createFileRoute } from "@tanstack/react-router";
import { MerchantLoyaltyPage } from "@/features/loyalty-engine/pages/MerchantLoyaltyPage";

export const Route = createFileRoute("/merchant/loyalty")({
  head: () => ({ meta: [{ title: "Loyalty · Merchant · Zentro" }] }),
  component: MerchantLoyaltyPage,
});
