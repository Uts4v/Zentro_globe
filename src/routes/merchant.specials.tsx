// src/routes/merchant.specials.tsx
import { createFileRoute } from "@tanstack/react-router";
import { MerchantSpecialsPage } from "@/features/catalog/pages/MerchantSpecialsPage";

export const Route = createFileRoute("/merchant/specials")({
  head: () => ({ meta: [{ title: "Today's Special · Merchant · Zentro" }] }),
  component: MerchantSpecialsPage,
});
