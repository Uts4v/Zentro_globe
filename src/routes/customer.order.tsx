// routes/customer/order.tsx - Deprecated legacy ordering screen, redirects to main explore
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/customer/order")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
  head: () => ({ meta: [{ title: "Order · Zentro" }] }),
  component: () => null,
});
