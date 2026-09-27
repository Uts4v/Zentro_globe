import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Html5Qrcode } from "html5-qrcode";
import { CameraOff, X, Loader2 } from "lucide-react";
import { tableApi } from "@/lib/api";
import { useStore } from "@/lib/store";

interface TableQRScannerProps {
  onClose: () => void;
}

const SCANNER_ID = "table-qr-scanner";

export type ScannedQRResult =
  | { type: "table"; slug?: string; token: string }
  | { type: "pdf_menu"; slug: string; token: string }
  | { type: "merchant"; slug: string };

export function parseScannedQR(text: string): ScannedQRResult | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. JSON payload support
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const parsed = JSON.parse(clean);
      if (typeof parsed === "object" && parsed !== null) {
        if (parsed.pdf_menu_token && parsed.slug) {
          return {
            type: "pdf_menu",
            slug: String(parsed.slug).trim(),
            token: String(parsed.pdf_menu_token).trim(),
          };
        }
        const token =
          parsed.token ||
          parsed.table_token ||
          parsed.tableToken ||
          parsed.table ||
          parsed.public_token;
        const slug = parsed.slug || parsed.merchant_slug || parsed.merchant;
        if (token && typeof token === "string") {
          return {
            type: "table",
            slug: typeof slug === "string" && slug.trim() ? slug.trim() : undefined,
            token: token.trim(),
          };
        }
        if (slug && typeof slug === "string") {
          return {
            type: "merchant",
            slug: slug.trim(),
          };
        }
      }
    } catch {
      // Not JSON, continue with URL patterns
    }
  }

  // 2. PDF Menu URL: /m/<slug>/pdf-menu/<token>
  const pdfMatch = clean.match(/(?:^|\/)m\/([^/?#]+)\/pdf-menu\/([^/?#]+)/i);
  if (pdfMatch) {
    return {
      type: "pdf_menu",
      slug: decodeURIComponent(pdfMatch[1]),
      token: decodeURIComponent(pdfMatch[2]),
    };
  }

  // 3. Table URL or path: /m/<slug>/table/<token>
  const mMatch = clean.match(/(?:^|\/)m\/([^/?#]+)\/table\/([^/?#]+)/i);
  if (mMatch) {
    return {
      type: "table",
      slug: decodeURIComponent(mMatch[1]),
      token: decodeURIComponent(mMatch[2]),
    };
  }

  // 4. Standalone table path: /table/<token> or /table/<token>/order
  const tableMatch = clean.match(/(?:^|\/)table\/([^/?#]+)/i);
  if (tableMatch) {
    const rawToken = decodeURIComponent(tableMatch[1]);
    if (rawToken && rawToken.toLowerCase() !== "order") {
      return { type: "table", token: rawToken };
    }
  }

  // 5. Query parameter patterns
  if (clean.includes("?")) {
    try {
      const urlObj =
        clean.startsWith("http://") || clean.startsWith("https://")
          ? new URL(clean)
          : new URL(`https://dummy.local/${clean.replace(/^\/+/, "")}`);
      const token =
        urlObj.searchParams.get("token") ||
        urlObj.searchParams.get("table") ||
        urlObj.searchParams.get("table_token") ||
        urlObj.searchParams.get("public_token");
      const slug =
        urlObj.searchParams.get("slug") || urlObj.searchParams.get("merchant");
      if (token) {
        return {
          type: "table",
          slug: slug && slug.trim() ? slug.trim() : undefined,
          token: token.trim(),
        };
      }
      if (slug) {
        return {
          type: "merchant",
          slug: slug.trim(),
        };
      }
    } catch {
      // Ignore query parse error
    }
  }

  // 6. Check segments anywhere in URL path
  const parts = clean
    .replace(/^https?:\/\/[^/]+/, "")
    .split("/")
    .filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "m" && parts[i + 2] === "table" && parts[i + 3]) {
      return { type: "table", slug: parts[i + 1], token: parts[i + 3] };
    }
    if (parts[i] === "m" && parts[i + 2] === "pdf-menu" && parts[i + 3]) {
      return { type: "pdf_menu", slug: parts[i + 1], token: parts[i + 3] };
    }
    if (parts[i] === "table" && parts[i + 1] && parts[i + 1].toLowerCase() !== "order") {
      return { type: "table", token: parts[i + 1] };
    }
  }

  // 7. Storefront link: /m/<slug> or /customer/merchant/<slug>
  const storeMatch = clean.match(/(?:^|\/)(?:customer\/merchant|m)\/([^/?#]+)\/?$/i);
  if (storeMatch) {
    const rawSlug = decodeURIComponent(storeMatch[1]);
    if (rawSlug && rawSlug !== "table" && rawSlug !== "pdf-menu") {
      return { type: "merchant", slug: rawSlug };
    }
  }

  // 8. Bare table token (e.g. TBL-XXXX or TBL_XXXX)
  if (/^TBL[-_][A-Za-z0-9_-]+$/i.test(clean)) {
    return { type: "table", token: clean };
  }

  // 9. Generic URL-safe token (no slashes, length 6-64)
  if (!clean.includes("/") && !clean.includes(" ") && /^[A-Za-z0-9_-]{6,64}$/.test(clean)) {
    return { type: "table", token: clean };
  }

  return null;
}

// Backwards compatibility alias
export function extractTableFromUrl(text: string): { slug?: string; token: string } | null {
  const result = parseScannedQR(text);
  if (result && result.type === "table") {
    return { slug: result.slug, token: result.token };
  }
  return null;
}

export function TableQRScanner({ onClose }: TableQRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const isProcessingRef = useRef(false);
  const hasNavigatedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [resolving, setResolving] = useState(false);

  const navigate = useNavigate();
  const { setActiveTable, setSelectedMerchant } = useStore();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const el = document.getElementById(SCANNER_ID);
    if (!el) return;

    let cancelled = false;

    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;

      const scanner = new Html5Qrcode(SCANNER_ID);
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText: string) => {
            // Guard: completely ignore duplicate frames while resolving or after navigation
            if (isProcessingRef.current || hasNavigatedRef.current) return;
            isProcessingRef.current = true;

            // Pause camera stream immediately so subsequent frames do not fire
            try {
              if (scannerRef.current && startedRef.current) {
                scannerRef.current.pause(true);
              }
            } catch {}

            const text = decodedText?.trim() || "";

            // User accidentally scanned a Loyalty customer QR code
            if (text.includes("MQR_") || text.includes("/loyalty/qr/")) {
              setError(
                "This appears to be a customer loyalty QR, not a table or menu QR. Please scan the QR code located on your table.",
              );
              isProcessingRef.current = false;
              try {
                scannerRef.current?.resume();
              } catch {}
              return;
            }

            const match = parseScannedQR(text);
            if (!match) {
              setError("Unrecognized QR code. Please scan a store or table QR.");
              isProcessingRef.current = false;
              try {
                scannerRef.current?.resume();
              } catch {}
              return;
            }

            setResolving(true);
            setError(null);

            try {
              // 1. PDF Menu QR code
              if (match.type === "pdf_menu") {
                hasNavigatedRef.current = true;
                startedRef.current = false;
                await scanner.stop().catch(() => {});
                onClose();
                navigate({
                  to: "/m/$slug/pdf-menu/$token",
                  params: {
                    slug: match.slug,
                    token: match.token,
                  },
                  replace: true,
                });
                return;
              }

              // 2. Storefront QR code
              if (match.type === "merchant") {
                hasNavigatedRef.current = true;
                startedRef.current = false;
                await scanner.stop().catch(() => {});
                onClose();
                navigate({
                  to: "/m/$slug",
                  params: {
                    slug: match.slug,
                  },
                  replace: true,
                });
                return;
              }

              // 3. Table QR code
              const resolution = await tableApi.resolve(match.slug, match.token);
              const resolvedSlug = resolution.merchant.slug;
              const resolvedToken = resolution.table.public_token;

              // Update store context so table is active across customer experience
              setActiveTable({
                merchantSlug: resolvedSlug,
                tableToken: resolvedToken,
                tableId: resolution.table.id,
                tableName: resolution.table.name,
                scannedAt: Date.now(),
              });
              setSelectedMerchant(String(resolution.merchant.id));

              hasNavigatedRef.current = true;
              startedRef.current = false;
              await scanner.stop().catch(() => {});

              // Close the scanner modal dialog
              onClose();

              // Redirect directly to that store's table menu!
              navigate({
                to: "/m/$slug/table/$token",
                params: {
                  slug: resolvedSlug,
                  token: resolvedToken,
                },
                replace: true,
              });
            } catch (err: any) {
              hasNavigatedRef.current = false;
              isProcessingRef.current = false;
              try {
                scannerRef.current?.resume();
              } catch {}

              const message =
                err?.message ||
                "Table not found. Please scan again.";
              setError(message);
              setResolving(false);
            }
          },
          () => {},
        );
        startedRef.current = true;
        setReady(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(
          message ||
            "Camera access denied or unavailable. You can also use your smartphone camera to scan the QR code.",
        );
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      if (scannerRef.current && startedRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [navigate, setActiveTable, setSelectedMerchant, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-qr-scanner-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-card p-4">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-2 -top-2 grid h-9 w-9 place-items-center rounded-full bg-card shadow-md"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 id="table-qr-scanner-title" className="mb-3 text-center text-sm font-medium text-ink">
          Scan Table QR
        </h3>

        <div id={SCANNER_ID} className="mx-auto overflow-hidden rounded-xl" />

        {resolving ? (
          <div className="flex items-center justify-center gap-2 py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Resolving menu...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CameraOff className="h-8 w-8 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : !ready ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
