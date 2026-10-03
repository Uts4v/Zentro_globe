import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";
import { CustomerLoyaltyPage } from "@/features/loyalty-engine/pages/CustomerLoyaltyPage";

export const Route = createFileRoute("/loyalty")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Loyalty · Zentro" }] }),
  component: CustomerLoyaltyPage,
});
