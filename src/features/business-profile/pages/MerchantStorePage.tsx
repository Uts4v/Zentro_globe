// business-profile/MerchantStore.tsx 
import { useState, useEffect, useCallback, useRef } from "react";
import { offersApi, type OfferCategory } from "@/lib/api/offers";
import {
  MapPin, Clock, Loader2, Save, Check, X,
  ImageIcon, Upload, QrCode, ExternalLink, RefreshCw,
  Palette, CreditCard,
} from "lucide-react";
import { merchantApi, type MerchantProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { optimizeImage } from "@/lib/image-optimize";
import { uploadImage } from "@/lib/image-upload";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

type ImgStatus =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; previewUrl: string }
  | { status: "error"; error: string };

// ── Inline image uploader ─────────────────────────────────────────────────────
function InlineImageUploader({
  label, hint, currentUrl, onUpload, onClear,
  aspectClass = "aspect-video", shape = "square", disabled = false,
  merchantId, bucket, storagePath, preset,
}: {
  label: string;
  hint?: string;
  currentUrl?: string | null;
  onUpload: (url: string) => void;
  onClear: () => void;
  aspectClass?: string;
  shape?: "square" | "circle";
  disabled?: boolean;
  merchantId: string;
  bucket: string;
  storagePath: string;
  preset: "logo" | "banner" | "profile" | "product";
}) {
  const [imgState, setImgState] = useState<ImgStatus>(
    currentUrl ? { status: "done", previewUrl: currentUrl } : { status: "idle" }
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUrl && imgState.status === "idle") {
      setImgState({ status: "done", previewUrl: currentUrl });
    }
  }, [currentUrl]);

  const imgUploading =
    imgState.status === "processing" || imgState.status === "uploading";
  const displayUrl =
    imgState.status === "uploading" || imgState.status === "done"
      ? imgState.previewUrl
      : currentUrl || null;
  const radiusCls = shape === "circle" ? "rounded-full" : "rounded-2xl";

  async function handleFile(file: File) {
    setImgState({ status: "processing" });
    let optimized;
    try {
      optimized = await optimizeImage(file, preset);
    } catch (err: any) {
      setImgState({ status: "error", error: err.message ?? "Could not process image." });
      return;
    }
    setImgState({ status: "uploading", previewUrl: optimized.previewUrl });
    try {
      const { publicUrl } = await uploadImage(file, preset, bucket, storagePath);
      setImgState({ status: "done", previewUrl: optimized.previewUrl });
      onUpload(publicUrl);
    } catch (err: any) {
      setImgState({ status: "error", error: err.message ?? "Upload failed." });
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function handleClear() {
    setImgState({ status: "idle" });
    onClear();
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled || imgUploading}
      />
      <div
        className={`relative ${aspectClass} w-full overflow-hidden border-2 border-dashed transition-colors
          ${radiusCls}
          ${disabled || imgUploading ? "cursor-wait" : "cursor-pointer hover:border-ink/40"}
          ${imgState.status === "error" ? "border-rose-400" : ""}
          ${imgState.status === "done" ? "border-emerald-400" : "border-border"}
        `}
        onClick={() => !disabled && !imgUploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={label}
            className={`h-full w-full object-cover ${radiusCls}`}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-mist p-4 text-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{hint ?? "Click or drag to upload"}</p>
            <p className="text-[10px] text-muted-foreground/60">JPG · PNG · WebP · max 5 MB</p>
          </div>
        )}
        {imgUploading && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 ${radiusCls}`}>
            <Loader2 className="h-7 w-7 animate-spin text-white" />
            <p className="text-xs font-medium text-white">
              {imgState.status === "processing" ? "Optimising…" : "Uploading…"}
            </p>
          </div>
        )}
        {imgState.status === "done" && (
          <div className="absolute bottom-2 right-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shadow">
              <Check className="h-3.5 w-3.5 text-white" />
            </span>
          </div>
        )}
        {displayUrl && !imgUploading && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex min-h-[18px] items-center justify-between">
        {imgState.status === "error" && (
          <p className="text-xs text-rose-500">{imgState.error}</p>
        )}
        {imgState.status === "done" && (
          <p className="text-xs text-emerald-600">Saved ✓</p>
        )}
        {displayUrl && !imgUploading && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ink hover:text-ink disabled:opacity-50"
          >
            <Upload className="h-3 w-3" /> Change
          </button>
        )}
      </div>
    </div>
  );
}

// ── QR Code section ───────────────────────────────────────────────────────────
function QRSection({
  profile,
  onRegenerate,
}: {
  profile: MerchantProfile | null;
  onRegenerate: () => void;
}) {
  const { refreshMerchantProfile } = useAuth();
  const storeUrl = `${window.location.origin}/customer/merchant/${profile?.slug ?? ""}`;

  const generateQR = useMutation({
    mutationFn: () => merchantApi.regenerateQR(),
    onSuccess: async () => {
      await refreshMerchantProfile();
      onRegenerate();
      toast.success("QR code generated!");
    },
    onError: () => {
      toast.error("Failed to generate QR code.");
    },
  });

  return (
    <section className="glass-strong rounded-3xl p-6">
      <div className="flex items-center gap-2">
        <QrCode className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-display text-2xl text-ink">QR Code &amp; Store Link</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Customers scan this to open your loyalty page. Print it and place it at your counter.
      </p>

      <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">

        {/* Left column — QR image + buttons */}
        <div className="flex shrink-0 flex-col items-center gap-3">
          {profile?.qr_code ? (
            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
              <img
                src={profile.qr_code}
                alt={`QR code for ${profile.business_name}`}
                className="h-48 w-48"
              />
            </div>
          ) : (
            <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-mist">
              <QrCode className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-center text-xs text-muted-foreground">No QR yet</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            {profile?.qr_code && (
              <a href={profile.qr_code}
                download={`${profile.slug}-qr.png`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-ink hover:text-ink"
              >
                Download
              </a>
            )}
            <button
              onClick={() => generateQR.mutate()}
              disabled={generateQR.isPending}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {generateQR.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {profile?.qr_code ? "Regenerate" : "Generate QR"}
            </button>
          </div>
        </div>
        {/* End left column */}

        {/* Right column — store link + slug info */}
        <div className="flex flex-1 flex-col gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Your store link
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-2xl bg-mist px-4 py-3">
              <span className="flex-1 truncate text-sm text-ink">{storeUrl}</span>
              <a href={`/customer/merchant/${profile?.slug}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-muted-foreground hover:text-ink"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Your slug
            </p>
            <p className="mt-1 text-sm text-ink">
              <span className="text-muted-foreground">/customer/merchant/</span>
              <span className="font-medium">{profile?.slug ?? "—"}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              To change your slug, contact support.
            </p>
          </div>

          <div className="rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
            The QR code points to your public customer page. It contains no
            private tokens — safe to print and share anywhere.
          </div>
        </div>
        {/* End right column */}

      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function MerchantStorePage() {
  const { merchantProfile: authMerchant } = useAuth();
  const [profile, setProfile] = useState<MerchantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categoryOptions, setCategoryOptions] = useState<OfferCategory[]>([]);
  useEffect(() => {
    offersApi.categories().then(setCategoryOptions).catch(() => setCategoryOptions([]));
  }, []);

  const [form, setForm] = useState({
    business_name: "",
    description: "",
    business_type: "",
    primary_category: "",
    city: "",
    area: "",
    address: "",
    phone: "",
    logo_url: "",
    banner_url: "",
    is_open: true,
    store_theme_color: "",
    card_text_color: "",
    card_background_image: "",
  });

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await merchantApi.me();
      setProfile(data);
      setForm({
        business_name: data.business_name || "",
        description: data.description || "",
        business_type: data.business_type || "",
        primary_category: data.primary_category ? String(data.primary_category) : "",
        city: data.city || "",
        area: data.area || "",
        address: data.address || "",
        phone: data.phone || "",
        logo_url: data.logo_url || "",
        banner_url: data.banner_url || "",
        is_open: data.is_open ?? true,
        store_theme_color: data.store_theme_color || "",
        card_text_color: data.card_text_color || "",
        card_background_image: data.card_background_image || "",
      });
    } catch (err) {
      setError("Could not load your store profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaved(false);
      setError(null);
      const updated = await merchantApi.update({
        ...form,
        primary_category: form.primary_category ? Number(form.primary_category) : null,
      });
      setProfile(updated);
      setForm({
        business_name: updated.business_name || "",
        description: updated.description || "",
        business_type: updated.business_type || "",
        primary_category: updated.primary_category ? String(updated.primary_category) : "",
        city: updated.city || "",
        area: updated.area || "",
        address: updated.address || "",
        phone: updated.phone || "",
        logo_url: updated.logo_url || "",
        banner_url: updated.banner_url || "",
        is_open: updated.is_open ?? true,
        store_theme_color: updated.store_theme_color || "",
        card_text_color: updated.card_text_color || "",
        card_background_image: updated.card_background_image || "",
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: string, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={fetchProfile}
          className="h-10 rounded-full bg-ink px-5 text-sm font-medium text-primary-foreground"
        >
          Retry
        </button>
      </div>
    );
  }

  const merchantId = String(profile?.id ?? "");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Storefront</p>
        <h1 className="font-display mt-1 text-5xl text-ink">Your store</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          How customers see you in the app. Keep it personal.
        </p>
      </div>

      {/* Open / closed + approval badge */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => updateField("is_open", !form.is_open)}
          className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-xs font-medium transition-all ${
            form.is_open ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${form.is_open ? "bg-emerald-500" : "bg-red-500"}`} />
          {form.is_open ? "Open" : "Closed"}
        </button>
        {profile && !profile.is_approved && (
          <span className="inline-flex h-9 items-center gap-2 rounded-full bg-amber-100 px-4 text-xs font-medium text-amber-700">
            Pending approval
          </span>
        )}
      </div>

      {/* ── QR Code & Store Link ── */}
      <QRSection profile={profile} onRegenerate={fetchProfile} />

      {/* ── Banner + Logo images ── */}
      <section className="glass-strong rounded-3xl p-6 space-y-6">
        <h2 className="font-display text-2xl text-ink">Images</h2>
        {merchantId && (
          <InlineImageUploader
            label="Store banner"
            hint="Recommended 1200 × 500 px"
            currentUrl={form.banner_url}
            onUpload={(url) => updateField("banner_url", url)}
            onClear={() => updateField("banner_url", "")}
            aspectClass="aspect-[12/5]"
            shape="square"
            merchantId={merchantId}
            bucket="banner-images"
            storagePath={`${merchantId}/banner.webp`}
            preset="banner"
          />
        )}
        {merchantId && (
          <div className="flex items-start gap-5">
            <div className="w-28 shrink-0">
              <InlineImageUploader
                label="Store logo"
                hint="Square"
                currentUrl={form.logo_url}
                onUpload={(url) => updateField("logo_url", url)}
                onClear={() => updateField("logo_url", "")}
                aspectClass="aspect-square"
                shape="circle"
                merchantId={merchantId}
                bucket="merchant-images"
                storagePath={`${merchantId}/logo.webp`}
                preset="logo"
              />
            </div>
            <p className="pt-8 text-xs leading-relaxed text-muted-foreground">
              Shown on the store listing card and in the customer app.
              <br />Min 200 × 200 px recommended.
            </p>
          </div>
        )}
      </section>

      {/* ── Card Theme ── */}
      <section className="glass-strong rounded-3xl p-6 space-y-6">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-2xl text-ink">Card Theme</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Customise how your loyalty card appears to customers in their home screen.
        </p>

        {/* Theme color */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Card color</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {["#1A1A1A", "#1B5E3B", "#3E2723", "#B71C1C", "#1A237E", "#D4AF37", "#F5E6D0"].map((c) => (
                <button
                  key={c}
                  onClick={() => updateField("store_theme_color", c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    form.store_theme_color === c ? "border-ink scale-110" : "border-transparent"
                  }`}
                  style={{ background: c }}
                  aria-label={`Theme ${c}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.store_theme_color || "#1A1A1A"}
                onChange={(e) => updateField("store_theme_color", e.target.value)}
                className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent"
              />
              <input
                value={form.store_theme_color}
                onChange={(e) => updateField("store_theme_color", e.target.value)}
                placeholder="#1A1A1A"
                className="h-9 w-28 rounded-xl bg-mist px-3 text-xs text-ink outline-none focus:ring-2 focus:ring-ember/40 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Text color */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Text color</p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {["#FFFFFF", "#1A1A1A", "#F5E6D0", "#D4AF37", "#9FA8DA"].map((c) => (
                <button
                  key={c}
                  onClick={() => updateField("card_text_color", c)}
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    form.card_text_color === c ? "border-ink scale-110" : "border-border"
                  }`}
                  style={{ background: c }}
                  aria-label={`Text color ${c}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.card_text_color || "#FFFFFF"}
                onChange={(e) => updateField("card_text_color", e.target.value)}
                className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent"
              />
              <input
                value={form.card_text_color}
                onChange={(e) => updateField("card_text_color", e.target.value)}
                placeholder="#FFFFFF"
                className="h-9 w-28 rounded-xl bg-mist px-3 text-xs text-ink outline-none focus:ring-2 focus:ring-ember/40 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Background image */}
        {merchantId && (
          <InlineImageUploader
            label="Card background image"
            hint="Adds texture to your loyalty card. Recommended 800 × 400 px."
            currentUrl={form.card_background_image}
            onUpload={(url) => updateField("card_background_image", url)}
            onClear={() => updateField("card_background_image", "")}
            aspectClass="aspect-[2/1]"
            shape="square"
            merchantId={merchantId}
            bucket="merchant-images"
            storagePath={`${merchantId}/card-bg.webp`}
            preset="banner"
          />
        )}

        {/* Live card preview */}
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Preview</p>
          <div
            className="relative overflow-hidden rounded-3xl p-5"
            style={{
              background: form.card_background_image
                ? `linear-gradient(145deg, ${form.store_theme_color || "#1A1A1A"}ee, ${form.store_theme_color || "#2C2C2C"}dd), url(${form.card_background_image})`
                : `linear-gradient(145deg, ${form.store_theme_color || "#1A1A1A"}, ${form.store_theme_color || "#2C2C2C"}cc)`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: form.card_text_color || "#FFFFFF",
              minHeight: 180,
            }}
          >
            {form.card_background_image && (
              <img
                src={form.card_background_image}
                alt=""
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
              />
            )}
            <div className="relative">
              <div className="flex items-center gap-3">
                {form.logo_url && (
                  <img src={form.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
                )}
                <div>
                  <p className="text-[9px] uppercase tracking-[0.22em] opacity-50">Membership</p>
                  <p className="font-display text-xl">{form.business_name || "Your Store"}</p>
                </div>
              </div>
              <p className="font-display mt-4 text-4xl leading-none">2,450</p>
              <p className="mt-1 text-[10px] opacity-50">Available Points</p>
              <p className="mt-3 text-right text-[8px] opacity-30">Powered by Zentro</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Live preview card ── */}
      {(form.logo_url || form.banner_url || form.business_name) && (
        <section className="glass-strong overflow-hidden rounded-3xl">
          <p className="px-5 pt-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Preview</p>
          <div
            className="relative h-28 bg-gradient-to-br from-ember/40 via-ember-soft to-mist"
            style={
              form.banner_url
                ? { backgroundImage: `url(${form.banner_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                : undefined
            }
          />
          <div className="relative px-5 pb-5">
            <div className="-mt-8 flex items-end gap-3">
              <div
                className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-ink text-3xl text-primary-foreground shadow-soft"
                style={
                  form.logo_url
                    ? { backgroundImage: `url(${form.logo_url})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined
                }
              >
                {!form.logo_url && "☕"}
              </div>
              <div className="pb-1">
                <p className="font-display text-lg text-ink">{form.business_name || "Your store name"}</p>
                <p className="text-xs text-muted-foreground">{form.business_type || "Café"}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Details ── */}
      <section className="glass-strong rounded-3xl p-6">
        <h2 className="font-display text-2xl text-ink">Details</h2>
        <div className="mt-5 space-y-4">
          <Field
            label="Business name"
            value={form.business_name}
            onChange={(v) => updateField("business_name", v)}
          />
          <Field
            label="Tagline / Description"
            value={form.description}
            onChange={(v) => updateField("description", v)}
            multiline
          />
          <Field
            label="Category"
            value={form.business_type}
            onChange={(v) => updateField("business_type", v)}
            placeholder="e.g. Café · Bakery"
          />
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Offers category (how customers find you)
            </span>
            <select
              value={form.primary_category}
              onChange={(e) => updateField("primary_category", e.target.value)}
              className="mt-1.5 h-12 w-full rounded-2xl bg-mist px-4 text-sm text-ink outline-none transition-all focus:ring-2 focus:ring-ember/40"
            >
              <option value="">Not set</option>
              {categoryOptions.map((group) => (
                <optgroup key={group.slug} label={`${group.icon} ${group.name}`}>
                  {group.children.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ── Location + Hours ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="glass-strong rounded-3xl p-6">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> Location
          </div>
          <div className="mt-3 space-y-3">
            <Field
              label="Address"
              value={form.address}
              onChange={(v) => updateField("address", v)}
              placeholder="42 Thamel Street, Kathmandu"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="City" value={form.city} onChange={(v) => updateField("city", v)} placeholder="Kathmandu" />
              <Field label="Area" value={form.area} onChange={(v) => updateField("area", v)} placeholder="Thamel" />
            </div>
            <Field
              label="Phone"
              value={form.phone}
              onChange={(v) => updateField("phone", v)}
              placeholder="+977 98-0000-0000"
            />
          </div>
        </section>
        <section className="glass-strong rounded-3xl p-6">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Hours
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ["Mon – Fri", "7:00 – 18:00"],
              ["Saturday", "8:00 – 19:00"],
              ["Sunday", "8:00 – 16:00"],
            ].map(([d, h]) => (
              <li key={d} className="flex items-center justify-between">
                <span className="text-muted-foreground">{d}</span>
                <span className="text-ink">{h}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] italic text-muted-foreground">Hours editing coming soon</p>
        </section>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Save button */}
      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" /> Saved!
          </span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-sm font-medium text-primary-foreground shadow-ember transition-all disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({
  label, value, onChange, placeholder, multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="mt-1.5 w-full resize-none rounded-2xl bg-mist px-4 py-3 text-sm text-ink outline-none transition-all focus:ring-2 focus:ring-ember/40"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1.5 h-12 w-full rounded-2xl bg-mist px-4 text-sm text-ink outline-none transition-all focus:ring-2 focus:ring-ember/40"
        />
      )}
    </label>
  );
}
