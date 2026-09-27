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

export function extractTableFromUrl(text: string): { slug?: string; token: string } | null {
  if (!text) return null;
  const clean = text.trim();

  // 1. JSON payload support: {"slug": "...", "token": "..."} or {"table_token": "..."}
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const parsed = JSON.parse(clean);
      if (typeof parsed === "object" && parsed !== null) {
        const token =
          parsed.token ||
          parsed.table_token ||
          parsed.tableToken ||
          parsed.table ||
          parsed.public_token;
        const slug = parsed.slug || parsed.merchant_slug || parsed.merchant;
        if (token && typeof token === "string") {
          return {
            slug: typeof slug === "string" && slug.trim() ? slug.trim() : undefined,
            token: token.trim(),
          };
        }
      }
    } catch {
      // Not JSON, continue with URL patterns
    }
  }

  // 2. Full URL or path: /m/<slug>/table/<token>
  // e.g. https://.../m/coffee-hub/table/TBL-1234 or /m/coffee-hub/table/TBL-1234
  const mMatch = clean.match(/(?:^|\/)m\/([^/?#]+)\/table\/([^/?#]+)/i);
  if (mMatch) {
    return {
      slug: decodeURIComponent(mMatch[1]),
      token: decodeURIComponent(mMatch[2]),
    };
  }

  // 3. Standalone table path: /table/<token> or /table/<token>/order
  // e.g. https://.../table/TBL-1234/order or /table/TBL-1234
  const tableMatch = clean.match(/(?:^|\/)table\/([^/?#]+)/i);
  if (tableMatch) {
    const rawToken = decodeURIComponent(tableMatch[1]);
    if (rawToken && rawToken.toLowerCase() !== "order") {
      return { token: rawToken };
    }
  }

  // 4. Query parameter patterns: ?table=... or ?token=... or ?table_token=...
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
          slug: slug && slug.trim() ? slug.trim() : undefined,
          token: token.trim(),
        };
      }
    } catch {
      // Ignore query parse error
    }
  }

  // 5. Check segments anywhere in a URL path (e.g. nested subpaths)
  const parts = clean
    .replace(/^https?:\/\/[^/]+/, "")
    .split("/")
    .filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "m" && parts[i + 2] === "table" && parts[i + 3]) {
      return { slug: parts[i + 1], token: parts[i + 3] };
    }
    if (parts[i] === "table" && parts[i + 1] && parts[i + 1].toLowerCase() !== "order") {
      return { token: parts[i + 1] };
    }
  }

  // 6. Bare table token (e.g. TBL-XXXX or TBL_XXXX)
  if (/^TBL[-_][A-Za-z0-9_-]+$/i.test(clean)) {
    return { token: clean };
  }

  // 7. Generic URL-safe token (no slashes, length 6-64)
  if (!clean.includes("/") && !clean.includes(" ") && /^[A-Za-z0-9_-]{6,64}$/.test(clean)) {
    return { token: clean };
  }

  return null;
}

export function TableQRScanner({ onClose }: TableQRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
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
            if (resolving) return;
            const text = decodedText?.trim() || "";

            // User accidentally scanned a Loyalty QR code instead of Table QR
            if (text.includes("MQR_") || text.includes("/loyalty/qr/")) {
              setError(
                "This appears to be a customer loyalty QR, not a table QR. Please scan the QR code located on your table.",
              );
              return;
            }

            const match = extractTableFromUrl(text);
            if (!match || !match.token) {
              setError("Invalid table QR code. Please scan a table QR.");
              return;
            }

            setResolving(true);
            setError(null);
            try {
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
              const message =
                err?.response?.data?.error ||
                err?.message ||
                "Table not found or table ordering is disabled. Please scan again.";
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
  }, [resolving, navigate, setActiveTable, setSelectedMerchant, onClose]);

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
            <span className="text-sm text-muted-foreground">Resolving table...</span>
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
