import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Armchair,
  Check,
  Loader2,
  MoveRight,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  posListTableStatuses,
  posMoveOrderTable,
  type PosOrder,
  type PosTableStatus,
} from "../api";
import { usePosStore } from "../store";

export interface ChangeTableOrder {
  uuid: string;
  table_id: number | null;
  table_name_snapshot?: string;
  table_number_snapshot?: number | null;
}

interface ChangeTableDialogProps {
  open: boolean;
  order: ChangeTableOrder;
  onClose: () => void;
  onMoved: (updated: PosOrder) => void;
}

function tableLabel(table: ChangeTableOrder): string {
  const name = table.table_name_snapshot?.trim();
  if (name) return name;
  return table.table_number_snapshot != null
    ? `Table ${table.table_number_snapshot}`
    : "Current table";
}

function areaKey(table: PosTableStatus): string {
  return table.area_id != null ? String(table.area_id) : "none";
}

export default function ChangeTableDialog({
  open,
  order,
  onClose,
  onMoved,
}: ChangeTableDialogProps) {
  const currentWorker = usePosStore((s) => s.currentWorker);
  const device = usePosStore((s) => s.device);
  const [tables, setTables] = useState<PosTableStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setSearch("");

    posListTableStatuses()
      .then((res) => {
        if (cancelled) return;
        setTables(res.tables);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error && err.message ? err.message : "Could not load tables.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !moving) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, moving, onClose]);

  const freeTables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables
      .filter((table) => table.id !== order.table_id && !table.is_occupied)
      .filter((table) => {
        if (!q) return true;
        return (
          table.name.toLowerCase().includes(q) ||
          String(table.table_number).includes(q) ||
          table.area_name.toLowerCase().includes(q)
        );
      });
  }, [tables, order.table_id, search]);

  const groups = useMemo(() => {
    const seen = new Map<string, { title: string; tables: PosTableStatus[] }>();
    for (const table of freeTables) {
      const key = areaKey(table);
      const group = seen.get(key);
      if (group) group.tables.push(table);
      else {
        seen.set(key, {
          title: table.area_name || "Tables",
          tables: [table],
        });
      }
    }
    return [...seen.values()];
  }, [freeTables]);

  const selected = freeTables.find((table) => table.id === selectedId) ?? null;

  async function handleMove() {
    if (!selected || moving) return;
    if (
      !window.confirm(
        `Move this bill from ${tableLabel(order)} to ${selected.name}? The old table will become available.`,
      )
    ) {
      return;
    }

    setMoving(true);
    setError(null);
    try {
      const updated = await posMoveOrderTable(
        order.uuid,
        selected.id,
        currentWorker?.id,
        device?.id,
      );
      toast.success(`Bill moved to ${selected.name}`);
      onMoved(updated);
      onClose();
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message ? err.message : "The bill could not be moved.";
      setError(message);
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "table_occupied"
      ) {
        posListTableStatuses()
          .then((res) => setTables(res.tables))
          .catch(() => {});
        setSelectedId(null);
      }
    } finally {
      setMoving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-table-title"
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border bg-muted/40 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600">
              <Armchair className="h-5 w-5" />
            </div>
            <div>
              <h2 id="change-table-title" className="text-lg font-bold text-foreground">
                Change table
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Moving from{" "}
                <span className="font-semibold text-foreground">{tableLabel(order)}</span> to a free
                table.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={moving}
            aria-label="Close"
            className="rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="mt-3 text-sm">Loading free tables...</p>
            </div>
          ) : (
            <>
              {tables.length > 8 && (
                <div className="relative mb-4">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search free tables..."
                    aria-label="Search free tables"
                    className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-sm focus:border-ember focus:outline-none focus:ring-1 focus:ring-ember"
                  />
                </div>
              )}

              {freeTables.length === 0 ? (
                <div className="py-10 text-center">
                  <Armchair className="mx-auto h-9 w-9 text-muted-foreground/50" />
                  <p className="mt-3 text-sm font-semibold text-foreground">No free tables</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Settle or move the bill on another table first.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoading(true);
                      setError(null);
                      posListTableStatuses()
                        .then((res) => setTables(res.tables))
                        .catch((err: unknown) =>
                          setError(
                            err instanceof Error && err.message
                              ? err.message
                              : "Could not load tables.",
                          ),
                        )
                        .finally(() => setLoading(false));
                    }}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {groups.map((group) => (
                    <div key={group.title}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.title}
                      </p>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
                        {group.tables.map((table) => {
                          const isSelected = table.id === selectedId;
                          return (
                            <button
                              key={table.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => setSelectedId(isSelected ? null : table.id)}
                              className={`relative flex min-h-[76px] min-w-0 flex-col items-start justify-between gap-1 rounded-xl border-2 px-3 py-2 text-left transition-all active:scale-[0.97] ${
                                isSelected
                                  ? "border-ember bg-ember-soft"
                                  : "border-border bg-card hover:border-ember/50"
                              }`}
                            >
                              {isSelected && (
                                <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-ember">
                                  <Check
                                    className="h-3 w-3 text-white"
                                    strokeWidth={3.5}
                                    aria-hidden="true"
                                  />
                                </span>
                              )}
                              <span
                                className={`w-full break-words pr-5 text-base font-bold leading-tight ${
                                  isSelected ? "text-ember" : "text-foreground"
                                }`}
                              >
                                {table.name}
                              </span>
                              <span className="text-xs font-medium text-success">Available</span>
                              {table.seats ? (
                                <span className="text-[11px] text-muted-foreground">
                                  {table.seats} seats
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border bg-muted/30 px-6 py-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={moving}
              className="min-h-[44px] flex-1 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleMove}
              disabled={!selected || moving}
              className="inline-flex min-h-[44px] flex-[1.4] items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {moving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoveRight className="h-4 w-4" />
              )}
              {selected ? `Move to ${selected.name}` : "Choose a table"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
