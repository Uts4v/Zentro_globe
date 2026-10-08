// src/components/ClearCacheControl.tsx
// The in-app escape hatch for a browser stuck on a stale copy of Zentro — most
// often a POS terminal showing a menu it saved before a dish was added.
//
// Clearing has to be safe to offer to a merchant, so this dialog states exactly
// what it will and will not touch, keeps them signed in, and keeps any order
// this device has taken offline but not yet sent.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, TriangleAlert, WifiOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearAppCache, countPendingOfflineSales } from "@/lib/clear-app-cache";

export function ClearCacheDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pendingSales, setPendingSales] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setPendingSales(null);
      return;
    }
    let cancelled = false;
    countPendingOfflineSales().then((count) => {
      if (!cancelled) setPendingSales(count);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleClear() {
    setBusy(true);
    try {
      const result = await clearAppCache();
      toast.success(
        `Cache cleared${result.storageKeys || result.caches ? "" : " — nothing was stored"}`,
      );
      onOpenChange(false);
      // The page is rendered by the worker we just unregistered, and every
      // in-memory copy of the old data is still here. Reload onto a clean one.
      window.location.reload();
    } catch {
      toast.error("Could not clear the cache. Try again, or clear it in your browser settings.");
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-ink">Clear app cache</DialogTitle>
          <DialogDescription>
            Removes the copies of Zentro this browser has saved — the POS menu and tables it keeps
            for offline use, cached files, images and the service worker.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-2xl bg-mist px-4 py-3 text-xs text-muted-foreground">
            <p className="mb-1.5 font-semibold text-foreground">This will:</p>
            <ul className="space-y-1">
              <li>· Sign out the POS staff account saved on this device</li>
              <li>· Un-register this device — it rejoins under the merchant you sign into</li>
              <li>· Delete the POS offline menu, tables and staff saved on this device</li>
              <li>· Delete cached files, images and fonts</li>
              <li>· Reinstall the app shell on the next load</li>
            </ul>
          </div>

          <div className="rounded-2xl bg-mist px-4 py-3 text-xs text-muted-foreground">
            <p className="mb-1.5 font-semibold text-foreground">This will not:</p>
            <ul className="space-y-1">
              <li>· Sign you out of Google or your account</li>
              <li>· Delete anything on the server</li>
              <li>
                · Delete orders taken offline on this device
                {pendingSales !== null && pendingSales > 0 && (
                  <span className="font-semibold text-amber-700">
                    {" "}
                    — {pendingSales} still waiting to send
                  </span>
                )}
              </li>
            </ul>
          </div>

          {pendingSales === null && busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking for unsent offline orders…
            </p>
          )}

          {pendingSales !== null && pendingSales > 0 && (
            <p className="flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <WifiOff className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                {pendingSales} order or payment from this device has not reached the server yet.
                Sync it first — clearing will not remove it, but it is safer to let it send.
              </span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-12 flex-1 rounded-2xl bg-mist text-sm font-medium text-ink transition-opacity hover:opacity-80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Clear cache
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Compact row for the merchant settings page. */
export function ClearCacheRow() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl bg-mist px-4 py-3 text-left transition-opacity hover:opacity-80"
      >
        <TriangleAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">
          <span className="block text-sm font-medium text-foreground">Clear app cache</span>
          <span className="block text-xs text-muted-foreground">
            Fix a POS terminal or this browser showing an old copy of your menu
          </span>
        </span>
      </button>
      <ClearCacheDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Sidebar footer entry: the same action, always one click from anywhere. */
export function ClearCacheNavButton({
  className,
  disabled,
  disabledReason,
}: {
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(true);
        }}
        title={
          disabled
            ? disabledReason || "Needs an internet connection"
            : "Clear this browser's saved copy of Zentro"
        }
        disabled={disabled}
        className={className}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        Clear cache
      </button>
      <ClearCacheDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
