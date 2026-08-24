import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Html5Qrcode } from "html5-qrcode";
import { CameraOff, X, Loader2 } from "lucide-react";
import { tableApi } from "@/lib/api";
import { useStore } from "@/lib/store";

interface TableQRScannerProps {
  onClose: () => void;
}

const SCANNER_ID = "table-qr-scanner";

function extractTableFromUrl(text: string): { slug: string; token: string } | null {
  // Handle full URLs: https://example.com/m/<slug>/table/<token>
  // Handle relative paths: /m/<slug>/table/<token>
  // Handle bare slug/table/token patterns
  const patterns = [
    /\/m\/([^/]+)\/table\/([^/?#]+)/,
    /\/table\/([^/?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match.length === 3) {
        return { slug: match[1], token: match[2] };
      }
      // For /table/<token> without slug — try extracting from nearby context
    }
  }

  // Try to find slug and token as path segments anywhere
  const parts = text.replace(/^https?:\/\/[^/]+/, "").split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "m" && parts[i + 2] === "table" && parts[i + 3]) {
      return { slug: parts[i + 1], token: parts[i + 3] };
    }
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
    const el = document.getElementById(SCANNER_ID);
    if (!el) return;

    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          if (resolving) return;
          const match = extractTableFromUrl(decodedText);
          if (!match) {
            setError("Invalid table QR code. Please scan a table QR.");
            return;
          }

          setResolving(true);
          try {
            const resolution = await tableApi.resolve(match.slug, match.token);
            setActiveTable({
              merchantSlug: match.slug,
              tableToken: match.token,
              tableId: resolution.table.id,
              tableName: resolution.table.name,
              scannedAt: Date.now(),
            });
            setSelectedMerchant(String(resolution.merchant.id));
            startedRef.current = false;
            await scanner.stop().catch(() => {});
            navigate({ to: "/customer/merchant/$slug", params: { slug: match.slug }, replace: true });
          } catch {
            setError("Table not found. Please scan again.");
            setResolving(false);
          }
        },
        () => {},
      )
      .then(() => {
        startedRef.current = true;
        setReady(true);
      })
      .catch((err) => {
        setError(err?.message || "Camera access denied or unavailable. You can also use your smartphone camera to scan the QR code.");
        setReady(true);
      });

    return () => {
      if (scannerRef.current && startedRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
      scannerRef.current = null;
    };
  }, [resolving, navigate, setActiveTable, setSelectedMerchant]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4">
        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-white shadow-md"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="mb-3 text-center text-sm font-medium text-ink">Scan Table QR</h3>

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
