// routes/merchant.team.tsx — Team: employees, roles & permissions
import { createFileRoute } from "@tanstack/react-router";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { TeamPage } from "@/features/team/TeamPage";

export const Route = createFileRoute("/merchant/team")({
  beforeLoad: requireMerchant,
  head: () => ({ meta: [{ title: "Team · Merchant · Zentro" }] }),
  component: TeamPage,
});
