// src/features/inventory/screens/ImportExportScreen.tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, FileUp, Loader2 } from "lucide-react";
import { inventoryApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ActionCard,
  ScreenHeader,
  errorMessage,
  formatDateTime,
} from "@/features/inventory/components/bits";
import { ImportWizard } from "@/features/inventory/screens/ImportWizard";
import { useDownload } from "@/features/inventory/screens/ReportsScreen";
import { copy } from "@/features/inventory/copy";
import { P, useInventory } from "@/features/inventory/context";

const x = copy.importExport;

function monthAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function ImportExportScreen() {
  const { can, go, params } = useInventory();
  const [wizard, setWizard] = useState<{ type: "CSV" | "PDF"; session?: number } | null>(
    params.import ? { type: "CSV", session: params.import } : null,
  );
  const { busy, download } = useDownload();
  const canImport = can(P.IMPORT);
  const recent = useQuery({
    queryKey: ["inventory", "imports"],
    queryFn: inventoryApi.importSessions,
    enabled: canImport,
  });

  if (wizard) {
    return (
      <ImportWizard
        key={`${wizard.type}-${wizard.session ?? "new"}`}
        fileType={wizard.type}
        sessionId={wizard.session}
        onClose={() => {
          setWizard(null);
          if (params.import) go("io");
          recent.refetch();
        }}
      />
    );
  }

  async function template(kind: "items" | "count", example = false) {
    try {
      await inventoryApi.importTemplate(kind, example);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const exportButton = (
    label: string,
    report: string,
    format: "csv" | "pdf",
    extra: Record<string, string> = {},
  ) => (
    <Button
      variant="outline"
      className="h-12 justify-start"
      disabled={busy !== null}
      onClick={() => download(report, format, extra)}
    >
      {busy === `${report}.${format}` ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : format === "pdf" ? (
        <FileText className="h-4 w-4" aria-hidden="true" />
      ) : (
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </Button>
  );

  return (
    <div className="space-y-8">
      <ScreenHeader title={x.title} onBack={() => go("home")} />

      {canImport && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">{x.importHeading}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <ActionCard
              icon={FileUp}
              title={x.importCsv}
              description={x.importCsvHint}
              onClick={() => setWizard({ type: "CSV" })}
            />
            <ActionCard
              icon={FileText}
              title={x.importPdf}
              description={x.importPdfHint}
              onClick={() => setWizard({ type: "PDF" })}
            />
          </div>
          <h4 className="pt-2 text-sm font-semibold text-foreground">{x.templates}</h4>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-11" onClick={() => template("items")}>
              <Download className="h-4 w-4" aria-hidden="true" /> {x.csvTemplate}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => template("items", true)}>
              <Download className="h-4 w-4" aria-hidden="true" /> {x.csvExample}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => template("count")}>
              <Download className="h-4 w-4" aria-hidden="true" /> {x.countTemplate}
            </Button>
          </div>
        </section>
      )}

      {can(P.VIEW_REPORTS) && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold text-foreground">{x.exportHeading}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {exportButton(x.exportStock, "current-stock", "csv")}
            {exportButton(x.downloadPdf, "full", "pdf", {
              sections: "waste,counts,deliveries",
              from_date: monthAgo(),
            })}
            {exportButton(x.exportHistory, "stock-history", "csv", { from_date: monthAgo() })}
            {exportButton(x.exportWaste, "waste", "csv", { from_date: monthAgo() })}
            {exportButton(x.exportCounts, "stock-counts", "csv")}
          </div>
        </section>
      )}

      {canImport && (recent.data?.results.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold text-foreground">{x.recent}</h3>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {recent.data?.results.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setWizard({ type: s.file_type, session: s.id })}
                  className="flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {s.file_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy.importWizard.modes[s.import_mode]} · {formatDateTime(s.created_at)} ·{" "}
                      {s.uploaded_by}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {s.status === "COMPLETED"
                      ? copy.importWizard.doneImported(s.rows_imported)
                      : s.status === "READY"
                        ? copy.importWizard.statusLabel.warning
                        : s.status.toLowerCase()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
