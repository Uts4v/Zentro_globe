// routes/merchant.pdf-menu.tsx — PDF menu upload + customer-facing QR code
import { createFileRoute } from "@tanstack/react-router";
import { requireMerchant } from "@/lib/merchant-auth-guard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  FileText,
  UploadCloud,
  Trash2,
  Download,
  QrCode,
  CheckCircle2,
  ExternalLink,
  Copy,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { pdfMenuApi, type PdfMenuInfo } from "@/lib/api/pdf-menu";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/merchant/pdf-menu")({
  beforeLoad: requireMerchant,
  head: () => ({ meta: [{ title: "PDF Menu · Merchant · Zentro" }] }),
  component: MerchantPdfMenuPage,
});

function MerchantPdfMenuPage() {
  const { merchantProfile } = useAuth();
  const [info, setInfo] = useState<PdfMenuInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadingProgress, setUploadingProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageUrl =
    info?.pdf_menu_token && merchantProfile?.slug
      ? `${window.location.origin}/m/${encodeURIComponent(merchantProfile.slug)}/pdf-menu/${info.pdf_menu_token}`
      : info?.pdf_menu_page_url ?? "";

  const fetchInfo = useCallback(async () => {
    try {
      const data = await pdfMenuApi.fetch();
      setInfo(data);
    } catch {
      toast.error("Failed to load PDF menu info");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  async function handleUpload(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("Only PDF files are allowed");
      return;
    }
    setUploading(true);
    setUploadingProgress(0);
    try {
      const progressTimer = setInterval(() => {
        setUploadingProgress((p) => Math.min(95, p + 10));
      }, 200);
      const data = await pdfMenuApi.upload(file);
      clearInterval(progressTimer);
      setUploadingProgress(100);
      setInfo(data);
      toast.success("PDF menu uploaded!");
    } catch (e: any) {
      toast.error(e?.message || "Failed to upload PDF menu");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!confirm("Remove this PDF menu? The QR code will no longer show a menu.")) return;
    try {
      const data = await pdfMenuApi.remove();
      setInfo(data);
      toast.success("PDF menu removed");
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove PDF menu");
    }
  }

  async function handleDownloadQR() {
    if (!pageUrl) return;
    const svgEl = document.getElementById("pdf-menu-qr")?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = 400;
      canvas.height = 500;
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 400, 500);
        const qrSize = 320;
        ctx.drawImage(img, (400 - qrSize) / 2, 60, qrSize, qrSize);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 28px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Scan to view menu", 200, 410);
        ctx.font = "18px system-ui, sans-serif";
        ctx.fillStyle = "#555555";
        ctx.fillText(pageUrl, 200, 445);
      }
      const link = document.createElement("a");
      link.download = "pdf-menu-qr.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  }

  async function handleCopyUrl() {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      toast.success("Menu link copied");
    } catch {
      toast.error("Could not copy link");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasPdf = !!info?.has_pdf && !!info?.pdf_url;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-foreground">PDF Menu</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your menu as a PDF and give customers a printable, high-quality
            menu through a QR code — no app or login required.
          </p>
        </div>
      </div>

      {/* Upload / replace card */}
      <div className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <FileText className="h-4 w-4 text-ember" />
          {hasPdf ? "Replace your PDF menu" : "Upload your PDF menu"}
        </h2>

        <label
          htmlFor="pdf-menu-file"
          className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-mist/50 px-6 py-10 text-center transition-colors hover:border-ember/40 hover:bg-mist"
        >
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            {uploading ? "Uploading..." : "Click to choose a PDF file"}
          </span>
          <span className="text-xs text-muted-foreground">
            .pdf up to 10MB — your full menu with prices, photos and offers.
          </span>
          <input
            id="pdf-menu-file"
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
            }}
          />
        </label>

        {uploading && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-ember transition-all duration-300"
                style={{ width: `${uploadingProgress}%` }}
              />
            </div>
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {uploadingProgress}%
            </p>
          </div>
        )}

        {hasPdf && (
          <>
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>PDF menu is live and ready to scan</span>
            </div>
            <button
              onClick={handleRemove}
              disabled={uploading}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove PDF menu
            </button>
          </>
        )}
      </div>

      {/* QR code card */}
      <div className="mt-6 rounded-3xl border border-border bg-card p-6">
        <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <QrCode className="h-4 w-4 text-ember" />
          Customer QR code
        </h2>
        {info?.has_pdf ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              Print this QR code and place it on tables, at the counter, or on your
              window — customers scan it and see your PDF menu instantly.
            </p>

            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div
                id="pdf-menu-qr"
                className="rounded-2xl border border-border bg-white p-4"
              >
                <QRCodeSVG value={pageUrl} size={240} />
              </div>
              <div className="flex flex-col gap-2">
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-mist"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open menu page
                </a>
                <button
                  onClick={handleDownloadQR}
                  className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-colors hover:opacity-90"
                >
                  <Download className="h-4 w-4" />
                  Download QR
                </button>
                <button
                  onClick={handleCopyUrl}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-mist"
                >
                  <Copy className="h-4 w-4" />
                  Copy link
                </button>
              </div>
            </div>

            <p className="mt-4 rounded-xl bg-mist px-3 py-2 text-[11px] break-all text-muted-foreground">
              {pageUrl}
            </p>
          </>
        ) : (
          <div className="mt-4 rounded-2xl bg-mist px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              Upload a PDF menu above to unlock your QR code.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}