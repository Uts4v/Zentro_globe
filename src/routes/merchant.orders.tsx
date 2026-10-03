import { createFileRoute } from "@tanstack/react-router";
import { MerchantOrdersPage } from "@/features/transactions/pages/MerchantOrdersPage";

export const Route = createFileRoute("/merchant/orders")({
  head: () => ({ meta: [{ title: "Orders · Merchant · Zentro" }] }),
  component: MerchantOrdersPage,
});
