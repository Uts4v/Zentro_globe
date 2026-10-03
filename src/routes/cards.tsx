import { useState } from "react";
import { createFileRoute, Outlet, useMatches, useNavigate } from "@tanstack/react-router";
import { requireCustomer } from "@/lib/auth-guard";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { MembershipCardStack } from "@/features/cards/components/MembershipCardStack";
import { QRScanner } from "@/features/transfers/components/QRScanner";
import { InstallBanner, UpdateBanner } from "@/features/pwa/InstallZentroButton";
import { Scan } from "lucide-react";

export const Route = createFileRoute("/cards")({
  beforeLoad: requireCustomer,
  head: () => ({ meta: [{ title: "My Cards · Zentro" }] }),
  component: CardsPage,
});

function CardsPage() {
  const matches = useMatches();
  const isIndex = matches[matches.length - 1]?.routeId === "/cards";
  const navigate = useNavigate();
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <MobileShell>
      <TopBar
        right={
          <button
            onClick={() => setScannerOpen(true)}
            aria-label="Scan QR"
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            <Scan className="h-4 w-4" />
          </button>
        }
      />
      <div className="h-dvh overflow-hidden overscroll-none px-5 pb-10 pt-2">
        {isIndex ? <MembershipCardStack /> : <Outlet />}
      </div>

      <InstallBanner />
      <UpdateBanner />

      {scannerOpen && (
        <QRScanner
          onScan={(code) => {
            setScannerOpen(false);
            navigate({ to: "/transfers", search: { code } });
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </MobileShell>
  );
}
