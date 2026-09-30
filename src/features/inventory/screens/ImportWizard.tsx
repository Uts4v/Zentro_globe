// src/features/inventory/screens/ImportWizard.tsx
// Upload → Read → Validate → Preview → Fix → Confirm → Result.
// Uploading never changes stock. PDF lines that were not read with high
// confidence must be confirmed by a person first.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  SkipForward,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  InventoryApiError,
  inventoryApi,
  type ImportDecision,
  type ImportMode,
  type ImportOutcome,
  type ImportRow,
  type ImportSession,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ChoiceGroup,
  ConfirmDialog,
  ErrorBlock,
  Field,
  FilterChips,
  ListSkeleton,
  QuantityInput,
  ScreenHeader,
  StickyActions,
  SuccessPanel,
  errorMessage,
  formatQty,
  inputCls,
} from "@/features/inventory/components/bits";
import { LocationSelect } from "@/features/inventory/components/ItemPicker";
import { differenceText } from "@/features/inventory/screens/CountScreen";
import { copy } from "@/features/inventory/copy";
import { useInventory, useLocations } from "@/features/inventory/context";

const w = copy.importWizard;

const STATUS_META: Record<string, { icon: LucideIcon; cls: string }> = {
  ready: { icon: CheckCircle2, cls: "text-olive" },
  warning: { icon: AlertTriangle, cls: "text-[#8a5d1f]" },
  error: { icon: XCircle, cls: "text-danger" },
  skip: { icon: SkipForward, cls: "text-muted-foreground" },
};

function qtyKey(row: ImportRow, mode: ImportMode) {
  for (const key of ["counted_quantity", "opening_quantity", "quantity"])
    if (key in row.raw) return key;
  return mode === "STOCK_COUNT" ? "counted_quantity" : "opening_quantity";
}

// ── Upload step ───────────────────────────────────────────────────────────────

function UploadStep({
  fileType,
  onUploaded,
}: {
  fileType: "CSV" | "PDF";
  onUploaded: (s: ImportSession) => void;
}) {
  const locations = useLocations();
  const [mode, setMode] = useState<ImportMode | "">(fileType === "PDF" ? "STOCK_COUNT" : "");
  const [location, setLocation] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const modes: ImportMode[] =
    fileType === "PDF"
      ? ["STOCK_COUNT", "NEW_ITEMS"]
      : ["NEW_ITEMS", "UPDATE_ITEMS", "STOCK_COUNT"];

  async function upload(file: File) {
    if (!mode) return;
    const lower = file.name.toLowerCase();
    if (fileType === "CSV" && !lower.endsWith(".csv")) return setError("Choose a .csv file.");
    if (fileType === "PDF" && !lower.endsWith(".pdf")) return setError("Choose a .pdf file.");
    const limit = fileType === "CSV" ? 5 : 10;
    if (file.size > limit * 1024 * 1024)
      return setError(`The file is too large. The limit is ${limit} MB.`);
    setBusy(true);
    setError("");
    try {
      onUploaded(await inventoryApi.startImport(file, mode, location));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (busy) {
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-12 text-center"
        role="status"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
        <p className="font-medium text-foreground">
          {fileType === "PDF" ? w.readingPdf : w.reading}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-base font-semibold text-foreground">{w.step1}</p>
        <ChoiceGroup
          label={w.step1}
          value={mode}
          onChange={setMode}
          columns={1}
          options={modes.map((m) => ({ value: m, label: w.modes[m], hint: w.modeHints[m] }))}
        />
      </div>
      {mode && mode !== "UPDATE_ITEMS" && (
        <Field label={w.fallbackLocation} htmlFor="import-location" optional>
          <LocationSelect
            id="import-location"
            value={location}
            onChange={setLocation}
            locations={locations.active}
            allowEmpty
            emptyLabel={w.noFallback}
          />
        </Field>
      )}
      {error && <ErrorBlock message={error} />}
      <div className="rounded-2xl border border-dashed border-primary/40 bg-card px-6 py-8 text-center">
        <FileUp className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">
          {fileType === "PDF" ? w.fileTypesPdf : w.fileTypesCsv}
        </p>
        <input
          ref={input}
          id="import-file"
          type="file"
          className="sr-only"
          accept={fileType === "PDF" ? ".pdf,application/pdf" : ".csv,text/csv"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <Button className="mt-4 h-11" disabled={!mode} onClick={() => input.current?.click()}>
          {w.chooseFile}
        </Button>
      </div>
    </div>
  );
}

// ── Review step ───────────────────────────────────────────────────────────────

function RowCard({
  row,
  mode,
  onDecide,
  busy,
}: {
  row: ImportRow;
  mode: ImportMode;
  onDecide: (row: number, decision: ImportDecision) => void;
  busy: boolean;
}) {
  const locations = useLocations();
  const meta = STATUS_META[row.status] ?? STATUS_META.ready;
  const [editing, setEditing] = useState(false);
  const qk = qtyKey(row, mode);
  const [fix, setFix] = useState<Record<string, string>>({
    item_name: row.raw.item_name ?? row.name,
    [qk]: row.fix[qk] ?? row.raw[qk] ?? "",
    unit: row.fix.unit ?? row.raw.unit ?? "",
    location: row.fix.location ?? row.raw.location ?? "",
  });
  const isPdfRow = row.confidence !== "high" || Boolean(row.original_text);
  const label = isPdfRow ? w.line(row.row) : w.row(row.row);

  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-semibold text-foreground">{row.name || "—"}</p>
          {row.match && row.action !== "create" && (
            <p className="text-sm text-muted-foreground">
              {w.possibleMatch}: {row.match.name}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 text-sm font-semibold ${meta.cls}`}>
          <meta.icon className="h-4 w-4" aria-hidden="true" />{" "}
          {row.confirmed && row.needs_review ? w.confirmed : w.statusLabel[row.status]}
        </span>
      </div>

      {mode === "STOCK_COUNT" && row.values.system_says !== undefined && (
        <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">{w.systemSays}</dt>
            <dd className="font-semibold tabular-nums">
              {formatQty(row.values.system_says)} {row.values.unit_code}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{w.imported}</dt>
            <dd className="font-semibold tabular-nums">
              {row.values.counted !== undefined
                ? `${formatQty(row.values.counted)} ${row.values.unit_code}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{copy.count.difference}</dt>
            <dd className="font-semibold">
              {row.values.difference !== undefined
                ? differenceText(Number(row.values.difference), String(row.values.unit_code))
                : "—"}
            </dd>
          </div>
        </dl>
      )}
      {mode !== "STOCK_COUNT" && row.values.opening_quantity !== undefined && (
        <p className="mt-1 text-sm text-foreground">
          {copy.itemForm.q5}:{" "}
          <span className="font-semibold">
            {formatQty(row.values.opening_quantity)} {row.values.unit_code}
          </span>
        </p>
      )}

      {row.needs_review && (
        <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <p>
            {w.zentroRead}:{" "}
            <span className="font-semibold">
              {row.name} · {formatQty(row.raw[qk] || "")} {row.raw.unit ?? ""}
            </span>
          </p>
          {row.original_text && (
            <p className="text-muted-foreground">
              {w.originalText}: “{row.original_text}”
            </p>
          )}
        </div>
      )}

      {row.messages.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {row.messages.map((m, i) => (
            <li key={i} className={m.level === "error" ? "text-danger" : "text-[#8a5d1f]"}>
              {m.level === "error" ? "✕" : "⚠"} {m.text}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={copy.itemForm.q1} htmlFor={`fix-name-${row.row}`}>
            <input
              id={`fix-name-${row.row}`}
              className={inputCls}
              value={fix.item_name}
              onChange={(e) => setFix({ ...fix, item_name: e.target.value })}
            />
          </Field>
          <Field label={copy.fix.amount} htmlFor={`fix-qty-${row.row}`}>
            <QuantityInput
              id={`fix-qty-${row.row}`}
              value={fix[qk]}
              onChange={(v) => setFix({ ...fix, [qk]: v })}
            />
          </Field>
          <Field label={copy.itemForm.q3} htmlFor={`fix-unit-${row.row}`}>
            <input
              id={`fix-unit-${row.row}`}
              className={inputCls}
              value={fix.unit}
              placeholder="kg, L, piece"
              onChange={(e) => setFix({ ...fix, unit: e.target.value })}
            />
          </Field>
          <Field label={copy.reports.location} htmlFor={`fix-loc-${row.row}`}>
            <select
              id={`fix-loc-${row.row}`}
              className={inputCls}
              value={fix.location}
              onChange={(e) => setFix({ ...fix, location: e.target.value })}
            >
              <option value="">{w.noFallback}</option>
              {fix.location && !locations.active.some((l) => l.name === fix.location) && (
                <option value={fix.location}>{fix.location}</option>
              )}
              {locations.active.map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {row.choices?.includes("update") && (
          <Button
            variant="outline"
            className="h-10"
            disabled={busy}
            onClick={() => onDecide(row.row, { action: "update" })}
          >
            {w.updateExisting}
          </Button>
        )}
        {row.choices?.includes("create") && (
          <Button
            variant="outline"
            className="h-10"
            disabled={busy}
            onClick={() => onDecide(row.row, { action: "create" })}
          >
            {w.createNew}
          </Button>
        )}
        {row.needs_review && !row.confirmed && row.status !== "error" && row.action !== "skip" && (
          <Button
            className="h-10"
            disabled={busy}
            onClick={() => onDecide(row.row, { confirm: true })}
          >
            {w.confirm}
          </Button>
        )}
        {editing ? (
          <Button
            className="h-10"
            disabled={busy}
            onClick={() => {
              onDecide(row.row, {
                fix,
                confirm: true,
                action: row.decision === "skip" ? "" : undefined,
              });
              setEditing(false);
            }}
          >
            {w.applyFix}
          </Button>
        ) : (
          (row.status === "error" || row.needs_review || row.status === "warning") && (
            <Button variant="outline" className="h-10" onClick={() => setEditing(true)}>
              {w.editRow}
            </Button>
          )
        )}
        {row.status !== "skip" ? (
          <Button
            variant="ghost"
            className="h-10"
            disabled={busy}
            onClick={() => onDecide(row.row, { action: "skip" })}
          >
            {w.skip}
          </Button>
        ) : (
          row.decision === "skip" && (
            <Button
              variant="ghost"
              className="h-10"
              disabled={busy}
              onClick={() => onDecide(row.row, { action: "" })}
            >
              {w.include}
            </Button>
          )
        )}
      </div>
    </li>
  );
}

function ReviewStep({
  session,
  onChange,
  onDone,
  onRestart,
}: {
  session: ImportSession;
  onChange: (s: ImportSession) => void;
  onDone: (s: ImportSession) => void;
  onRestart: () => void;
}) {
  const { go } = useInventory();
  const [filter, setFilter] = useState<"all" | "problems" | "ready" | "skip">("problems");
  const [limit, setLimit] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [duplicate, setDuplicate] = useState<number | null>(session.duplicate_of?.id ?? null);
  const s = session.summary;
  const rows = useMemo(() => (session.rows ?? []) as ImportRow[], [session.rows]);
  const isPdf = session.file_type === "PDF";
  const mode = session.import_mode;

  const shown = useMemo(() => {
    const list = rows.filter((r) => {
      if (filter === "problems")
        return (
          r.status === "error" ||
          r.status === "warning" ||
          (r.needs_review && !r.confirmed && r.status !== "skip")
        );
      if (filter === "ready") return r.importable;
      if (filter === "skip") return r.status === "skip";
      return true;
    });
    return list;
  }, [rows, filter]);

  async function decide(row: number, decision: ImportDecision) {
    setBusy(true);
    setError("");
    try {
      onChange(await inventoryApi.reviewImport(session.id, { [String(row)]: decision }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAll() {
    const pending = rows.filter(
      (r) => r.needs_review && !r.confirmed && r.status !== "error" && r.action !== "skip",
    );
    if (!pending.length) return;
    setBusy(true);
    try {
      onChange(
        await inventoryApi.reviewImport(
          session.id,
          Object.fromEntries(pending.map((r) => [String(r.row), { confirm: true }])),
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit(allowDuplicate = false) {
    setBusy(true);
    setError("");
    try {
      const done = await inventoryApi.commitImport(session.id, allowDuplicate);
      setConfirm(false);
      onDone(done);
    } catch (e) {
      setConfirm(false);
      if (e instanceof InventoryApiError && e.code === "duplicate_import")
        setDuplicate(Number(e.data.previous_import));
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const importable = s.importable;
  const needsReview = rows.filter(
    (r) => r.needs_review && !r.confirmed && r.status !== "error" && r.action !== "skip",
  ).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{session.file_name}</p>
        <p className="mt-1 text-lg font-semibold text-foreground">
          {isPdf ? w.foundPdf(s.rows) : w.found(s.rows)}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {isPdf ? (
            <>
              <span className="text-olive">✓ {w.highConfidence(s.high_confidence)}</span>
              <span className="text-[#8a5d1f]">⚠ {w.needReview(needsReview)}</span>
              <span className="text-danger">✕ {w.unreadable(s.unreadable)}</span>
            </>
          ) : (
            <>
              <span className="text-olive">✓ {w.ready(s.ready)}</span>
              <span className="text-[#8a5d1f]">⚠ {w.warnings(s.warnings)}</span>
              <span className="text-danger">✕ {w.errors(s.errors)}</span>
            </>
          )}
          <span className="text-muted-foreground">{w.modes[mode]}</span>
        </div>
      </div>

      {duplicate && (
        <div
          role="alert"
          className="space-y-3 rounded-2xl border border-warning/40 bg-butter-soft p-4 text-sm"
        >
          <p className="font-semibold text-foreground">{w.duplicateTitle}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => go("io", { import: duplicate })}
            >
              {w.viewPrevious}
            </Button>
            <Button
              className="h-11"
              disabled={busy || importable === 0}
              onClick={() => commit(true)}
            >
              {w.importAgain}
            </Button>
          </div>
        </div>
      )}

      <FilterChips
        label={w.found(s.rows)}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setLimit(50);
        }}
        options={(["problems", "ready", "skip", "all"] as const).map((f) => ({
          value: f,
          label: w.filters[f],
        }))}
      />
      {needsReview > 1 && (
        <Button variant="outline" className="h-11" disabled={busy} onClick={confirmAll}>
          {w.confirm} ({needsReview})
        </Button>
      )}

      {error && <ErrorBlock message={error} />}
      <ul className={`space-y-2 ${busy ? "opacity-70" : ""}`}>
        {shown.slice(0, limit).map((row) => (
          <RowCard
            key={`${row.row}-${row.status}-${row.confirmed}`}
            row={row}
            mode={mode}
            onDecide={decide}
            busy={busy}
          />
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          —
        </p>
      )}
      {shown.length > limit && (
        <Button variant="outline" className="h-11 w-full" onClick={() => setLimit((n) => n + 50)}>
          {copy.common.showMore}
        </Button>
      )}

      <StickyActions>
        <Button
          variant="ghost"
          className="h-12"
          onClick={async () => {
            await inventoryApi.cancelImport(session.id).catch(() => void 0);
            onRestart();
          }}
        >
          {w.cancelImport}
        </Button>
        {(s.errors > 0 || s.warnings > 0) && (
          <Button
            variant="outline"
            className="h-12"
            onClick={() =>
              inventoryApi.importReport(session.id).catch((e) => toast.error(errorMessage(e)))
            }
          >
            <Download className="h-4 w-4" aria-hidden="true" /> {w.downloadErrors}
          </Button>
        )}
        <Button variant="outline" className="h-12" onClick={onRestart}>
          {w.fixFile}
        </Button>
        <Button
          className="h-12 sm:min-w-48"
          disabled={busy || importable === 0}
          onClick={() => (importable > 20 ? setConfirm(true) : commit())}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {mode === "STOCK_COUNT" ? w.createCountN(importable) : w.importN(importable)}
        </Button>
      </StickyActions>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={w.bulkConfirmTitle(importable)}
        busy={busy}
        confirmLabel={mode === "STOCK_COUNT" ? w.createCountN(importable) : w.importN(importable)}
        onConfirm={() => commit()}
        body={<p>{w.bulkConfirmBody}</p>}
      />
    </div>
  );
}

// ── Result ────────────────────────────────────────────────────────────────────

function ResultStep({ session, onRestart }: { session: ImportSession; onRestart: () => void }) {
  const { go } = useInventory();
  const result = session.summary.result;
  const outcomes = (session.rows ?? []) as ImportOutcome[];
  const failed = outcomes.filter((o) => o.outcome === "failed").slice(0, 10);
  const isCount = session.import_mode === "STOCK_COUNT";
  return (
    <div className="space-y-4">
      <SuccessPanel
        title={isCount ? w.countDoneTitle : w.doneTitle}
        lines={[
          { label: w.doneImported(session.rows_imported), value: "✓" },
          { label: w.doneSkipped(session.rows_skipped), value: "" },
          { label: w.doneFailed(session.rows_failed), value: session.rows_failed ? "✕" : "" },
          ...(result && result.opening
            ? [{ label: w.openingAdded(result.opening), value: "" }]
            : []),
        ]}
        note={isCount ? w.countNext : w.noOverwrite}
        primary={
          isCount && session.stock_count
            ? { label: w.reviewCount, onClick: () => go("count", { count: session.stock_count! }) }
            : { label: w.viewStock, onClick: () => go("stock") }
        }
        secondary={{
          label: w.downloadResult,
          onClick: () =>
            inventoryApi.importReport(session.id).catch((e) => toast.error(errorMessage(e))),
        }}
      />
      {failed.length > 0 && (
        <ul className="mx-auto max-w-lg space-y-1 text-sm text-danger">
          {failed.map((o) => (
            <li key={o.row}>
              {w.row(o.row)} · {o.name}: {o.message}
            </li>
          ))}
        </ul>
      )}
      <div className="text-center">
        <Button variant="link" onClick={onRestart}>
          {copy.importExport.title}
        </Button>
      </div>
    </div>
  );
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export function ImportWizard({
  fileType,
  sessionId,
  onClose,
}: {
  fileType: "CSV" | "PDF";
  sessionId?: number;
  onClose: () => void;
}) {
  const { refresh } = useInventory();
  const qc = useQueryClient();
  const [session, setSession] = useState<ImportSession | null>(null);
  const existing = useQuery({
    queryKey: ["inventory", "import", sessionId],
    queryFn: () => inventoryApi.importSession(sessionId as number),
    enabled: Boolean(sessionId) && !session,
  });
  const current = session ?? existing.data ?? null;
  const type = current?.file_type ?? fileType;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ScreenHeader title={type === "PDF" ? w.titlePdf : w.titleCsv} onBack={onClose} />
      {sessionId && existing.isLoading && <ListSkeleton rows={4} />}
      {existing.isError && <ErrorBlock message={errorMessage(existing.error, copy.errors.load)} />}
      {!current && !(sessionId && existing.isLoading) && (
        <UploadStep fileType={fileType} onUploaded={setSession} />
      )}
      {current && current.status === "READY" && (
        <ReviewStep
          session={current}
          onChange={setSession}
          onDone={(done) => {
            setSession(done);
            refresh();
            qc.invalidateQueries({ queryKey: ["inventory", "imports"] });
            toast.success(current.import_mode === "STOCK_COUNT" ? w.countDoneTitle : w.doneTitle);
          }}
          onRestart={() => {
            setSession(null);
            onClose();
          }}
        />
      )}
      {current && current.status !== "READY" && (
        <ResultStep session={current} onRestart={onClose} />
      )}
    </div>
  );
}
