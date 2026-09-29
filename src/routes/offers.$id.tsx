import { createFileRoute } from "@tanstack/react-router";
import { OfferDetailPage } from "@/features/offers/pages/OfferDetailPage";

export const Route = createFileRoute("/offers/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    t: typeof search.t === "string" && search.t ? search.t : undefined,
  }),
  head: () => ({ meta: [{ title: "Offer · Zentro" }] }),
  component: OfferRoute,
});

function OfferRoute() {
  const { id } = Route.useParams();
  const { t } = Route.useSearch();
  return <OfferDetailPage id={id} linkToken={t} />;
}
