// src/features/inventory/tabs/movements-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Loader2, Undo2, ArrowLeftRight } from "lucide-react";
import { inventoryApi, type InventoryMovement } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ErrorBlock,
  Field,
  LoadingBlock,
  SectionHeader,
  formatDate,
  formatQty,
  inputCls,
  errorMessage,
  friendlyMovementLabel,
} from "@/features/inventory/components/bits";

const MOVEMENT_TYPES = [
  "",
  "OPENING_BALANCE",
  "RECEIVING",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "COUNT_RECONCILIATION",
  "WASTE",
  "MANUAL_ADJUSTMENT",
  "REVERSAL",
];

const MOVEMENT_STYLE: Record<string, string> = {
  OPENING_BALANCE: "bg-mist text-muted-foreground",
  RECEIVING: "bg-emerald-100 text-emerald-700",
  TRANSFER_IN: "bg-sky-100 text-sky-700",
  TRANSFER_OUT: "bg-violet-100 text-violet-700",
  COUNT_RECONCILIATION: "bg-amber-100 text-amber-700",
  WASTE: "bg-rose-100 text-rose-600",
  MANUAL_ADJUSTMENT: "bg-orange-100 text-orange-700",
  REVERSAL: "bg-black/10 text-muted-foreground",
};

export function MovementsTab() {
  const [rows, setRows] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await inventoryApi.movements({
        movement_type: type || undefined,
      });
      setRows(data.results ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load movements"));
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  async function reverse(m: InventoryMovement) {
    if (
      !window.confirm(`Reverse this ${m.movement_type.replace(/_/g, " ").toLowerCase()} movement?`)
    )
      return;
    setBusyId(m.id);
    try {
      await inventoryApi.reverseMovement(m.id);
      load();
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to reverse movement"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Stock History"
        subtitle="A readable record of what changed and who recorded it."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Field label="Show">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t ? friendlyMovementLabel(t) : "All changes"}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          No movements match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Item / Location</th>
                <th className="px-4 py-3 text-right">Change</th>
                <th className="hidden px-4 py-3 text-right md:table-cell">Balance After</th>
                <th className="hidden px-4 py-3 lg:table-cell">Reason</th>
                <th className="px-4 py-3 text-right">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const qty = Number(m.quantity_change);
                const reversible =
                  m.movement_type !== "REVERSAL" && m.movement_type !== "OPENING_BALANCE";
                return (
                  <tr
                    key={m.id}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${MOVEMENT_STYLE[m.movement_type] ?? "bg-mist text-muted-foreground"}`}
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                        {friendlyMovementLabel(m.movement_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{m.item}</p>
                      <p className="text-xs text-muted-foreground">{m.location_name}</p>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${qty >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {qty >= 0 ? "+" : ""}
                      {formatQty(m.quantity_change)} <span className="text-xs">{m.unit_code}</span>
                    </td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground md:table-cell">
                      {formatQty(m.balance_after)} <span className="text-xs">{m.unit_code}</span>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                      {m.reason || "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {formatDate(m.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {reversible && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Undo this change"
                          disabled={busyId === m.id}
                          onClick={() => reverse(m)}
                        >
                          {busyId === m.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Undo2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
