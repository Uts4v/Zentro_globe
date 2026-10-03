import { createFileRoute } from "@tanstack/react-router";
import { CustomerOrdersPage } from "@/features/transactions/pages/CustomerOrdersPage";

export const Route = createFileRoute("/customer/orders")({
  head: () => ({ meta: [{ title: "My Orders · Zentro" }] }),
  component: CustomerOrdersPage,
});
