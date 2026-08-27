import { useState, useEffect } from "react";
import { useAuth, type MerchantProfile } from "@/lib/auth";
import { merchantApi } from "@/lib/api";
import { CURRENCIES } from "@/lib/currency";
import {
  Settings,
  Save,
  Loader2,
  Plus,
  Trash2,
  Zap,
  Check,
  AlertTriangle,
  Store,
} from "lucide-react";

const TAX_PRESETS: Record<string, Array<{ name: string; rate: number }>> = {
  nepal: [{ name: "VAT", rate: 13 }],
  india: [
    { name: "CGST", rate: 9 },
    { name: "SGST", rate: 9 },
  ],
  india_igst: [{ name: "IGST", rate: 18 }],
  singapore: [{ name: "GST", rate: 9 }],
  australia: [{ name: "GST", rate: 10 }],
  custom: [],
};

export function MerchantSettingsPage() {
  const { merchantProfile, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(merchantProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (merchantProfile) setProfile(merchantProfile);
  }, [merchantProfile]);

  if (!profile) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const taxComponents = profile.tax_components || [];
  const totalTaxRate = taxComponents.reduce((sum, c) => sum + (Number(c.rate) || 0), 0);

  function addTaxComponent() {
    setProfile((p) =>
      p
        ? {
            ...p,
            tax_components: [...(p.tax_components || []), { name: "", rate: 0 }],
          }
        : p
    );
  }

  function removeTaxComponent(index: number) {
    setProfile((p) =>
      p
        ? {
            ...p,
            tax_components: (p.tax_components || []).filter((_, i) => i !== index),
          }
        : p
    );
  }

  function updateTaxComponent(index: number, field: "name" | "rate", value: string) {
    setProfile((p) =>
      p
        ? {
            ...p,
            tax_components: (p.tax_components || []).map((c, i) =>
              i === index
                ? {
                    ...c,
                    [field]: field === "rate" ? Number.parseFloat(value) || 0 : value,
                  }
                : c
            ),
          }
        : p
    );
  }

  function applyPreset(preset: Array<{ name: string; rate: number }>) {
    setProfile((p) => (p ? { ...p, tax_components: preset } : p));
  }

  function handleCurrencyChange(code: string) {
    const currency = CURRENCIES.find((c) => c.code === code);
    if (!currency) return;
    setProfile((p) =>
      p
        ? {
            ...p,
            currency_code: currency.code,
            currency_symbol: currency.symbol,
          }
        : p
    );
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await merchantApi.update({
        tax_enabled: profile.tax_enabled,
        tax_rate_percent: profile.tax_rate_percent,
        tax_components: profile.tax_components,
        currency_code: profile.currency_code,
        currency_symbol: profile.currency_symbol,
      } as any);
      setProfile({ ...profile });
      if (refreshProfile) await refreshProfile();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-mist">
          <Settings className="h-5 w-5 text-ink" />
        </div>
        <div>
          <h1 className="font-display text-3xl text-foreground">Settings</h1>
          <p className="text-xs text-muted-foreground">
            Configure tax, currency, and system-wide settings
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Currency ──────────────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Store className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">Currency</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Set the currency used across POS, invoices, receipts, reports, and analytics.
        </p>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Currency</label>
          <select
            value={profile.currency_code || "NPR"}
            onChange={(e) => handleCurrencyChange(e.target.value)}
            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="rounded-xl bg-mist px-4 py-2">
            <span className="text-lg font-bold text-foreground">
              {profile.currency_symbol || "Rs"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {profile.currency_code || "NPR"} — This symbol will appear on all prices, invoices, and
            reports
          </span>
        </div>
      </section>

      {/* ── Tax Configuration ──────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-foreground uppercase tracking-wider">
              Tax Configuration
            </span>
            {totalTaxRate > 0 && (
              <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink">
                Total: {totalTaxRate}%
              </span>
            )}
          </div>
          <button
            onClick={() => setProfile((p) => (p ? { ...p, tax_enabled: !p.tax_enabled } : p))}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              profile.tax_enabled ? "bg-ink" : "bg-gray-200"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                profile.tax_enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          {profile.tax_enabled
            ? "Tax is enabled. Configured tax will be applied to all new orders."
            : "Tax is disabled. No tax will be calculated on orders."}
        </p>

        {profile.tax_enabled && (
          <>
            {/* Presets */}
            <div className="mb-4">
              <label className="mb-2 block text-xs text-muted-foreground">Quick Setup</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "nepal", label: "Nepal VAT 13%" },
                  { key: "india", label: "India GST 9+9%" },
                  { key: "india_igst", label: "India IGST 18%" },
                  { key: "singapore", label: "Singapore GST 9%" },
                  { key: "australia", label: "Australia GST 10%" },
                  { key: "custom", label: "Custom" },
                ].map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() =>
                      applyPreset(
                        TAX_PRESETS[preset.key] || []
                      )
                    }
                    className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <Zap className="h-3 w-3" />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tax components */}
            <div className="space-y-3">
              {taxComponents.map((comp, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Name (e.g. VAT, GST)"
                    value={comp.name}
                    onChange={(e) => updateTaxComponent(idx, "name", e.target.value)}
                    className="flex-1 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                  <div className="relative w-24">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={comp.rate || ""}
                      onChange={(e) => updateTaxComponent(idx, "rate", e.target.value)}
                      className="w-full rounded-xl border border-border bg-muted/50 px-3 py-2 pr-7 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                  <button
                    onClick={() => removeTaxComponent(idx)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}

              <button
                onClick={addTaxComponent}
                className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add tax component
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Summary ──────────────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <h2 className="mb-4 text-sm font-bold text-foreground uppercase tracking-wider">
          Configuration Summary
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
            <span className="text-sm text-foreground">Currency</span>
            <span className="font-medium text-sm text-foreground">
              {profile.currency_symbol} {profile.currency_code}
            </span>
          </div>
          <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
            <span className="text-sm text-foreground">Tax Status</span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                profile.tax_enabled
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              {profile.tax_enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          {profile.tax_enabled && taxComponents.length > 0 && (
            <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
              <span className="text-sm text-foreground">Tax Components</span>
              <span className="font-medium text-sm text-foreground">
                {taxComponents.map((c) => `${c.name} ${c.rate}%`).join(" + ")}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ── Save ──────────────────────────────────────────────────────── */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-3.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : saved ? (
          <Check className="h-4 w-4" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        {saved ? "Saved Successfully" : "Save Settings"}
      </button>

      <p className="text-center text-[11px] text-muted-foreground pb-8">
        These settings are the single source of truth for your entire system. POS, orders,
        invoices, reports, and analytics will use these configurations.
      </p>
    </div>
  );
}
