// src/routes/transfers.tsx — Point transfer hub
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { requireAuth } from "@/lib/auth-guard";
import { MobileShell, TopBar } from "@/components/MobileShell";
import { PersonalQR } from "@/features/transfers/components/PersonalQR";
import { TransferForm } from "@/features/transfers/components/TransferForm";
import { TransferHistory } from "@/features/transfers/components/TransferHistory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/transfers")({
  beforeLoad: requireAuth,
  head: () => ({ meta: [{ title: "Transfer points · Zentro" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    code: (search.code as string) || undefined,
  }),
  component: TransfersPage,
});

function TransfersPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { code } = Route.useSearch();

  return (
    <MobileShell>
      <TopBar title="Transfer points" />
      <div className="px-5 pb-10 pt-2">
        <Tabs defaultValue="send" className="w-full">
          <TabsList className="mb-6 grid w-full grid-cols-3">
            <TabsTrigger value="send">Send</TabsTrigger>
            <TabsTrigger value="receive">Receive</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="send">
            <TransferForm
              scannedTransferCode={code}
              onSuccess={() => setRefreshKey((k) => k + 1)}
            />
          </TabsContent>

          <TabsContent value="receive">
            <div className="glass-strong rounded-[28px] p-6">
              <PersonalQR />
            </div>
          </TabsContent>

          <TabsContent value="history">
            <TransferHistory refreshKey={refreshKey} />
          </TabsContent>
        </Tabs>
      </div>
    </MobileShell>
  );
}
