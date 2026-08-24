import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { CameraOff, X, Loader2 } from "lucide-react";

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

const QR_PREFIX = "zentro-transfer:";
const SCANNER_ID = "zentro-qr-scanner";

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = document.getElementById(SCANNER_ID);
    if (!el) return;

    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          let code = decodedText;
          if (code.startsWith(QR_PREFIX)) {
            code = code.slice(QR_PREFIX.length);
          }
          startedRef.current = false;
          onScan(code.toUpperCase());
          onClose();
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
  }, [onScan, onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-4">
        <button
          onClick={onClose}
          className="absolute -right-2 -top-2 grid h-8 w-8 place-items-center rounded-full bg-white shadow-md"
        >
          <X className="h-4 w-4" />
        </button>

        <h3 className="mb-3 text-center text-sm font-medium text-ink">Scan recipient QR</h3>

        <div id={SCANNER_ID} className="mx-auto overflow-hidden rounded-xl" />

        {error ? (
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
