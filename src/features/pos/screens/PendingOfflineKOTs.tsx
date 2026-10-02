import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Printer, Ticket } from "lucide-react";
import { offlineOrders, OfflineKOT } from "../offline/db";
import { printKOT, type KOTTicketData } from "../printing/kot-markup";
import { tableLabel } from "../printing/table-label";
import { useOnlineStatus, useSyncRevision } from "../offline/hooks";
import { formatCurrency } from "@/lib/currency";
import { usePosStore } from "../store";

/**
 * The stored offline ticket has no KOT number — the server assigns that on
 * sync — so it is filled in as null and `printKOT` simply omits the badge.
 *
 * It also stores no logo, so the one from the live merchant is passed in.
 */
function toTicketData(kot: OfflineKOT, merchantLogoUrl?: string | null): KOTTicketData {
  return {
    merchantName: kot.merchantName,
    merchantLogoUrl: merchantLogoUrl ?? null,
    kotNumber: null,
    orderNumber: kot.orderNumber,
    createdAt: kot.createdAt,
    fulfillmentType: kot.fulfillmentType,
    tableName: kot.tableName ?? null,
    tableNumber: kot.tableNumber ?? null,
    customerName: null,
    workerName: kot.workerName ?? null,
    notes: kot.notes ?? "",
    items: kot.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      special_instructions: item.special_instructions ?? "",
      options: item.options ?? [],
    })),
  };
}

/**
 * Tickets for orders captured while offline.
 *
 * The kitchen display is server-driven and stays empty until the order syncs,
 * so a printed ticket is the only way the kitchen gets the order. This keeps
 * those tickets reachable after the payment sheet closes, and the list empties
 * itself once the orders sync (a synced order reprints from the orders list
 * with its real KOT number).
 */
export default function PendingOfflineKOTs() {
  const isOnline = useOnlineStatus();
  const syncRevision = useSyncRevision();
  const currencySymbol = usePosStore((s) => s.posSettings?.currency_symbol) || "Rs";
  const merchantLogoUrl = usePosStore((s) => s.merchant?.logo_url);
  const [orders, setOrders] = useState<Array<{ id: string; total: number; kot: OfflineKOT }>>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const pending = await offlineOrders.getPending();
    setOrders(
      pending
        .filter((o) => o.kot)
        .map((o) => ({ id: o.id, total: o.total, kot: o.kot as OfflineKOT })),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load, isOnline, syncRevision]);

  if (orders.length === 0) return null;

  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Ticket className="h-3.5 w-3.5 shrink-0 text-warning" />
        <span className="flex-1 text-xs font-semibold text-warning">
          {orders.length} offline ticket{orders.length === 1 ? "" : "s"}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-warning" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-warning" />
        )}
      </button>

      {open && (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-warning/20 px-2 py-2">
          {orders.map(({ id, total, kot }) => {
            const tableNumber = kot.tableNumber;
            const tableName = (kot.tableName ?? "").trim();
            return (
              <li key={id} className="flex items-center gap-2 rounded-lg bg-card/60 px-1.5 py-1.5">
                {/* Table leads: staff find a ticket by the table it is on, so
                    the number gets its own untruncatable badge. */}
                {tableNumber != null ? (
                  <span
                    title={tableName || `Table ${tableNumber}`}
                    className="numeric grid h-7 shrink-0 place-items-center rounded-md bg-ink px-2 text-[11px] font-bold text-white"
                  >
                    #{tableNumber}
                  </span>
                ) : tableName ? (
                  <span
                    title={tableName}
                    className="max-w-[6.5rem] shrink-0 truncate rounded-md bg-ink/10 px-2 py-1 text-[10px] font-semibold text-foreground"
                  >
                    {tableName}
                  </span>
                ) : null}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {kot.orderNumber}
                    {tableNumber != null && tableName && (
                      <span className="ml-1 font-normal text-muted-foreground">{tableName}</span>
                    )}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {kot.createdAt
                      ? new Date(kot.createdAt).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}{" "}
                    · {formatCurrency(total, currencySymbol)}
                  </p>
                </div>
                <button
                  onClick={() => printKOT(toTicketData(kot, merchantLogoUrl))}
                  title={`Reprint KOT ${kot.orderNumber}${tableLabel(kot.tableName, kot.tableNumber) ? ` — Table ${tableLabel(kot.tableName, kot.tableNumber)}` : ""}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning hover:bg-warning/25"
                >
                  <Printer className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
