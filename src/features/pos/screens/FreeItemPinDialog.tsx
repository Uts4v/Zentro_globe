import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";

interface FreeItemPinDialogProps {
  /** What is being given free, e.g. "Coffee" or "this order". */
  subject: string;
  /** Checks the PIN with the server; throws with a readable message when refused. */
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}

/** Asks for the merchant's free-item PIN before something is given away. */
export default function FreeItemPinDialog({ subject, onSubmit, onClose }: FreeItemPinDialogProps) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (err: unknown) {
      setError(err instanceof Error && err.message ? err.message : "That PIN was not accepted.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="free-item-pin-title"
        className="mx-4 w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-success/10">
            <Gift className="h-5 w-5 text-success" />
          </div>
          <div className="min-w-0">
            <h3 id="free-item-pin-title" className="text-base font-bold text-foreground">
              Free item PIN
            </h3>
            <p className="truncate text-xs text-muted-foreground">Giving {subject} free</p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">
            Enter the PIN set by the owner
          </span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-center text-xl tracking-[0.4em] focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-[44px] flex-1 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pin.length < 4 || busy}
            className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl bg-ink text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Give free"}
          </button>
        </div>
      </form>
    </div>
  );
}
