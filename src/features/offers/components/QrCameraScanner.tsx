import { useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";

/**
 * Minimal camera QR reader: calls onResult once with the decoded text.
 * The camera is released on unmount.
 */
export function QrCameraScanner({ onResult }: { onResult: (text: string) => void }) {
  const id = `qr-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const doneRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let started = false;
    (async () => {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled) return;
      const scanner = new Html5Qrcode(id);
      scannerRef.current = scanner;
      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text) => {
            if (doneRef.current) return;
            doneRef.current = true;
            onResult(text.trim());
          },
          () => {},
        );
        started = true;
        if (cancelled) await scanner.stop().catch(() => {});
      } catch {
        setError("Camera unavailable. Type the code instead.");
      }
    })();
    return () => {
      cancelled = true;
      if (started) scannerRef.current?.stop().catch(() => {});
    };
    // onResult is read once; restarting the camera on every render is not wanted.
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div id={id} className="overflow-hidden rounded-2xl bg-black" style={{ minHeight: 220 }} />
      {error && <p className="mt-2 text-xs text-ember">{error}</p>}
    </div>
  );
}
