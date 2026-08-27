import { createFileRoute } from "@tanstack/react-router";
import { MerchantReportsPage } from "@/features/reports/pages/MerchantReportsPage";

export const Route = createFileRoute("/merchant/reports")({
  head: () => ({ meta: [{ title: "Reports · Merchant · Zentro" }] }),
  component: MerchantReportsPage,
});
