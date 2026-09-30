// src/features/inventory/screens/ActionsScreen.tsx
// Add / Move Stock action centre: big task cards, no technical tabs.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeftRight, Check, PackageMinus, SlidersHorizontal, Truck, X } from "lucide-react";
import { inventoryApi, type Adjustment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ActionCard,
  ConfirmDialog,
  ErrorBlock,
  ScreenHeader,
  errorMessage,
  formatDateTime,
  formatQty,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const a = copy.actions;

export function ActionsScreen() {
  const { can, go, refresh } = useInventory();
  const pending = useQuery({
    queryKey: ["inventory", "adjustments", "pending"],
    queryFn: () => inventoryApi.adjustments({ status: "PENDING", page_size: 50 }),
    enabled: can(P.APPROVE_ADJUSTMENT),
  });
  const [deciding, setDeciding] = useState<{
    adj: Adjustment;
    decision: "approve" | "reject";
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide() {
    if (!deciding) return;
    setBusy(true);
    setError("");
    try {
      await inventoryApi.decideAdjustment(deciding.adj.id, deciding.decision);
      toast.success(deciding.decision === "approve" ? copy.fix.successTitle : a.reject);
      setDeciding(null);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
      setDeciding(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ScreenHeader title={a.title} subtitle={a.subtitle} onBack={() => go("home")} />
      <div className="grid gap-3 sm:grid-cols-2">
        {can(P.RECEIVE) && (
          <ActionCard
            icon={Truck}
            title={a.addDelivery}
            description={a.addDeliveryHint}
            onClick={() => go("delivery")}
          />
        )}
        {can(P.TRANSFER) && (
          <ActionCard
            icon={ArrowLeftRight}
            title={a.moveStock}
            description={a.moveStockHint}
            onClick={() => go("move")}
          />
        )}
        {can(P.RECORD_WASTE) && (
          <ActionCard
            icon={PackageMinus}
            title={a.recordWaste}
            description={a.recordWasteHint}
            onClick={() => go("waste")}
          />
        )}
        {can(P.ADJUST) && (
          <ActionCard
            icon={SlidersHorizontal}
            title={a.fixStock}
            description={a.fixStockHint}
            onClick={() => go("fix")}
          />
        )}
      </div>

      {error && <ErrorBlock message={error} />}

      {(pending.data?.results.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{a.waitingFixes}</h3>
          <ul className="space-y-2">
            {pending.data?.results.map((adj) => {
              const delta = Number(adj.quantity_delta);
              return (
                <li
                  key={adj.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {adj.item_name}{" "}
                      <span className={delta > 0 ? "text-olive" : "text-danger"}>
                        {delta > 0 ? "+" : "−"}
                        {formatQty(Math.abs(delta))} {adj.unit_code}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {adj.location_name} · {adj.reason} · {adj.performed_by_name} ·{" "}
                      {formatDateTime(adj.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="h-11"
                      onClick={() => setDeciding({ adj, decision: "reject" })}
                    >
                      <X className="h-4 w-4" aria-hidden="true" /> {a.reject}
                    </Button>
                    <Button
                      className="h-11"
                      onClick={() => setDeciding({ adj, decision: "approve" })}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" /> {a.approve}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(deciding)}
        onOpenChange={(v) => !v && setDeciding(null)}
        title={deciding?.decision === "approve" ? copy.fix.confirmTitle : `${a.reject}?`}
        busy={busy}
        danger={deciding?.decision === "reject"}
        confirmLabel={deciding?.decision === "approve" ? a.approve : a.reject}
        onConfirm={decide}
        body={
          deciding && (
            <p className="text-base text-foreground">
              {deciding.adj.item_name}: {Number(deciding.adj.quantity_delta) > 0 ? "+" : "−"}
              {formatQty(Math.abs(Number(deciding.adj.quantity_delta)))} {deciding.adj.unit_code} ·{" "}
              {deciding.adj.reason}
            </p>
          )
        }
      />
    </div>
  );
}
