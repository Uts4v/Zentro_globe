import { createFileRoute } from "@tanstack/react-router";
import { MerchantMenuPage } from "@/features/catalog/pages/MerchantMenuPage";

export const Route = createFileRoute("/merchant/menu")({
  head: () => ({ meta: [{ title: "Menu · Merchant · Zentro" }] }),
  component: MerchantMenuPage,
});
