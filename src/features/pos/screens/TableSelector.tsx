import { useEffect, useMemo, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import { Armchair, Check, Circle, Search } from "lucide-react";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing"];
const ALL = "all";
const NO_AREA = "none";

/**
 * Tables, organised by dining area (Main Dining, Bar, Rooftop…).
 * An employee assigned to certain areas only sees those; the server enforces
 * the same rule when an order is created.
 */
export default function TableSelector() {
  const tables = usePosStore((s) => s.tables);
  const selectedTableId = usePosStore((s) => s.selectedTableId);
  const setSelectedTable = usePosStore((s) => s.setSelectedTable);
  const recentOrders = usePosStore((s) => s.recentOrders);
  const incomingOrders = usePosStore((s) => s.incomingOrders);
  const posSettings = usePosStore((s) => s.posSettings);
  const currentWorker = usePosStore((s) => s.currentWorker);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [search, setSearch] = useState("");

  // AREA = where the employee works. No assigned areas means every area.
  const allowedAreas = currentWorker?.area_ids ?? null;
  const visibleTables = useMemo(
    () =>
      allowedAreas && allowedAreas.length > 0
        ? tables.filter((t) => t.area_id != null && allowedAreas.includes(t.area_id))
        : tables,
    [tables, allowedAreas],
  );

  const areas = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of visibleTables) {
      const key = t.area_id != null ? String(t.area_id) : NO_AREA;
      if (!seen.has(key)) seen.set(key, t.area_name || "Tables");
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [visibleTables]);

  const selectedTable = visibleTables.find((t) => t.id === selectedTableId);
  const [area, setArea] = useState<string>(ALL);
  // Open on the selected table's area, or the first area when there are several.
  useEffect(() => {
    if (areas.length <= 1) {
      setArea(ALL);
      return;
    }
    setArea((current) => {
      if (current !== ALL && areas.some((a) => a.key === current)) return current;
      if (selectedTable)
        return selectedTable.area_id != null ? String(selectedTable.area_id) : NO_AREA;
      return areas[0].key;
    });
  }, [areas, selectedTable]);

  // Derive occupied tables from active orders
  const occupiedByTable = new Map<number, { amount: string; customer: string | null }>();
  for (const order of [...recentOrders, ...incomingOrders]) {
    if (!order.table_id || !ACTIVE_STATUSES.includes(order.status)) continue;
    if (!occupiedByTable.has(order.table_id)) {
      occupiedByTable.set(order.table_id, {
        amount: order.total_amount,
        customer: order.customer_name,
      });
    }
  }

  const q = search.trim().toLowerCase();
  const shown = visibleTables.filter((t) => {
    if (q) return t.name.toLowerCase().includes(q) || String(t.table_number).includes(q);
    if (area === ALL) return true;
    return (t.area_id != null ? String(t.area_id) : NO_AREA) === area;
  });

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Armchair className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tables
        </span>
        {selectedTable && (
          <span className="rounded-full bg-ember-soft px-2 py-0.5 text-xs font-semibold text-ember">
            {selectedTable.name}
          </span>
        )}
        {selectedTableId && (
          <button
            type="button"
            onClick={() => setSelectedTable(null)}
            className="ml-auto min-h-[44px] px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Area chips */}
      {areas.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Area"
          className="-mx-1 mb-2 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {areas.map((a) => {
            const active = a.key === area && !q;
            return (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setSearch("");
                  setArea(a.key);
                }}
                className={`inline-flex h-11 shrink-0 items-center rounded-full border-2 px-4 text-sm font-semibold transition-colors ${
                  active
                    ? "border-ember bg-ember text-white"
                    : "border-border bg-card text-foreground hover:border-ember/50"
                }`}
              >
                {a.name}
              </button>
            );
          })}
        </div>
      )}

      {visibleTables.length > 12 && (
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search table"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search table…"
            className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl border-2 border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          {visibleTables.length === 0 ? "No tables to show." : "No tables found."}
        </p>
      ) : (
        // Columns follow the width of the panel the picker sits in (wide cart on
        // desktop, narrow drawer on tablets/phones), never the screen width, so a
        // tile is always wide enough to read the table name.
        <div className="grid max-h-[46vh] grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2 overflow-y-auto pr-0.5">
          {shown.map((t) => {
            const selected = selectedTableId === t.id;
            const info = occupiedByTable.get(t.id);
            const occupied = Boolean(info);
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedTable(selected ? null : t.id)}
                className={`relative flex min-h-[76px] min-w-0 flex-col items-start justify-between gap-0.5 rounded-xl border-2 px-2.5 py-2 text-left transition-all active:scale-[0.97] ${
                  selected
                    ? "border-ember bg-ember-soft"
                    : occupied
                      ? "border-amber-200 bg-amber-50/60 hover:border-amber-300"
                      : "border-border bg-card hover:border-ember/50 hover:shadow-sm"
                }`}
              >
                {selected ? (
                  <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ember">
                    <Check className="h-3 w-3 text-white" strokeWidth={3.5} aria-hidden="true" />
                  </span>
                ) : occupied ? (
                  <Circle
                    className="absolute right-2 top-2 h-2.5 w-2.5 fill-amber-400 text-amber-400"
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className={`w-full break-words pr-5 text-base font-bold leading-tight ${selected ? "text-ember" : "text-foreground"}`}
                >
                  {t.name || `Table ${t.table_number}`}
                </span>
                <span
                  className={`w-full truncate text-xs font-medium ${occupied ? "text-amber-700" : "text-muted-foreground"}`}
                >
                  {occupied ? info?.customer || "Occupied" : "Available"}
                </span>
                <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                  {occupied && info ? (
                    <span className="font-bold text-amber-700">
                      {formatCurrency(info.amount, currencySymbol)}
                    </span>
                  ) : t.seats ? (
                    `${t.seats} seats`
                  ) : (
                    ""
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
