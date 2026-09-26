import { useState, useEffect, useRef } from "react";
import { useAuth, type MerchantProfile } from "@/lib/auth";
import { merchantApi } from "@/lib/api";
import { CURRENCIES } from "@/lib/currency";
<<<<<<< HEAD
import { apiUrl } from "@/lib/django-api-base";
import { uploadPaymentQr as uploadPaymentQrFile } from "@/lib/image-upload";
=======
import { uploadMerchantPaymentQr } from "@/lib/image-upload";
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
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
  QrCode,
  Upload,
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

/**
 * Tenders a merchant can turn on. `split` is a marker for multi-tender orders
 * rather than a tender of its own, so it is not offered here - it mirrors
 * `PosPayment.METHOD_CHOICES` in `pos/models.py`.
 */
const PAYMENT_METHOD_OPTIONS = [
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
  { key: "bank_qr", label: "Bank QR", needsQr: true },
  { key: "mobile_wallet", label: "Mobile Wallet" },
  { key: "credit", label: "Credit" },
  { key: "debit", label: "Debit" },
  { key: "other", label: "Other" },
]   as const;

/**
 * `merchantApi` speaks the API-shaped `MerchantProfile` (string `id`) while the
 * auth context keeps its own copy (numeric `id`). Only the payment config is
 * copied back, so the two shapes never have to be reconciled.
 */
function paymentConfigOf(source: {
  payment_methods_configured?: boolean;
  accepted_payment_methods?: string[];
  payment_method_labels?: Record<string, string>;
  payment_qr_enabled?: boolean;
  payment_qr_url?: string | null;
  payment_qr_name?: string | null;
  payment_qr_instructions?: string | null;
  payment_qr_account_name?: string | null;
}) {
  return {
    payment_methods_configured: source.payment_methods_configured,
    accepted_payment_methods: source.accepted_payment_methods,
    payment_method_labels: source.payment_method_labels,
    payment_qr_enabled: source.payment_qr_enabled,
    payment_qr_url: source.payment_qr_url,
    payment_qr_name: source.payment_qr_name,
    payment_qr_instructions: source.payment_qr_instructions,
    payment_qr_account_name: source.payment_qr_account_name,
  };
}

export function MerchantSettingsPage() {
  const { merchantProfile, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(merchantProfile);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
<<<<<<< HEAD
  const [qrUploading, setQrUploading] = useState(false);
=======
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState("");
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
  const qrInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (merchantProfile) setProfile(merchantProfile);
  }, [merchantProfile]);

  // The payment QR saves on its own (the upload is already immediate), so it
  // doesn't wait for the page's Save button.
  async function savePaymentQr(url: string) {
    await merchantApi.update({ payment_qr_url: url });
    setProfile((p) => (p ? { ...p, payment_qr_url: url } : p));
    if (refreshProfile) await refreshProfile();
  }

  async function handleQrFile(file: File | undefined) {
    if (!file || !profile) return;
    setQrBusy(true);
    setQrError("");
    try {
      const { publicUrl } = await uploadMerchantPaymentQr(file, String(profile.id));
      await savePaymentQr(publicUrl);
    } catch (e: unknown) {
      setQrError(e instanceof Error ? e.message : "Could not upload the QR code");
    } finally {
      setQrBusy(false);
      if (qrInputRef.current) qrInputRef.current.value = "";
    }
  }

  async function handleQrRemove() {
    setQrBusy(true);
    setQrError("");
    try {
      await savePaymentQr("");
    } catch (e: unknown) {
      setQrError(e instanceof Error ? e.message : "Could not remove the QR code");
    } finally {
      setQrBusy(false);
    }
  }

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
        : p,
    );
  }

  function removeTaxComponent(index: number) {
    setProfile((p) =>
      p
        ? {
            ...p,
            tax_components: (p.tax_components || []).filter((_, i) => i !== index),
          }
        : p,
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
                : c,
            ),
          }
        : p,
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
        : p,
    );
  }

  function acceptedMethods(): string[] {
    return profile?.accepted_payment_methods ?? [];
  }

  function togglePaymentMethod(key: string) {
    setError("");
    setProfile((p) => {
      if (!p) return p;
      const current = p.accepted_payment_methods || [];
      const on = current.includes(key);
      if (on && current.length === 1) {
        setError("Keep at least one payment method enabled.");
        return p;
      }
      // The backend refuses QR without an image; catch it here so the merchant
      // gets a useful message instead of a 400 after the fact.
      if (!on && key === "bank_qr" && !p.payment_qr_url) {
        setError("Upload a payment QR image before enabling QR payment.");
        return p;
      }
      return {
        ...p,
        accepted_payment_methods: on
          ? current.filter((k) => k !== key)
          : [...current, key],
        payment_qr_enabled: key === "bank_qr" ? !on : p.payment_qr_enabled,
      };
    });
  }

  function setPaymentLabel(key: string, value: string) {
    setProfile((p) => {
      if (!p) return p;
      const labels = { ...(p.payment_method_labels || {}) };
      if (value.trim()) labels[key] = value.trim();
      else delete labels[key];
      return { ...p, payment_method_labels: labels };
    });
  }

  async function uploadPaymentQr(file: File) {
    setQrUploading(true);
    setError("");
    try {
      const url = await uploadPaymentQrFile(file);
      setProfile((p) =>
        p
          ? {
              ...p,
              payment_qr_url: absoluteMediaUrl(url),
              payment_qr_name: p.payment_qr_name || "Bank QR",
            }
          : p,
      );
    } catch (e: any) {
      setError(e?.message || "Could not upload the QR image.");
    } finally {
      setQrUploading(false);
      if (qrInputRef.current) qrInputRef.current.value = "";
    }
  }

  function absoluteMediaUrl(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return url.startsWith("/") ? apiUrl(url.replace(/^\/api\//, "")) : url;
  }

  async function removePaymentQr() {
    setError("");
    try {
      // Clearing the URL also disables QR, otherwise the merchant would be left
      // with a tender that has nothing to show the customer.
      const updated = await merchantApi.update({
        payment_qr_url: "",
        payment_qr_enabled: false,
        accepted_payment_methods: (profile?.accepted_payment_methods || []).filter(
          (k: string) => k !== "bank_qr",
        ),
      } as any);
      setProfile((p) => (p ? { ...p, ...paymentConfigOf(updated) } : p));
    } catch (e: any) {
      setError(e?.message || "Could not remove the QR image.");
    }
  }

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const payload = {
        tax_enabled: profile.tax_enabled,
        tax_rate_percent: profile.tax_rate_percent,
        tax_components: profile.tax_components,
        currency_code: profile.currency_code,
        currency_symbol: profile.currency_symbol,
        accepted_payment_methods: profile.accepted_payment_methods,
        payment_method_labels: profile.payment_method_labels,
        payment_qr_url: profile.payment_qr_url ?? "",
        payment_qr_name: profile.payment_qr_name ?? "",
        payment_qr_instructions: profile.payment_qr_instructions ?? "",
        payment_qr_account_name: profile.payment_qr_account_name ?? "",
        payment_qr_enabled: profile.payment_qr_enabled ?? false,
      } as any;
      // Never let the serializer's cross-field validation surprise the merchant
      // after they hit save: QR requires an image, and at least one tender.
      if (payload.payment_qr_enabled && !payload.payment_qr_url) {
        setError("Upload a payment QR image before enabling QR payment.");
        setSaving(false);
        return;
      }
      if (!payload.accepted_payment_methods?.length) {
        setError("Enable at least one payment method.");
        setSaving(false);
        return;
      }
      const updated = await merchantApi.update(payload);
      setProfile((p) => (p ? { ...p, ...paymentConfigOf(updated) } : p));
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
            role="switch"
            aria-checked={profile.tax_enabled}
            aria-label="Enable tax"
            className={`relative h-6 w-11 rounded-full transition-colors ${
              profile.tax_enabled ? "bg-ink" : "bg-border"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
                profile.tax_enabled ? "left-[22px]" : "left-0.5"
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
                    onClick={() => applyPreset(TAX_PRESETS[preset.key] || [])}
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
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                    aria-label={`Remove ${comp.name || "tax component"}`}
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

<<<<<<< HEAD
      {/* ── Payment methods ────────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="mb-1 flex items-center gap-2">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Payment Methods
          </h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Staff record what the customer paid in cash. Zentro never contacts a
          payment provider, so no terminal or gateway is required.
        </p>

        <div className="space-y-2">
          {PAYMENT_METHOD_OPTIONS.map((option) => {
            const on = acceptedMethods().includes(option.key);
            const custom = profile.payment_method_labels?.[option.key];
            return (
              <div
                key={option.key}
                className={`rounded-2xl border px-4 py-3 transition-colors ${
                  on ? "border-ink bg-ink/[0.03]" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <label className="flex flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => togglePaymentMethod(option.key)}
                      className="h-4 w-4 rounded border-border accent-ink"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {custom || option.label}
                    </span>
                  </label>
                  {on && (
                    <input
                      value={custom ?? ""}
                      onChange={(e) => setPaymentLabel(option.key, e.target.value)}
                      placeholder={option.label}
                      maxLength={30}
                      className="w-32 rounded-lg border border-border bg-mist/50 px-2.5 py-1 text-xs text-foreground focus:border-ink focus:outline-none"
                    />
                  )}
                </div>
                {on && "needsQr" in option && option.needsQr && !profile.payment_qr_url && (
                  <p className="mt-2 pl-7 text-[11px] text-amber-700">
                    Add a payment QR below before saving.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Payment QR ─────────────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="mb-1 flex items-center gap-2">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Payment QR
          </h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Shown to the customer in the POS payment sheet. Uploaded images are
          re-encoded server-side, so only a picture can be stored here.
        </p>

        <div className="flex items-start gap-4">
          {profile.payment_qr_url ? (
            <div className="shrink-0">
              <img
                src={profile.payment_qr_url}
                alt="Payment QR code"
                className="h-32 w-32 rounded-xl border border-border bg-white object-contain p-1"
              />
            </div>
          ) : (
            <div className="grid h-32 w-32 shrink-0 place-items-center rounded-xl border border-dashed border-border text-muted-foreground">
              <QrCode className="h-8 w-8 opacity-40" />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Label shown with the QR
              </label>
              <input
                value={profile.payment_qr_name ?? ""}
                onChange={(e) =>
                  setProfile((p) => (p ? { ...p, payment_qr_name: e.target.value } : p))
                }
                placeholder="e.g. Fonepay QR"
                maxLength={60}
                className="w-full rounded-xl border border-border bg-mist/50 px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Account name
              </label>
              <input
                value={profile.payment_qr_account_name ?? ""}
                onChange={(e) =>
                  setProfile((p) =>
                    p ? { ...p, payment_qr_account_name: e.target.value } : p,
                  )
                }
                placeholder="e.g. Zentro Cafe Sdn Bhd"
                maxLength={80}
                className="w-full rounded-xl border border-border bg-mist/50 px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Instructions for the customer
              </label>
              <textarea
                value={profile.payment_qr_instructions ?? ""}
                onChange={(e) =>
                  setProfile((p) =>
                    p ? { ...p, payment_qr_instructions: e.target.value } : p,
                  )
                }
                rows={2}
                maxLength={240}
                placeholder="Scan with your banking app, then show us the confirmation."
                className="w-full resize-none rounded-xl border border-border bg-mist/50 px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            ref={qrInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadPaymentQr(file);
            }}
          />
          <button
            type="button"
            onClick={() => qrInputRef.current?.click()}
            disabled={qrUploading}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-mist disabled:opacity-50"
          >
            {qrUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {profile.payment_qr_url ? "Replace QR" : "Upload QR"}
          </button>
          {profile.payment_qr_url && (
            <>
              <button
                type="button"
                onClick={removePaymentQr}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
=======
      {/* ── Payment QR Code ───────────────────────────────────────────────── */}
      <section className="glass-strong rounded-3xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <QrCode className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-bold text-foreground uppercase tracking-wider">
            Payment QR Code
          </h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Upload the QR code customers scan to pay you (for example your bank or wallet QR). The
          POS shows it when staff choose QR Payment, and staff confirm the payment once it's
          received. Changes save automatically.
        </p>

        {profile.payment_qr_url ? (
          <div className="flex flex-wrap items-center gap-4">
            <img
              src={profile.payment_qr_url}
              alt="Your payment QR code"
              className="h-40 w-40 rounded-xl border border-border bg-white object-contain p-2"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={() => qrInputRef.current?.click()}
                disabled={qrBusy}
                className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                {qrBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Replace
              </button>
              <button
                onClick={handleQrRemove}
                disabled={qrBusy}
                className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
<<<<<<< HEAD
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={!!profile.payment_qr_enabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    if (on && !profile.payment_qr_url) {
                      setError("Upload a payment QR image before enabling QR payment.");
                      return;
                    }
                    setProfile((p) => (p ? { ...p, payment_qr_enabled: on } : p));
                  }}
                  className="h-4 w-4 rounded border-border accent-ink"
                />
                Show this QR to customers
              </label>
            </>
          )}
        </div>
        {qrUploading && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Uploading… the image is kept at full size so it stays scannable.
          </p>
        )}
=======
            </div>
          </div>
        ) : (
          <button
            onClick={() => qrInputRef.current?.click()}
            disabled={qrBusy}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-8 text-sm font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground disabled:opacity-50"
          >
            {qrBusy ? <Loader2 className="h-6 w-6 animate-spin" /> : <QrCode className="h-6 w-6" />}
            {qrBusy ? "Uploading…" : "Upload QR code image"}
            <span className="text-xs font-normal">PNG, JPG or WebP, up to 5 MB</span>
          </button>
        )}

        <input
          ref={qrInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleQrFile(e.target.files?.[0])}
        />
        {qrError && <p className="mt-3 text-xs text-rose-600">{qrError}</p>}
>>>>>>> 80ccaa5f674bfd3940693f5f8234c0b36bc8e64e
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
                  : "bg-muted text-muted-foreground"
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
          <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
            <span className="text-sm text-foreground">Payment Methods</span>
            <span className="font-medium text-sm text-foreground">
              {acceptedMethods()
                .map(
                  (key) =>
                    profile.payment_method_labels?.[key] ||
                    PAYMENT_METHOD_OPTIONS.find((o) => o.key === key)?.label ||
                    key,
                )
                .join(", ") || "None"}
            </span>
          </div>
          {profile.payment_qr_enabled && (
            <div className="flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
              <span className="text-sm text-foreground">Payment QR</span>
              <span className="font-medium text-sm text-foreground">
                {profile.payment_qr_name || "Enabled"}
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

      <p className="text-center text-xs text-muted-foreground pb-8">
        These settings are the single source of truth for your entire system. POS, orders, invoices,
        reports, and analytics will use these configurations.
      </p>
    </div>
  );
}
