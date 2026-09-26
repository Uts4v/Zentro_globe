import { useEffect, useState } from "react";
import { Check, Loader2, QrCode, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { posGetSettings } from "../api";
import { usePosStore } from "../store";

interface PaymentQrModalProps {
  amount: number;
  onClose: () => void;
  /** Staff confirm the customer's QR payment arrived; recorded as "QR Payment". */
  onConfirm: () => void;
  confirming?: boolean;
}

/**
 * Shows the merchant's own payment QR for the customer to scan. Nothing is
 * verified automatically — staff confirm once they see the payment.
 */
export default function PaymentQrModal({
  amount,
  onClose,
  onConfirm,
  confirming = false,
}: PaymentQrModalProps) {
  const posSettings = usePosStore((s) => s.posSettings);
  const setPosSettings = usePosStore((s) => s.setPosSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [qrUrl, setQrUrl] = useState(posSettings?.payment_qr_url || "");
  const [checking, setChecking] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);

  // Re-read settings so a QR uploaded (or removed) after the POS loaded shows up.
  useEffect(() => {
    let active = true;
    posGetSettings()
      .then((fresh) => {
        if (!active) return;
        setQrUrl(fresh.payment_qr_url || "");
        setImageFailed(false);
        const current = usePosStore.getState().posSettings;
        if (current) setPosSettings({ ...current, payment_qr_url: fresh.payment_qr_url || "" });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [setPosSettings]);

  const showQr = qrUrl && !imageFailed;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-qr-title"
        className="w-full max-w-md overflow-hidden rounded-3xl bg-card shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-ink" />
            <h3 id="payment-qr-title" className="text-base font-bold text-foreground">
              Scan to Pay
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 text-center">
          <p className="text-xs text-muted-foreground">Amount to pay</p>
          <p className="numeric mt-1 text-3xl font-bold tracking-tight text-ink">
            {formatCurrency(amount, currencySymbol)}
          </p>

          <div className="mt-4">
            {showQr ? (
              <img
                src={qrUrl}
                alt="Merchant payment QR code"
                onError={() => setImageFailed(true)}
                className="mx-auto aspect-square w-full max-w-[18rem] rounded-2xl border border-border bg-white object-contain p-3"
              />
            ) : checking ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading QR code…
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
                <p className="font-semibold">
                  {imageFailed ? "The QR code image couldn't be loaded." : "No payment QR code set up yet."}
                </p>
                <p className="mt-1 text-xs">
                  Add one in Merchant → Settings → Payment QR Code. You can still record a QR
                  payment the customer made another way.
                </p>
              </div>
            )}
          </div>

          {showQr && (
            <p className="mt-3 text-xs text-muted-foreground">
              Ask the customer to scan and pay, then confirm once the payment is received.
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={confirming}
            className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Payment Received
          </button>
        </div>
      </div>
    </div>
  );
}
