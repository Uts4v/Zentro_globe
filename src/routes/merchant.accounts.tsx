// routes/merchant.accounts.tsx — Accounts: cash, bank, suppliers, salaries, money reports
import { createFileRoute } from "@tanstack/react-router";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { AccountsPage } from "@/features/accounts/AccountsPage";

export const Route = createFileRoute("/merchant/accounts")({
  beforeLoad: requireMerchant,
  head: () => ({ meta: [{ title: "Accounts · Merchant · Zentro" }] }),
  component: AccountsPage,
});
