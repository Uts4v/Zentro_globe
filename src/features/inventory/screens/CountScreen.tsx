// src/features/inventory/screens/CountScreen.tsx
// Count Stock: pick a place → count item by item (autosaved) → finish →
// a manager reviews the differences → Approve & Update Stock.
// Stock only changes through the backend count reconciliation.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  CheckCheck,
  ClipboardList,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { inventoryApi, type CountLine, type StockCount, type StockCountSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  ListSkeleton,
  QuantityInput,
  ScreenHeader,
  StickyActions,
  SuccessPanel,
  errorMessage,
  formatDateTime,
  formatQty,
  inputCls,
  parseAmount,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, useInventory, useLocations } from "@/features/inventory/context";

const c = copy.count;
const PENDING_KEY = (id: number) => `zentro.count.${id}.pending`;

function readPending(id: number): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY(id)) || "{}");
  } catch {
    return {};
  }
}
function writePending(id: number, value: Record<string, string>) {
  try {
    if (Object.keys(value).length) localStorage.setItem(PENDING_KEY(id), JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY(id));
  } catch {
    /* storage unavailable */
  }
}

export function differenceText(diff: number | null, unit: string) {
  if (diff === null) return "";
  if (Math.abs(diff) < 1e-9) return c.matches;
  return diff < 0 ? c.less(formatQty(Math.abs(diff)), unit) : c.more(formatQty(diff), unit);
}

function DiffBadge({ diff, unit }: { diff: number | null; unit: string }) {
  if (diff === null) return <span className="text-sm text-muted-foreground">{c.notCounted}</span>;
  const match = Math.abs(diff) < 1e-9;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
        match
          ? "bg-olive-soft text-olive"
          : diff < 0
            ? "bg-bordeaux-soft text-danger"
            : "bg-periwinkle-soft text-info"
      }`}
    >
      {match && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {differenceText(diff, unit)}
    </span>
  );
}

export function CountScreen() {
  const { params } = useInventory();
  if (params.count) return <CountSession countId={params.count} />;
  return <CountStart />;
}

// ── Start ─────────────────────────────────────────────────────────────────────

function CountStart() {
  const { go, can, params } = useInventory();
  const locations = useLocations();
  const [starting, setStarting] = useState<number | "all" | null>(null);
  const [error, setError] = useState("");
  const open = useQuery({
    queryKey: ["inventory", "counts", "open"],
    queryFn: () => inventoryApi.counts({ status: "IN_PROGRESS,SUBMITTED", page_size: 20 }),
  });
  const inProgress = (open.data?.results ?? []).filter((x) => x.status === "IN_PROGRESS");
  const waiting = (open.data?.results ?? []).filter((x) => x.status === "SUBMITTED");

  const start = useCallback(
    async (locationId: number | null) => {
      setStarting(locationId ?? "all");
      setError("");
      const name = locations.active.find((l) => l.id === locationId)?.name ?? c.everything;
      try {
        const created = await inventoryApi.createCount({
          name: `${name} · ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          location: locationId,
        });
        go("count", { count: created.id });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setStarting(null);
      }
    },
    [go, locations.active],
  );

  // Opened from an item: jump straight into that place.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (params.location && !autoStarted.current && locations.active.length && open.isSuccess) {
      autoStarted.current = true;
      const existing = inProgress.find((x) => x.location === params.location);
      if (existing) go("count", { count: existing.id });
    }
  }, [params.location, locations.active.length, open.isSuccess, inProgress, go]);

  const summaryCard = (x: StockCountSummary) => (
    <button
      key={x.id}
      type="button"
      onClick={() => go("count", { count: x.id })}
      className="flex min-h-[64px] w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{x.name}</span>
        <span className="block text-sm text-muted-foreground">
          {c.counted(x.counted_count, x.line_count)} ·{" "}
          {formatDateTime(x.submitted_at || x.started_at || x.created_at)}
        </span>
      </span>
      <span className="text-sm font-medium text-primary">
        {x.status === "SUBMITTED" && can(P.APPROVE_COUNT) ? c.reviewTitle : copy.common.next}
      </span>
    </button>
  );

  return (
    <div className="space-y-6">
      <ScreenHeader title={c.title} onBack={() => go("home")} />
      {error && <ErrorBlock message={error} />}

      {waiting.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{c.waitingTitle}</h3>
          {waiting.map(summaryCard)}
        </section>
      )}
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{c.continueTitle}</h3>
          {inProgress.map(summaryCard)}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">{c.where}</h3>
        {locations.isLoading ? (
          <ListSkeleton rows={4} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {locations.active.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={starting !== null}
                onClick={() => start(l.id)}
                className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-base font-semibold text-foreground shadow-sm transition hover:border-primary/40 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {starting === l.id ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
                )}
                {l.name}
              </button>
            ))}
            <button
              type="button"
              disabled={starting !== null}
              onClick={() => start(null)}
              className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-dashed border-primary/40 bg-card px-4 text-left shadow-sm transition hover:border-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {starting === "all" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
              )}
              <span>
                <span className="block text-base font-semibold text-foreground">
                  {c.everything}
                </span>
                <span className="block text-sm text-muted-foreground">{c.everythingHint}</span>
              </span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Session ───────────────────────────────────────────────────────────────────

type SaveState = "idle" | "saving" | "saved" | "error";

function CountLineRow({
  line,
  countId,
  editable,
  showLocation,
  onSaved,
}: {
  line: CountLine;
  countId: number;
  editable: boolean;
  showLocation: boolean;
  onSaved: (line: CountLine) => void;
}) {
  const pending = readPending(countId)[String(line.id)];
  const [value, setValue] = useState<string>(
    pending ?? (line.physical_quantity !== null ? String(Number(line.physical_quantity)) : ""),
  );
  const [state, setState] = useState<SaveState>(pending !== undefined ? "error" : "idle");
  const lastSaved = useRef<string>(
    line.physical_quantity !== null ? String(Number(line.physical_quantity)) : "",
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (raw: string) => {
      if (timer.current) clearTimeout(timer.current);
      const normalized = raw.trim() === "" ? "" : String(parseAmount(raw) ?? "");
      if (raw.trim() !== "" && normalized === "") return;
      if (normalized === lastSaved.current) return;
      setState("saving");
      try {
        const updated = await inventoryApi.upsertCountLine(countId, {
          line_id: line.id,
          physical_quantity: normalized === "" ? null : normalized,
        });
        lastSaved.current = normalized;
        const store = readPending(countId);
        delete store[String(line.id)];
        writePending(countId, store);
        setState("saved");
        onSaved(updated);
      } catch {
        // Keep the value on this device and let the person retry safely
        // (saving the same number twice gives the same result).
        const store = readPending(countId);
        store[String(line.id)] = raw;
        writePending(countId, store);
        setState("error");
      }
    },
    [countId, line.id, onSaved],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const book = Number(line.book_quantity);
  const typed = parseAmount(value);
  const diff = typed === null ? null : typed - book;
  const inputId = `count-line-${line.id}`;

  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-foreground">{line.item_name}</p>
          {showLocation && <p className="text-sm text-muted-foreground">{line.location_name}</p>}
        </div>
        <p className="shrink-0 text-right text-sm text-muted-foreground">
          {c.systemSays}
          <span className="block text-base font-semibold tabular-nums text-foreground">
            {formatQty(book)} {line.unit_code}
          </span>
        </p>
      </div>
      {editable ? (
        <div className="mt-3">
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-foreground">
            {c.howMuchSee}
          </label>
          <QuantityInput
            id={inputId}
            value={value}
            unit={line.unit_code}
            placeholder=""
            large
            onChange={(v) => {
              setValue(v);
              setState("idle");
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => save(v), 900);
            }}
            onBlur={() => save(value)}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          {typed !== null && (
            <span className="text-muted-foreground">
              {c.youCounted}:{" "}
              <span className="font-semibold text-foreground">
                {formatQty(typed)} {line.unit_code}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <DiffBadge diff={diff} unit={line.unit_code} />
          {state === "saving" && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label={copy.common.saving}
            />
          )}
          {state === "saved" && (
            <span className="inline-flex items-center gap-1 text-xs text-olive" aria-live="polite">
              <Check className="h-3.5 w-3.5" aria-hidden="true" /> {c.savedTick}
            </span>
          )}
          {state === "error" && (
            <button
              type="button"
              onClick={() => {
                lastSaved.current = "__retry__";
                save(value);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-danger hover:bg-bordeaux-soft"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {copy.common.notSaved} ·{" "}
              {copy.common.tryAgain}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function CountSession({ countId }: { countId: number }) {
  const { go, can, refresh } = useInventory();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["inventory", "count", countId],
    queryFn: () => inventoryApi.countDetail(countId),
  });
  const [lines, setLines] = useState<Record<number, CountLine>>({});
  const [search, setSearch] = useState("");
  const [hideCounted, setHideCounted] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [limit, setLimit] = useState(60);
  const [confirm, setConfirm] = useState<"finish" | "approve" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<StockCount | null>(null);

  useEffect(() => {
    if (query.data) setLines(Object.fromEntries(query.data.lines.map((l) => [l.id, l])));
  }, [query.data]);

  const onSaved = useCallback(
    (line: CountLine) => setLines((prev) => ({ ...prev, [line.id]: line })),
    [],
  );
  const count = query.data;
  const all = useMemo(() => Object.values(lines), [lines]);
  const countedN = all.filter((l) => l.physical_quantity !== null).length;
  const showLocation = count?.location === null;

  const order = useMemo(() => new Map((count?.lines ?? []).map((l, i) => [l.id, i])), [count]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all
      .filter((l) => !term || l.item_name.toLowerCase().includes(term))
      .filter((l) => !hideCounted || l.physical_quantity === null)
      .filter((l) => !onlyDiff || (l.difference !== null && Number(l.difference) !== 0))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [all, search, hideCounted, onlyDiff, order]);

  async function act(kind: "finish" | "approve" | "cancel") {
    setBusy(true);
    setError("");
    try {
      if (kind === "finish") {
        const pending = readPending(countId);
        if (Object.keys(pending).length) {
          setError(copy.common.notSaved);
          return;
        }
        const res = await inventoryApi.submitCount(countId);
        setDone(res);
        if (res.status === "APPROVED") toast.success(c.stockUpdated);
      } else if (kind === "approve") {
        const res = await inventoryApi.approveCount(countId);
        setDone(res);
        toast.success(c.approved);
      } else {
        await inventoryApi.cancelCount(countId);
        writePending(countId, {});
        go("count");
      }
      qc.invalidateQueries({ queryKey: ["inventory", "count", countId] });
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  if (query.isLoading) return <ListSkeleton rows={5} />;
  if (query.isError || !count)
    return (
      <ErrorBlock
        message={errorMessage(query.error, copy.errors.load)}
        onRetry={() => query.refetch()}
      />
    );

  if (done) {
    const approved = done.status === "APPROVED";
    const diffs = done.lines.filter((l) => l.difference !== null && Number(l.difference) !== 0);
    return (
      <SuccessPanel
        title={c.finished}
        tone={approved ? "success" : "info"}
        note={approved ? c.stockUpdated : c.managerWillReview}
        lines={diffs.slice(0, 6).map((l) => ({
          label: l.item_name,
          value: differenceText(Number(l.difference), l.unit_code),
          sub: `${c.systemSaid} ${formatQty(l.book_quantity)} · ${c.countedCol} ${formatQty(l.physical_quantity)} ${l.unit_code}`,
        }))}
        primary={{ label: copy.common.done, onClick: () => go("home") }}
        secondary={{ label: c.newCount, onClick: () => go("count") }}
      />
    );
  }

  const editable = count.status === "IN_PROGRESS" || count.status === "DRAFT";
  const reviewing = count.status === "SUBMITTED";
  const canApprove = reviewing && can(P.APPROVE_COUNT);
  const pct = all.length ? Math.round((countedN / all.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={reviewing ? c.reviewTitle : count.location_name}
        subtitle={
          reviewing
            ? `${count.name} · ${count.submitted_by_name || count.started_by_name}`
            : count.name
        }
        onBack={() => go("count")}
      />

      {!reviewing && (
        <div aria-live="polite">
          <div className="flex items-center justify-between text-sm font-medium text-foreground">
            <span>{c.counted(countedN, all.length)}</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div
            className="mt-2 h-3 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={all.length}
            aria-valuenow={countedN}
            aria-label={c.counted(countedN, all.length)}
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      {reviewing && !canApprove && (
        <div className="rounded-2xl border border-border bg-periwinkle-soft px-4 py-3 text-sm text-foreground">
          {c.managerWillReview}
        </div>
      )}

      {all.length === 0 ? (
        <EmptyState icon={ClipboardList} title={c.nothingHere} />
      ) : (
        <>
          <div className="space-y-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label={c.searchItem}
                className={`${inputCls} pl-9`}
                placeholder={c.searchItem}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              {editable && (
                <label className="inline-flex min-h-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--primary)]"
                    checked={hideCounted}
                    onChange={(e) => setHideCounted(e.target.checked)}
                  />
                  {c.hideCounted}
                </label>
              )}
              <label className="inline-flex min-h-[44px] items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--primary)]"
                  checked={onlyDiff}
                  onChange={(e) => setOnlyDiff(e.target.checked)}
                />
                {c.onlyDifferences}
              </label>
            </div>
          </div>

          {reviewing ? (
            <ul className="space-y-2">
              {visible.slice(0, limit).map((l) => (
                <li key={l.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">{l.item_name}</p>
                      {showLocation && (
                        <p className="text-sm text-muted-foreground">{l.location_name}</p>
                      )}
                    </div>
                    <DiffBadge
                      diff={l.difference === null ? null : Number(l.difference)}
                      unit={l.unit_code}
                    />
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">{c.systemSaid}</dt>
                      <dd className="font-semibold tabular-nums">
                        {formatQty(l.book_quantity)} {l.unit_code}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{c.countedCol}</dt>
                      <dd className="font-semibold tabular-nums">
                        {l.physical_quantity === null
                          ? c.notCounted
                          : `${formatQty(l.physical_quantity)} ${l.unit_code}`}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-y-2">
              {visible.slice(0, limit).map((l) => (
                <CountLineRow
                  key={l.id}
                  line={l}
                  countId={countId}
                  editable={editable}
                  showLocation={showLocation}
                  onSaved={onSaved}
                />
              ))}
            </ul>
          )}
          {visible.length > limit && (
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setLimit((n) => n + 60)}
            >
              {copy.common.showMore}
            </Button>
          )}
        </>
      )}

      {error && <ErrorBlock message={error} />}

      {(editable || canApprove) && (
        <StickyActions>
          {editable && (
            <>
              <Button
                variant="ghost"
                className="h-12 text-danger"
                onClick={() => setConfirm("cancel")}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" /> {c.cancelCount}
              </Button>
              <Button variant="outline" className="h-12" onClick={() => go("count")}>
                {c.saveLater}
              </Button>
              <Button
                className="h-12 sm:min-w-40"
                onClick={() => (countedN === 0 ? setError(c.noItemsCounted) : setConfirm("finish"))}
              >
                <Check className="h-4 w-4" aria-hidden="true" /> {c.finish}
              </Button>
            </>
          )}
          {canApprove && (
            <>
              <Button
                variant="ghost"
                className="h-12 text-danger"
                onClick={() => setConfirm("cancel")}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" /> {c.cancelCount}
              </Button>
              <Button className="h-12 sm:min-w-48" onClick={() => setConfirm("approve")}>
                <CheckCheck className="h-4 w-4" aria-hidden="true" /> {c.approve}
              </Button>
            </>
          )}
        </StickyActions>
      )}

      <ConfirmDialog
        open={confirm === "finish"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={c.finishConfirm}
        busy={busy}
        confirmLabel={c.finish}
        onConfirm={() => act("finish")}
        body={countedN < all.length ? <p>{c.finishNotAll(all.length - countedN)}</p> : undefined}
      />
      <ConfirmDialog
        open={confirm === "approve"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={c.approveConfirm}
        busy={busy}
        confirmLabel={c.approve}
        onConfirm={() => act("approve")}
        body={<p>{c.approveBody}</p>}
      />
      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={c.cancelCount}
        busy={busy}
        danger
        confirmLabel={c.cancelCount}
        onConfirm={() => act("cancel")}
        body={<p>{c.cancelConfirm}</p>}
      />
    </div>
  );
}
