import { createFileRoute } from "@tanstack/react-router";
import { StoresPage } from "@/features/store-locator/pages/StoresPage";

export const Route = createFileRoute("/stores")({
  head: () => ({ meta: [{ title: "Discover Cafés · Zentro" }] }),
  component: StoresPage,
});
