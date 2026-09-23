import { createFileRoute } from "@tanstack/react-router";
import { InventoryPage } from "@/features/inventory/pages/InventoryPage";

export const Route = createFileRoute("/merchant/inventory")({
  head: () => ({ meta: [{ title: "Inventory · Merchant · Zentro" }] }),
  component: InventoryPage,
});
