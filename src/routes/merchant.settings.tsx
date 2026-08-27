import { createFileRoute } from "@tanstack/react-router";
import { MerchantSettingsPage } from "@/features/settings/pages/MerchantSettingsPage";

export const Route = createFileRoute("/merchant/settings")({
  head: () => ({ meta: [{ title: "Settings · Merchant · Zentro" }] }),
  component: MerchantSettingsPage,
});
