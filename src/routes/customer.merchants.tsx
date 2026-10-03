// src/routes/customer.merchants.tsx
import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/lib/auth-guard";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { JoinedMerchantsSection } from "@/features/dashboard/JoinedMerchantsSection";

export const Route = createFileRoute("/customer/merchants")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Your cafés · Zentro" }] }),
  component: CustomerMerchantsPage,
});

function CustomerMerchantsPage() {
  return (
    <MobileShell>
      <TopBar title="Your cafés" />
      <div className="px-5 pb-10 pt-2">
        <JoinedMerchantsSection />
      </div>
    </MobileShell>
  );
}
