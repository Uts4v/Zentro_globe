/**
 * Notification-sound preferences.
 *
 * Two switches control every in-app alert sound:
 *  - the merchant master switch, persisted on the server and cached here so
 *    audio can stay synchronous, and
 *  - the terminal-local switch, stored in localStorage like printer and voice
 *    settings so each POS device can mute itself.
 *
 * Sound is allowed only when the local switch is on AND the merchant master is
 * not explicitly off. An unknown master (first load / offline) defaults to on,
 * which preserves the previous behaviour.
 */

import { apiUrl, djangoFetch, tokenStore } from "@/lib/django-api-base";

export const MERCHANT_NOTIFICATION_SOUND_KEY = "zentro_notification_sound_merchant";
export const LOCAL_NOTIFICATION_SOUND_KEY = "zentro_notification_sound_local";

function readBoolean(key: string): boolean | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeBoolean(key: string, value: boolean | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage full / unavailable — keep the current session working.
  }
}

export function getMerchantNotificationSoundEnabled(): boolean | null {
  return readBoolean(MERCHANT_NOTIFICATION_SOUND_KEY);
}

export function setMerchantNotificationSoundEnabled(enabled: boolean | null | undefined): void {
  if (enabled === undefined || enabled === null) {
    writeBoolean(MERCHANT_NOTIFICATION_SOUND_KEY, null);
    return;
  }
  writeBoolean(MERCHANT_NOTIFICATION_SOUND_KEY, enabled);
}

export function clearMerchantNotificationSound(): void {
  writeBoolean(MERCHANT_NOTIFICATION_SOUND_KEY, null);
}

export function getLocalNotificationSoundEnabled(): boolean {
  return readBoolean(LOCAL_NOTIFICATION_SOUND_KEY) ?? true;
}

export function setLocalNotificationSoundEnabled(enabled: boolean): void {
  writeBoolean(LOCAL_NOTIFICATION_SOUND_KEY, enabled);
}

export function isNotificationSoundEnabled(): boolean {
  if (!getLocalNotificationSoundEnabled()) return false;
  return getMerchantNotificationSoundEnabled() !== false;
}

/**
 * Refresh just the cached master switch without updating auth state, so
 * periodic syncing never clobbers an in-progress merchant settings form.
 */
export async function refreshMerchantNotificationSound(): Promise<void> {
  const token = tokenStore.getAccess();
  if (!token) return;
  try {
    const profile = await djangoFetch<{ notification_sound_enabled?: boolean }>(
      apiUrl("/merchants/me/"),
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (typeof profile.notification_sound_enabled === "boolean") {
      setMerchantNotificationSoundEnabled(profile.notification_sound_enabled);
    }
  } catch {
    // Offline or temporarily unreachable — keep the cached value.
  }
}
