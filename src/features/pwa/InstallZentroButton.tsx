// src/features/pwa/InstallZentroButton.tsx
import { useState, useCallback } from "react";
import { usePwa, useInstallEligible } from "./PwaProvider";
import { Download, X, Check, Smartphone, Monitor } from "lucide-react";

export function InstallZentroButton({ className }: { className?: string }) {
  const { promptInstall, platform } = usePwa();
  const eligible = useInstallEligible();
  const [loading, setLoading] = useState(false);

  if (!eligible) return null;

  async function handleInstall() {
    setLoading(true);
    try {
      if (platform === "ios") {
        // iOS: show instructions (can't programmatically install)
        return;
      }
      await promptInstall();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleInstall} disabled={loading} className={className}>
      <Download className="h-4 w-4" />
      Install Zentro
    </button>
  );
}

export function InstallBanner() {
  const { promptInstall, platform, isInstallable, isInstalled, isStandalone, dismissInstall } =
    usePwa();
  const eligible = useInstallEligible();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [installed, setInstalled] = useState(false);

  if (!eligible || dismissed || isInstalled || isStandalone) return null;

  async function handleInstall() {
    setLoading(true);
    try {
      if (platform === "ios") {
        setDismissed(true);
        return;
      }
      const accepted = await promptInstall();
      if (accepted) setInstalled(true);
    } finally {
      setLoading(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    dismissInstall();
  }

  if (installed) {
    return (
      <div className="glass-strong mx-5 mb-4 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
            <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Zentro installed!</p>
            <p className="text-xs text-muted-foreground">
              You can now open Zentro from your home screen.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-strong mx-5 mb-4 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-soft">
          {platform === "ios" ? (
            <Smartphone className="h-5 w-5 text-ember" />
          ) : (
            <Monitor className="h-5 w-5 text-ember" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Install Zentro</p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            Faster access, order alerts, and membership cards — right from your home screen.
          </p>
          {platform === "ios" ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Tap <span className="font-medium">Share</span> →{" "}
              <span className="font-medium">Add to Home Screen</span> in Safari.
            </p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleInstall}
                disabled={loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-xs font-medium text-primary-foreground shadow-ember transition-all active:scale-[0.98] disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {loading ? "Installing…" : "Install"}
              </button>
              <button
                onClick={handleDismiss}
                className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Not now
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = usePwa();
  const [dismissed, setDismissed] = useState(false);

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="glass-strong mx-5 mb-4 rounded-2xl p-4 border border-ember/20">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-soft">
          <Download className="h-5 w-5 text-ember" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-foreground">Update available</p>
          <p className="text-xs text-muted-foreground">Refresh to get the latest features.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={applyUpdate}
            className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-xs font-medium text-primary-foreground"
          >
            Update
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
