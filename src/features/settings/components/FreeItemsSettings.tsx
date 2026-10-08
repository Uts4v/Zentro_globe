import { useState } from "react";
import { Gift, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { merchantApi } from "@/lib/api";
import { posSetFreeItemPin } from "@/features/pos/api";

interface FreeItemsSettingsProps {
  enabled: boolean;
  pinSet: boolean;
  onChange: (next: { free_items_enabled?: boolean; free_item_pin_set?: boolean }) => void;
}

/**
 * Merchant control over free items: an on/off switch and an optional PIN that
 * staff must enter before giving an item away. Changes are saved straight
 * away (they are safety settings, so they do not wait for the page's Save).
 */
export function FreeItemsSettings({ enabled, pinSet, onChange }: FreeItemsSettingsProps) {
  const [toggling, setToggling] = useState(false);
  const [editingPin, setEditingPin] = useState(false);
  const [pin, setPin] = useState("");
  const [proof, setProof] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setToggling(true);
    try {
      const updated = await merchantApi.update({ free_items_enabled: !enabled } as never);
      const now = Boolean((updated as { free_items_enabled?: boolean }).free_items_enabled);
      onChange({ free_items_enabled: now });
      toast.success(now ? "Staff can now give free items" : "Free items are turned off");
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : "Could not save this setting.");
    } finally {
      setToggling(false);
    }
  }

  function closePinForm() {
    setEditingPin(false);
    setPin("");
    setProof("");
    setError("");
  }

  async function savePin(nextPin: string) {
    setSavingPin(true);
    setError("");
    try {
      // The server accepts either the current PIN or the account password.
      const res = await posSetFreeItemPin({
        pin: nextPin,
        current_pin: pinSet ? proof : undefined,
        account_password: pinSet ? proof : undefined,
      });
      onChange({ free_item_pin_set: res.free_item_pin_set });
      toast.success(res.free_item_pin_set ? "Free item PIN saved" : "Free item PIN removed");
      closePinForm();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Could not save the PIN.");
    } finally {
      setSavingPin(false);
    }
  }

  const pinValid = /^\d{4,8}$/.test(pin);
  const proofGiven = !pinSet || proof.length > 0;

  return (
    <section className="glass-strong rounded-3xl p-6">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-bold uppercase tracking-wider text-foreground">
            Allow Staff to Give Free Items
          </span>
        </div>
        <button
          onClick={toggle}
          disabled={toggling}
          role="switch"
          aria-checked={enabled}
          aria-label="Allow staff to give free items"
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            enabled ? "bg-ink" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {enabled
          ? "Staff whose role allows it can mark an item as free at the POS. Every free item is recorded with the name of the person who gave it."
          : "Off. Nobody can give a free item or a Staff Free order at the POS."}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose which roles may give free items in Team → Roles (“Give free items”).
      </p>

      {enabled && (
        <div className="mt-4 rounded-2xl border border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {pinSet ? (
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="font-medium text-foreground">
                {pinSet ? "A PIN is required for free items" : "No PIN: free items need no extra check"}
              </span>
            </div>
            {!editingPin && (
              <button
                type="button"
                onClick={() => setEditingPin(true)}
                className="min-h-[40px] rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
              >
                {pinSet ? "Change PIN" : "Set a PIN"}
              </button>
            )}
          </div>

          {editingPin && (
            <div className="mt-4 space-y-3">
              {pinSet && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    Current PIN or your account password
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={proof}
                    onChange={(e) => setProof(e.target.value)}
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">
                  New PIN (4 to 8 digits)
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-lg tracking-[0.3em] focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => savePin(pin)}
                  disabled={!pinValid || !proofGiven || savingPin}
                  className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-ink px-5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {savingPin && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save PIN
                </button>
                {pinSet && (
                  <button
                    type="button"
                    onClick={() => savePin("")}
                    disabled={!proofGiven || savingPin}
                    className="min-h-[44px] rounded-xl border border-destructive/30 px-4 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    Remove PIN
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePinForm}
                  disabled={savingPin}
                  className="min-h-[44px] rounded-xl border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
