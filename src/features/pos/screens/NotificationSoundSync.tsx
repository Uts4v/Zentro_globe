import { useEffect } from "react";
import { posGetSettings } from "../api";
import { setMerchantNotificationSoundEnabled } from "@/lib/notification-sound";

const SYNC_INTERVAL_MS = 45_000;

/**
 * Keeps the merchant-wide notification-sound switch fresh on this terminal.
 *
 * The actual sounds are played synchronously, so they read a cached copy of the
 * master switch. This headless component refreshes that cache periodically and
 * when the tab regains focus / the connection returns.
 */
export default function NotificationSoundSync() {
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const settings = await posGetSettings();
        if (cancelled) return;
        if (typeof settings.notification_sound_enabled === "boolean") {
          setMerchantNotificationSoundEnabled(settings.notification_sound_enabled);
        }
      } catch {
        // Offline or temporarily unreachable — keep the cached value.
      }
    };

    void sync();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void sync();
    }, SYNC_INTERVAL_MS);

    const onFocus = () => void sync();
    const onOnline = () => void sync();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return null;
}
