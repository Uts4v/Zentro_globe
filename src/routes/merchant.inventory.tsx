import { createFileRoute } from "@tanstack/react-router";
import { InventoryPage } from "@/features/inventory/pages/InventoryPage";

type InventorySearch = {
  view?: string;
  item?: number;
  count?: number;
  location?: number;
  report?: string;
  import?: number;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const Route = createFileRoute("/merchant/inventory")({
  head: () => ({ meta: [{ title: "Inventory · Merchant · Zentro" }] }),
  validateSearch: (search: Record<string, unknown>): InventorySearch => ({
    view: typeof search.view === "string" ? search.view : undefined,
    item: num(search.item),
    count: num(search.count),
    location: num(search.location),
    report: typeof search.report === "string" ? search.report : undefined,
    import: num(search.import),
  }),
  component: InventoryPage,
});
