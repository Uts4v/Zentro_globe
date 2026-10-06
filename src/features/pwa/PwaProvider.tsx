// src/features/pwa/PwaProvider.tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { BeforeInstallPromptEvent, InstallPlatform, PwaState } from "./types";

interface PwaContextValue extends PwaState {
  promptInstall: () => Promise<boolean>;
  dismissInstall: () => void;
  applyUpdate: () => Promise<void>;
}

const PwaContext = createContext<PwaContextValue | null>(null);

const DISMISSED_KEY = "zentro_install_dismissed_at";
const DISMISSED_COUNT_KEY = "zentro_install_dismiss_count";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getPlatform(): InstallPlatform {
  if (!isBrowser()) return "unsupported";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) return "ios";
  if (/android/i.test(ua)) return "android";
  if ("serviceWorker" in navigator) return "desktop";
  return "unsupported";
}

function getStandalone(): boolean {
  if (!isBrowser()) return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

function wasRecentlyDismissed(): boolean {
  if (!isBrowser()) return false;
  try {
    const ts = localStorage.getItem(DISMISSED_KEY);
    if (!ts) return false;
    const elapsed = Date.now() - Number(ts);
    return elapsed < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function getDismissCount(): number {
  if (!isBrowser()) return 0;
  try {
    return Number(localStorage.getItem(DISMISSED_COUNT_KEY) || "0");
  } catch {
    return 0;
  }
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("unsupported");
  const [standalone, setStandalone] = useState(false);

  // ── Detect platform & standalone on client only ─────────────────────────────
  useEffect(() => {
    setPlatform(getPlatform());
    setStandalone(getStandalone());
  }, []);

  const isInstallable = deferredPrompt !== null || platform === "ios";

  // ── Listen for beforeinstallprompt ──────────────────────────────────────────
  useEffect(() => {
    if (!isBrowser()) return;
    function handler(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // ── Detect installed state ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isBrowser()) return;
    if (standalone) {
      setIsInstalled(true);
      return;
    }
    function handler() {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, [standalone]);

  // ── Register service worker (production only) ──────────────────────────────
  useEffect(() => {
    if (!isBrowser() || !("serviceWorker" in navigator)) return;
    // injectManifest only compiles the SW at build time; skip in dev
    if (import.meta.env.DEV) return;

    // Defer service worker registration until after page load
    const registerSW = () => {
      navigator.serviceWorker
        .register("/service-worker.js", { scope: "/" })
        .then((reg) => {
          const interval = setInterval(() => reg.update(), 60 * 60 * 1000);

          reg.addEventListener("updatefound", () => {
            const newSw = reg.installing;
            if (!newSw) return;
            newSw.addEventListener("statechange", () => {
              if (newSw.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateAvailable(true);
              }
            });
          });

          return () => clearInterval(interval);
        })
        .catch((err) => {
          console.warn("SW registration failed:", err);
        });
    };

    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW, { once: true });
    }
  }, []);

  // ── Offline ready from SW ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isBrowser()) return;
    function handler() {
      setOfflineReady(true);
    }
    window.addEventListener("offlineReady", handler as EventListener);
    return () => window.removeEventListener("offlineReady", handler as EventListener);
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === "accepted";
  }, [deferredPrompt]);

  const dismissInstall = useCallback(() => {
    if (!isBrowser()) return;
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
      const count = getDismissCount() + 1;
      localStorage.setItem(DISMISSED_COUNT_KEY, String(count));
    } catch {
      /* ignore */
    }
    setDeferredPrompt(null);
  }, []);

  /**
   * Swap in the waiting update and reload once it has taken over.
   *
   * Reloading on `controllerchange` is safe *only* because the worker no longer
   * calls skipWaiting() on its own: control changes here because the user asked
   * for it, not because a deploy happened. An open till therefore keeps its cart
   * until someone accepts the update.
   */
  const applyUpdate = useCallback(async () => {
    if (!isBrowser()) return;
    if (!navigator.serviceWorker.controller) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
    navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
  }, []);

  const value: PwaContextValue = useMemo(
    () => ({
      isInstallable,
      isInstalled,
      isStandalone: standalone,
      platform,
      deferredPrompt,
      updateAvailable,
      offlineReady,
      promptInstall,
      dismissInstall,
      applyUpdate,
    }),
    [
      isInstallable,
      isInstalled,
      standalone,
      platform,
      deferredPrompt,
      updateAvailable,
      offlineReady,
      promptInstall,
      dismissInstall,
      applyUpdate,
    ],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaContextValue {
  const ctx = useContext(PwaContext);
  if (!ctx) throw new Error("usePwa must be used within PwaProvider");
  return ctx;
}

export function useInstallEligible(): boolean {
  const { isInstalled, isStandalone, isInstallable } = usePwa();

  if (isInstalled || isStandalone || !isInstallable) return false;
  if (wasRecentlyDismissed()) return false;
  if (getDismissCount() >= 3) return false;

  return true;
}
