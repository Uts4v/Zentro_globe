// src/features/inventory/screens/ReportsScreen.tsx
// One Reports page: pick a report, filter, preview, download CSV or PDF.
// Files are generated on the server from authoritative data.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { inventoryApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ErrorBlock,
  Field,
  ListSkeleton,
  Pager,
  ScreenHeader,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { useCategories, useInventory, useLocations } from "@/features/inventory/context";

const r = copy.reports;
const REPORTS = [
  "current-stock",
  "low-stock",
  "stock-history",
  "stock-counts",
  "count-differences",
  "waste",
  "purchasing",
  "deliveries",
];
const DATED = new Set([
  "stock-history",
  "stock-counts",
  "count-differences",
  "waste",
  "purchasing",
  "deliveries",
]);
const CATEGORY = new Set([
  "current-stock",
  "low-stock",
  "stock-history",
  "count-differences",
  "waste",
]);

function localDateStr(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function monthStart() {
  const d = new Date();
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function useDownload() {
  const [busy, setBusy] = useState<string | null>(null);
  async function download(
    report: string,
    format: "csv" | "pdf",
    params: Record<string, string | number | undefined> = {},
  ) {
    setBusy(`${report}.${format}`);
    try {
      await inventoryApi.download(report, format, params);
      toast.success(r.downloaded);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return { busy, download };
}

export function ReportsScreen() {
  const { go, params } = useInventory();
  const locations = useLocations();
  const categories = useCategories();
  const [report, setReport] = useState(
    params.report && REPORTS.includes(params.report) ? params.report : "current-stock",
  );
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(localDateStr(new Date()));
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const { busy, download } = useDownload();

  const filters: Record<string, string | undefined> = {
    from_date: DATED.has(report) ? from : undefined,
    to_date: DATED.has(report) ? to : undefined,
    location: location || undefined,
    category: CATEGORY.has(report) ? category || undefined : undefined,
  };
  const data = useQuery({
    queryKey: ["inventory", "report", report, filters, page],
    queryFn: () => inventoryApi.report(report, { ...filters, page, page_size: 25 }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-5">
      <ScreenHeader title={r.title} subtitle={r.subtitle} onBack={() => go("home")} />

      <div
        role="radiogroup"
        aria-label={r.title}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      >
        {REPORTS.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={key === report}
            onClick={() => {
              setReport(key);
              setPage(1);
            }}
            className={`min-h-[64px] rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              key === report
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/40"
            }`}
          >
            <span className="block font-semibold text-foreground">{r.names[key]}</span>
            <span className="block text-xs text-muted-foreground">{r.hints[key]}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {DATED.has(report) && (
          <>
            <Field label={r.from} htmlFor="report-from">
              <input
                id="report-from"
                type="date"
                className={inputCls}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label={r.to} htmlFor="report-to">
              <input
                id="report-to"
                type="date"
                className={inputCls}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
          </>
        )}
        <Field label={r.location} htmlFor="report-location">
          <select
            id="report-location"
            className={inputCls}
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{copy.stock.allLocations}</option>
            {locations.active.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        {CATEGORY.has(report) && (
          <Field label={r.category} htmlFor="report-category">
            <select
              id="report-category"
              className={inputCls}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{copy.stock.allCategories}</option>
              {categories.active.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11"
          disabled={busy !== null}
          onClick={() => download(report, "csv", filters)}
        >
          {busy === `${report}.csv` ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          )}
          {r.downloadCsv}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={busy !== null}
          onClick={() => download(report, "pdf", filters)}
        >
          {busy === `${report}.pdf` ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden="true" />
          )}
          {r.downloadPdf}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        CSV: {r.csvHint}. PDF: {r.pdfHint}.
      </p>

      {data.isError && (
        <ErrorBlock
          message={errorMessage(data.error, copy.errors.load)}
          onRetry={() => data.refetch()}
        />
      )}
      {data.isLoading ? (
        <ListSkeleton rows={5} />
      ) : data.data && data.data.results.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          {r.noRows}
        </div>
      ) : (
        data.data && (
          <div className={data.isFetching ? "opacity-70" : ""}>
            <p className="mb-2 text-sm text-muted-foreground">{r.rows(data.data.total_count)}</p>
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    {data.data.columns.map((col) => (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-3 py-2.5 font-medium ${col.numeric ? "text-right" : ""}`}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.results.map((row, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      {data.data!.columns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-3 py-2 ${col.numeric ? "text-right tabular-nums" : ""}`}
                        >
                          {row[col.key] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Pager page={page} totalPages={data.data.total_pages} onPage={setPage} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
