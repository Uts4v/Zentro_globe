import { createFileRoute } from "@tanstack/react-router";
import { requireCustomer } from "@/lib/auth-guard";
import { MyOffersPage } from "@/features/offers/pages/MyOffersPage";

export const Route = createFileRoute("/offers/mine")({
  beforeLoad: requireCustomer,
  head: () => ({ meta: [{ title: "My Offers · Zentro" }] }),
  component: MyOffersPage,
});
