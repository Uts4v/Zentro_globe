import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Armchair,
  Clock3,
  Loader2,
  MoveRight,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { hasStaffPermission } from "@/lib/staff-session";
import { posListTableStatuses, type PosTableStatus } from "../api";
import { subscribePosRealtime } from "../realtime";
import { useOnlineStatus } from "../offline/hooks";
import { usePosStore } from "../store";
import ChangeTableDialog, { type ChangeTableOrder } from "./ChangeTableDialog";

const POLL_INTERVAL_MS = 5_000;

function areaKey(table: PosTableStatus): string {
  return table.area_id != null ? String(table.area_id) : "none";
}

function openTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function TablesPage() {
  const currencySymbol = usePosStore((s) => s.posSettings?.currency_symbol || "Rs");
  const isOnline = useOnlineStatus();
  const canEditOrders = hasStaffPermission("orders.edit");
  const [tables, setTables] = useState<PosTableStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [changeOrder, setChangeOrder] = useState<ChangeTableOrder | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await posListTableStatuses();
      setTables(data.tables);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err: unknown) {
      setError(
        err instanceof Error && err.message ? err.message : "Could not load table availability.",
      );
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePosRealtime((event) => {
      if (event.event !== "order.changed") return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void load(true);
      }, 250);
    });

    return () => {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  useEffect(() => {
    void load(false);

    const timer = setInterval(() => {
      if (navigator.onLine) void load(true);
    }, POLL_INTERVAL_MS);
    const onOnline = () => void load(true);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void load(true);
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      tables.filter((table) => {
        if (!q) return true;
        return (
          table.name.toLowerCase().includes(q) ||
          String(table.table_number).includes(q) ||
          table.area_name.toLowerCase().includes(q)
        );
      }),
    [tables, q],
  );

  const groups = useMemo(() => {
    const seen = new Map<string, { key: string; title: string; tables: PosTableStatus[] }>();
    for (const table of shown) {
      const key = areaKey(table);
      const group = seen.get(key);
      if (group) group.tables.push(table);
      else {
        seen.set(key, {
          key,
          title: table.area_name || "Tables",
          tables: [table],
        });
      }
    }
    return [...seen.values()];
  }, [shown]);

  const occupiedCount = tables.filter((table) => table.is_occupied).length;
  const freeCount = tables.length - occupiedCount;

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Armchair className="h-5 w-5 text-ember" />
            <h1 className="text-xl font-bold text-foreground">Tables</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-0.5 text-xs font-bold text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Move an open dine-in bill to a free table. The old table becomes available.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={loading || refreshing}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-2xl border border-border bg-card p-3 sm:p-4">
          <p className="text-xs font-medium text-muted-foreground">Tables</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{tables.length}</p>
        </div>
        <div className="rounded-2xl border border-amber-300/50 bg-amber-50 p-3 dark:bg-amber-500/10 sm:p-4">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Occupied</p>
          <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400">
            {occupiedCount}
          </p>
        </div>
        <div className="rounded-2xl border border-success/25 bg-success/5 p-3 sm:p-4">
          <p className="text-xs font-medium text-success">Free</p>
          <p className="mt-1 text-2xl font-bold text-success">{freeCount}</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          {updatedAt ? (
            <span>
              Updated{" "}
              {updatedAt.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ) : (
            <span>Waiting for the first update</span>
          )}
          <span className="text-muted-foreground/60">• refreshes every 5s</span>
        </div>
        {tables.length > 12 && (
          <div className="relative w-full sm:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search table or area..."
              aria-label="Search tables"
              className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
            />
          </div>
        )}
      </div>

      {!isOnline && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Table availability needs a connection. It refreshes when the POS is back online.
          </span>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="mt-3 text-sm">Loading tables...</p>
        </div>
      ) : tables.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border py-14 text-center">
          <Armchair className="mx-auto h-9 w-9 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold text-foreground">No tables set up</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add tables in the merchant dashboard to use table service.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          No tables match your search.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.title}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {group.tables.length}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                {group.tables.map((table) => {
                  const bill = table.bill;
                  const hasMultipleBills = table.open_bill_count > 1;
                  const canMove = canEditOrders && isOnline && Boolean(bill) && !hasMultipleBills;
                  return (
                    <div
                      key={table.id}
                      className={`flex flex-col rounded-2xl border-2 p-4 transition-colors ${
                        table.is_occupied
                          ? "border-amber-300/70 bg-amber-50/70 dark:bg-amber-500/5"
                          : "border-border bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-foreground">
                            {table.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Table {table.table_number}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            table.is_occupied
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-success/10 text-success"
                          }`}
                        >
                          {table.is_occupied ? "Occupied" : "Free"}
                        </span>
                      </div>

                      {table.seats ? (
                        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3.5 w-3.5" />
                          {table.seats} seats
                        </p>
                      ) : null}

                      {table.is_occupied && bill ? (
                        <div className="mt-3 flex-1">
                          <p className="text-lg font-bold text-foreground">
                            {formatCurrency(Number(bill.total_amount), currencySymbol)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {bill.item_count} {bill.item_count === 1 ? "item" : "items"} ·{" "}
                            {bill.status.replace(/_/g, " ")}
                            {openTime(bill.opened_at) ? ` · ${openTime(bill.opened_at)}` : ""}
                          </p>
                          {hasMultipleBills && (
                            <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              {table.open_bill_count} open bills on this table
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={!canMove}
                            title={
                              !isOnline
                                ? "Needs an internet connection"
                                : !canEditOrders
                                  ? "You don't have permission to move bills"
                                  : hasMultipleBills
                                    ? "Close the other open bills on this table first"
                                    : "Move this bill to a free table"
                            }
                            onClick={() =>
                              setChangeOrder({
                                uuid: bill.uuid,
                                table_id: table.id,
                                table_name_snapshot: table.name,
                                table_number_snapshot: table.table_number,
                              })
                            }
                            className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-ink/20 bg-card text-sm font-bold text-ink hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <MoveRight className="h-4 w-4" />
                            Change table
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 flex-1 text-sm font-medium text-muted-foreground">
                          Ready for the next guests.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {changeOrder && (
        <ChangeTableDialog
          open={Boolean(changeOrder)}
          order={changeOrder}
          onClose={() => setChangeOrder(null)}
          onMoved={() => {
            void load(true);
          }}
        />
      )}
    </div>
  );
}
