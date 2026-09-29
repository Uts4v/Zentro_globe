import { createFileRoute } from "@tanstack/react-router";
import { MerchantOffersPage } from "@/features/offers/merchant/MerchantOffersPage";

export const Route = createFileRoute("/merchant/offers")({
  head: () => ({ meta: [{ title: "Offers · Merchant · Zentro" }] }),
  component: MerchantOffersPage,
});
