import { createFileRoute } from "@tanstack/react-router";
import { MerchantAnalyticsPage } from "@/features/analytics/pages/MerchantAnalyticsPage";

export const Route = createFileRoute("/merchant/analytics")({
  head: () => ({ meta: [{ title: "Analytics · Merchant · Zentro" }] }),
  component: MerchantAnalyticsPage,
});
