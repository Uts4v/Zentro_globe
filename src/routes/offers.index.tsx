import { createFileRoute } from "@tanstack/react-router";
import { OffersPage } from "@/features/offers/pages/OffersPage";

export const Route = createFileRoute("/offers/")({
  head: () => ({ meta: [{ title: "Offers · Zentro" }] }),
  component: OffersPage,
});
