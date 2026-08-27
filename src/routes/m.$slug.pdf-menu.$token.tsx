// routes/m.$slug.pdf-menu.$token.tsx — Customer PDF menu view (accessed via QR scan)
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, FileText, Download, House, MapPin, Phone } from "lucide-react";
import { pdfMenuApi, type PublicPdfMenuResolution } from "@/lib/api/pdf-menu";

export const Route = createFileRoute("/m/$slug/pdf-menu/$token")({
  head: () => ({ meta: [{ title: "Menu · Zentro" }] }),
  component: PdfMenuPage,
});

function PdfMenuPage() {
  const { slug, token } = Route.useParams();
  const [resolution, setResolution] = useState<PublicPdfMenuResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchPdf = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await pdfMenuApi.resolve(slug, token);
        if (!cancelled) {
          if (res.has_pdf && res.pdf_url) {
            setResolution(res);
          } else {
            setError("This merchant hasn't uploaded a PDF menu yet.");
          }
        }
      } catch {
        if (!cancelled) {
          setError("We couldn't find this menu. Please scan the QR code again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPdf();
    return () => { cancelled = true; };
  }, [slug, token]);

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Loading menu...</p>
      </div>
    );
  }

  if (error || !resolution?.pdf_url) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center bg-background">
        <p className="text-5xl">🍽️</p>
        <p className="text-sm text-muted-foreground">
          {error ?? "Menu not available."}
        </p>
        <Link
          to="/"
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to home
        </Link>
      </div>
    );
  }

  const merchant = resolution.merchant;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {merchant.logo ? (
              <img
                src={merchant.logo}
                alt={merchant.name}
                className="h-10 w-10 rounded-2xl object-cover"
              />
            ) : (
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-mist text-xl">
                🍽️
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg text-foreground">
                {merchant.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {merchant.address && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" /> {merchant.address}
                  </span>
                )}
                {merchant.phone && (
                  <span className="inline-flex items-center gap-0.5">
                    <Phone className="h-3 w-3" /> {merchant.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
          <a
            href={`${resolution.pdf_url}?download=1`}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-xs font-medium text-background"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>
        </div>
      </div>

      {/* PDF embed */}
      <div className="flex flex-1 items-stretch bg-mist/40">
        <iframe
          src={resolution.pdf_url}
          title={`${merchant.name} — Menu`}
          className="h-[calc(100dvh-72px)] w-full border-0"
        />
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between border-t border-border bg-background px-5 py-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          Enjoy your meal at {merchant.name}!
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
        >
          <House className="h-3 w-3" /> Zentro
        </Link>
      </div>
    </div>
  );
}