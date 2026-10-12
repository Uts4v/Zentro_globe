/**
 * Voice announcement setup for this terminal.
 *
 * Saves to localStorage on every change — like Printers & Routing it belongs to
 * the machine, not the merchant account, so it works offline and never depends
 * on the server-side Save Settings button.
 */

import { useCallback, useEffect, useState } from "react";
import { Volume2, Play } from "lucide-react";
import {
  defaultVoiceSettings,
  loadVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "./settings";
import { testVoice } from "./coordinator";

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between">
      <span className={`text-sm ${disabled ? "text-muted-foreground/60" : "text-foreground"}`}>
        {label}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? "bg-ink" : "bg-muted"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-[left] ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

export function VoiceAnnouncementSettings() {
  const [settings, setSettings] = useState<VoiceSettings>(defaultVoiceSettings);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // localStorage is unavailable during SSR, so settings load after mount.
  useEffect(() => {
    setSettings(loadVoiceSettings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);

  const persist = useCallback((next: VoiceSettings) => {
    setSettings(next);
    saveVoiceSettings(next);
  }, []);

  const patch = (changes: Partial<VoiceSettings>) => persist({ ...settings, ...changes });

  const off = !settings.enabled;

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-ink" />
        <h2 className="text-sm font-bold text-foreground">Voice Announcements</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Reads new customer/table-QR orders aloud on this terminal. Saved on this device — works
        offline and does not need Save Settings.
      </p>

      <div className="space-y-4">
        <Toggle
          label="Voice announcements"
          checked={settings.enabled}
          onChange={(next) => patch({ enabled: next })}
        />

        <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Announce
          </p>
          <div className="space-y-3">
            <Toggle
              label="New customer orders"
              checked={settings.announceNewOrders}
              onChange={(next) => patch({ announceNewOrders: next })}
              disabled={off}
            />
            <Toggle
              label="Add-on orders"
              checked={settings.announceAddOnOrders}
              onChange={(next) => patch({ announceAddOnOrders: next })}
              disabled={off}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Include
          </p>
          <div className="space-y-3">
            <Toggle
              label="Customer first name"
              checked={settings.includeCustomerName}
              onChange={(next) => patch({ includeCustomerName: next })}
              disabled={off}
            />
            <Toggle
              label="Variants"
              checked={settings.includeVariants}
              onChange={(next) => patch({ includeVariants: next })}
              disabled={off}
            />
            <Toggle
              label="Add-ons"
              checked={settings.includeModifiers}
              onChange={(next) => patch({ includeModifiers: next })}
              disabled={off}
            />
            <Toggle
              label="Special notes"
              checked={settings.includeNotes}
              onChange={(next) => patch({ includeNotes: next })}
              disabled={off}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Voice</label>
          <select
            value={settings.voiceURI}
            onChange={(e) => patch({ voiceURI: e.target.value })}
            className="w-full rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          >
            <option value="">Device default</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Volume</span>
            <span>{Math.round(settings.volume * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => patch({ volume: Number(e.target.value) })}
            className="w-full accent-ink"
          />
        </div>

        <button
          type="button"
          onClick={() => testVoice(settings)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-muted"
        >
          <Play className="h-3.5 w-3.5" />
          Test voice
        </button>
      </div>
    </section>
  );
}
