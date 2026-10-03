import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";
import { StoreDetailPage } from "@/features/store-locator/pages/StoreDetailPage";

export const Route = createFileRoute("/stores_/$id")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Store · Zentro" }] }),
  component: StoreDetailPage,
});
