import { createFileRoute } from "@tanstack/react-router";
import { MerchantRedeemPage } from "@/features/offers/merchant/MerchantRedeemPage";

export const Route = createFileRoute("/merchant/redeem")({
  head: () => ({ meta: [{ title: "Redeem Offer · Merchant · Zentro" }] }),
  component: MerchantRedeemPage,
});
