import { createFileRoute } from "@tanstack/react-router";
import { requireCustomer } from "@/lib/auth-guard";
import { CustomerProfilePage } from "@/features/customer-management/pages/CustomerProfilePage";

export const Route = createFileRoute("/profile")({
  beforeLoad: requireCustomer,
  head: () => ({ meta: [{ title: "Profile · Zentro" }] }),
  component: CustomerProfilePage,
});
