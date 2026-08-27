import { useState } from "react";
import { usePosStore } from "../store";
import { posUpdateSettings, PosSettings } from "../api";
import { Settings, Save, Loader2 } from "lucide-react";

export default function PosSettingsScreen() {
  const posSettings = usePosStore((s) => s.posSettings);
  const [settings, setSettings] = useState<PosSettings | null>(posSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await posUpdateSettings(settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 lg:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="h-5 w-5 text-ink" />
        <h1 className="text-xl font-bold text-foreground">POS Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Feature toggles */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-bold text-foreground">Features</h2>
          <div className="space-y-4">
            {([
              ["pos_enabled", "POS Enabled"],
              ["offline_pos_enabled", "Offline Mode"],
              ["credit_accounts_enabled", "Credit Accounts"],
              ["debit_accounts_enabled", "Debit Accounts"],
              ["discounts_enabled", "Discounts"],
              ["shift_management_enabled", "Shift Management"],
              ["receipt_printing_enabled", "Receipt Printing"],
            ] as const).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between"
              >
                <span className="text-sm text-foreground">{label}</span>
                <button
                  onClick={() =>
                    setSettings((s) =>
                      s ? { ...s, [key]: !s[key] } : s
                    )
                  }
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    settings[key] ? "bg-ink" : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      settings[key] ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </label>
            ))}
          </div>
        </section>

        {/* Discount Limits */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-4 text-sm font-bold text-foreground">
            Discount Limits
          </h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Max Worker Discount (%)
              </label>
              <input
                type="number"
                value={settings.max_worker_discount_percent}
                onChange={(e) =>
                  setSettings((s) =>
                    s
                      ? {
                          ...s,
                          max_worker_discount_percent: e.target.value,
                        }
                      : s
                  )
                }
                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Manager Approval Threshold ({settings.currency_symbol || "Rs"})
              </label>
              <input
                type="number"
                value={settings.manager_approval_threshold}
                onChange={(e) =>
                  setSettings((s) =>
                    s
                      ? {
                          ...s,
                          manager_approval_threshold: e.target.value,
                        }
                      : s
                  )
                }
                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </div>
            <label className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                Offline Discounts Allowed
              </span>
              <button
                onClick={() =>
                  setSettings((s) =>
                    s
                      ? {
                          ...s,
                          offline_discounts_allowed: !s.offline_discounts_allowed,
                        }
                      : s
                  )
                }
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  settings.offline_discounts_allowed ? "bg-ink" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.offline_discounts_allowed
                      ? "translate-x-5"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
            <label className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                Offline Credit Allowed
              </span>
              <button
                onClick={() =>
                  setSettings((s) =>
                    s
                      ? {
                          ...s,
                          offline_credit_allowed: !s.offline_credit_allowed,
                        }
                      : s
                  )
                }
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  settings.offline_credit_allowed ? "bg-ink" : "bg-gray-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    settings.offline_credit_allowed
                      ? "translate-x-5"
                      : "translate-x-0.5"
                  }`}
                />
              </button>
            </label>
          </div>
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "Saved!" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
