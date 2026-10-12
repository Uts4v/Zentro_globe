/**
 * Voice-announcement preferences, stored per terminal.
 *
 * Like printers, the voice belongs to the machine in the reception area rather
 * than to the merchant account, so this lives in localStorage and saves
 * immediately — independent of the server-side Save Settings button.
 */

export const VOICE_SETTINGS_KEY = "pos_voice_settings";

export interface VoiceSettings {
  /** Master switch. Off by default so speech is never a surprise. */
  enabled: boolean;
  /** Speak brand-new incoming orders (customer app / table QR). */
  announceNewOrders: boolean;
  /** Speak items added to an existing remote order. */
  announceAddOnOrders: boolean;
  /** Say the customer's first name. */
  includeCustomerName: boolean;
  /** Say the chosen variant (e.g. "Large"). */
  includeVariants: boolean;
  /** Say chosen add-ons / modifiers (e.g. "Extra cheese"). */
  includeModifiers: boolean;
  /** Say special instructions. */
  includeNotes: boolean;
  /** speechSynthesis voiceURI; "" means the device default. */
  voiceURI: string;
  /** 0..1. */
  volume: number;
}

export function defaultVoiceSettings(): VoiceSettings {
  return {
    enabled: false,
    announceNewOrders: true,
    announceAddOnOrders: true,
    includeCustomerName: true,
    includeVariants: true,
    includeModifiers: true,
    includeNotes: true,
    voiceURI: "",
    volume: 0.8,
  };
}

export function loadVoiceSettings(): VoiceSettings {
  const base = defaultVoiceSettings();
  if (typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : base.enabled,
      announceNewOrders:
        typeof parsed.announceNewOrders === "boolean"
          ? parsed.announceNewOrders
          : base.announceNewOrders,
      announceAddOnOrders:
        typeof parsed.announceAddOnOrders === "boolean"
          ? parsed.announceAddOnOrders
          : base.announceAddOnOrders,
      includeCustomerName:
        typeof parsed.includeCustomerName === "boolean"
          ? parsed.includeCustomerName
          : base.includeCustomerName,
      includeVariants:
        typeof parsed.includeVariants === "boolean" ? parsed.includeVariants : base.includeVariants,
      includeModifiers:
        typeof parsed.includeModifiers === "boolean"
          ? parsed.includeModifiers
          : base.includeModifiers,
      includeNotes:
        typeof parsed.includeNotes === "boolean" ? parsed.includeNotes : base.includeNotes,
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : base.voiceURI,
      volume:
        typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : base.volume,
    };
  } catch {
    return base;
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full / unavailable — announcements still work for this session.
  }
}
