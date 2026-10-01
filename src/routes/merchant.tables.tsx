// routes/merchant.tables.tsx — Tables & Areas (where customers sit) and table QR codes
import { createFileRoute } from "@tanstack/react-router";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { TablesAreasPage } from "@/features/tables/TablesAreasPage";

export const Route = createFileRoute("/merchant/tables")({
  beforeLoad: requireMerchant,
  head: () => ({ meta: [{ title: "Tables & Areas · Merchant · Zentro" }] }),
  component: TablesAreasPage,
});
