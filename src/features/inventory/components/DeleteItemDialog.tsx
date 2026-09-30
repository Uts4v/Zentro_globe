// src/features/inventory/components/DeleteItemDialog.tsx
// Delete an item added by mistake (e.g. a duplicate). Items without history
// are removed completely; items with history are hidden and their history
// kept. Remaining stock is removed with a recorded fix, never silently.
import { useState } from "react";
import { toast } from "sonner";
import { inventoryApi, type InventoryItem } from "@/lib/api";
import { ConfirmDialog, errorMessage, formatQty } from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const c = copy.deleteItem;

export function DeleteItemDialog({
  item,
  onOpenChange,
  onDeleted,
}: {
  item: InventoryItem | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { can } = useInventory();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stock = Number(item?.total_stock ?? 0);
  const hasStock = stock > 0;
  const blocked = hasStock && !can(P.ADJUST);

  async function confirm() {
    if (!item || blocked) return;
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.deleteItem(item.id, hasStock);
      toast.success(res.result === "deleted" ? c.deleted(item.name) : c.archived(item.name));
      onOpenChange(false);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={Boolean(item)}
      onOpenChange={(v) => {
        if (!v) setError("");
        onOpenChange(v);
      }}
      title={item ? c.title(item.name) : ""}
      danger
      busy={busy}
      confirmLabel={hasStock ? c.confirmWithStock : c.confirm}
      onConfirm={confirm}
      body={
        <>
          <p>{c.withHistory}</p>
          {hasStock && item && (
            <p className="font-medium text-foreground">
              {c.stockLeft(formatQty(stock), item.base_unit_code)}
            </p>
          )}
          {blocked && <p className="font-medium text-danger">{copy.common.noPermission}</p>}
          {error && (
            <p role="alert" className="font-medium text-danger">
              {error}
            </p>
          )}
        </>
      }
    />
  );
}
