// src/routes/merchant.customers.tsx
import { createFileRoute } from "@tanstack/react-router";
import { MerchantCustomersPage } from "@/features/loyalty-engine/pages/MerchantCustomersPage";

export const Route = createFileRoute("/merchant/customers")({
  head: () => ({ meta: [{ title: "Customers · Merchant · Zentro" }] }),
  component: MerchantCustomersPage,
});
