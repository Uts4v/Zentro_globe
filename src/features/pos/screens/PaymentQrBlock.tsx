import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";

interface PaymentQrBlockProps {
  qr: { url: string; name: string; account_name?: string | null; instructions?: string | null };
  /** Amount the customer should pay, shown above the QR. */
  amount: number;
  currencySymbol: string;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}

/**
 * The merchant's payment QR on the payment screen. It is drawn large, on a
 * white card with a clear margin, so a customer can scan it across the
 * counter; tapping it fills the screen for scanning from further away.
 */
export default function PaymentQrBlock({
  qr,
  amount,
  currencySymbol,
  confirmed,
  onConfirmedChange,
}: PaymentQrBlockProps) {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (!fullScreen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setFullScreen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fullScreen]);

  return (
    <div className="mx-6 mb-4 rounded-2xl border border-border bg-muted/40 p-4 text-center">
      <p className="text-sm font-semibold text-foreground">{qr.name}</p>
      {qr.account_name && <p className="text-xs text-muted-foreground">{qr.account_name}</p>}
      <p className="numeric mt-1 text-2xl font-bold tracking-tight text-ink">
        {formatCurrency(amount, currencySymbol)}
      </p>

      <button
        type="button"
        onClick={() => setFullScreen(true)}
        aria-label="Show the QR code full screen"
        className="group relative mx-auto mt-3 block w-full max-w-[22rem] rounded-2xl bg-white p-4 shadow-sm ring-1 ring-border transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <img
          src={qr.url}
          alt={`${qr.name} payment QR`}
          className="aspect-square w-full object-contain"
        />
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-semibold text-white">
          <Maximize2 className="h-3 w-3" aria-hidden="true" />
          Make bigger
        </span>
      </button>

      {qr.instructions && (
        <p className="mx-auto mt-3 max-w-sm text-xs leading-snug text-muted-foreground">
          {qr.instructions}
        </p>
      )}

      <label className="mx-auto mt-3 flex max-w-sm cursor-pointer items-start gap-2.5 rounded-xl bg-card px-3 py-2.5 text-left text-sm text-foreground ring-1 ring-border">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-border accent-ink"
        />
        <span>Customer has scanned and shown me their payment confirmation</span>
      </label>

      {fullScreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${qr.name} payment QR`}
          onClick={() => setFullScreen(false)}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-white p-6"
        >
          <button
            type="button"
            onClick={() => setFullScreen(false)}
            aria-label="Close full screen QR"
            className="absolute right-4 top-4 grid h-12 w-12 place-items-center rounded-full bg-neutral-100 text-neutral-900 hover:bg-neutral-200"
          >
            <X className="h-6 w-6" />
          </button>
          <div className="text-center text-neutral-900">
            <p className="text-lg font-semibold">{qr.name}</p>
            <p className="numeric text-4xl font-bold tracking-tight">
              {formatCurrency(amount, currencySymbol)}
            </p>
          </div>
          <img
            src={qr.url}
            alt={`${qr.name} payment QR`}
            className="aspect-square w-[min(88vw,70vh)] object-contain"
          />
          <p className="text-sm text-neutral-500">Tap anywhere to go back</p>
        </div>
      )}
    </div>
  );
}
