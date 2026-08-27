import { useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  Check,
  Search,
  ChevronDown,
  X,
  Circle,
  Armchair,
} from "lucide-react";

const ACTIVE_STATUSES = ["pending", "confirmed", "preparing"];

export default function TableSelector() {
  const tables = usePosStore((s) => s.tables);
  const selectedTableId = usePosStore((s) => s.selectedTableId);
  const setSelectedTable = usePosStore((s) => s.setSelectedTable);
  const recentOrders = usePosStore((s) => s.recentOrders);
  const incomingOrders = usePosStore((s) => s.incomingOrders);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");

  // Derive occupied tables from active orders
  const activeOrders = [...recentOrders, ...incomingOrders].filter((o) =>
    ACTIVE_STATUSES.includes(o.status),
  );
  const occupiedByTable = new Map<
    number,
    { amount: string; customer: string | null }
  >();
  for (const order of activeOrders) {
    if (!order.table_id) continue;
    if (!occupiedByTable.has(order.table_id)) {
      occupiedByTable.set(order.table_id, {
        amount: order.total_amount,
        customer: order.customer_name,
      });
    }
  }

  function toggle(tableId: number) {
    setSelectedTable(selectedTableId === tableId ? null : tableId);
  }

  const visibleTables = tables.slice(0, 8);
  const hasMore = tables.length > 8;

  const filteredPickerTables = tables.filter((t) => {
    if (!pickerSearch) return true;
    const q = pickerSearch.toLowerCase();
    return (
      t.table_number.toString().includes(q) ||
      t.name.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Armchair className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Table
        </span>
        {selectedTableId && (
          <button
            onClick={() => setSelectedTable(null)}
            className="ml-auto text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table grid */}
      <div className="grid grid-cols-4 gap-2">
        {visibleTables.map((t) => {
          const selected = selectedTableId === t.id;
          const occupied = occupiedByTable.has(t.id);
          const info = occupiedByTable.get(t.id);
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-2.5 py-2 text-left transition-all active:scale-[0.97] ${
                selected
                  ? "border-ember bg-ember-soft"
                  : occupied
                    ? "border-amber-200 bg-amber-50/60 hover:border-amber-300"
                    : "border-border bg-card hover:border-ember/50 hover:shadow-sm"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={`text-lg font-bold leading-none ${
                    selected ? "text-ember" : "text-foreground"
                  }`}
                >
                  {t.table_number}
                </span>
                {selected ? (
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-ember">
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                  </span>
                ) : occupied ? (
                  <Circle className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                ) : null}
              </div>
              <span className="truncate text-[11px] font-medium text-foreground">
                {t.name || `Table ${t.table_number}`}
              </span>
              <span
                className={`text-[10px] ${
                  occupied ? "text-amber-600" : "text-muted-foreground"
                }`}
              >
                {occupied
                  ? info?.customer
                    ? info.customer
                    : "Occupied"
                  : "Available"}
              </span>
              {occupied && info && (
                <span className="text-[10px] font-bold text-amber-700">
                  {formatCurrency(info.amount, currencySymbol)}
                </span>
              )}
            </button>
          );
        })}

        {!hasMore &&
          Array.from({ length: Math.max(0, 8 - visibleTables.length) }).map(
            (_, i) => (
              <div
                key={`empty-${i}`}
                className="rounded-xl border-2 border-dashed border-border"
              />
            ),
          )}

        {hasMore && (
          <button
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-ember/50 hover:text-ember"
          >
            <ChevronDown className="h-4 w-4" />
            <span className="text-[11px] font-semibold">More tables</span>
          </button>
        )}
      </div>

      {/* ── More tables picker ── */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-bold text-foreground">
                Select Table
              </h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-mist"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search table..."
                  className="w-full rounded-xl border border-border bg-background py-3 pl-10 pr-4 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {filteredPickerTables.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No tables found
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {filteredPickerTables.map((t) => {
                    const selected = selectedTableId === t.id;
                    const occupied = occupiedByTable.has(t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          toggle(t.id);
                          setPickerOpen(false);
                        }}
                        className={`flex flex-col items-center gap-1 rounded-xl border-2 px-2 py-3 transition-all active:scale-[0.97] ${
                          selected
                            ? "border-ember bg-ember-soft"
                            : occupied
                              ? "border-amber-200 bg-amber-50/60"
                              : "border-border bg-background hover:border-ember/50"
                        }`}
                      >
                        <span
                          className={`text-xl font-bold ${
                            selected ? "text-ember" : "text-foreground"
                          }`}
                        >
                          {t.table_number}
                        </span>
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {t.name || `Table ${t.table_number}`}
                        </span>
                        <span
                          className={`text-[10px] ${
                            selected
                              ? "flex items-center gap-1 text-ember"
                              : occupied
                                ? "text-amber-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {selected ? (
                            <>
                              <Check className="h-3 w-3" strokeWidth={3} />
                              Selected
                            </>
                          ) : occupied ? (
                            <>
                              <Circle className="h-2 w-2 fill-amber-400 text-amber-400" />
                              Occupied
                            </>
                          ) : (
                            "Available"
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
