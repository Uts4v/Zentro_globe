import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, Eye, EyeOff, Star, X, Check, Loader2, ImageIcon, Upload } from "lucide-react";
import { menuApi, merchantApi, type MenuItem } from "@/lib/api";
import { optimizeImage } from "@/lib/image-optimize";
import { uploadImage } from "@/lib/image-upload";
import { usePreparationAreas, usePreparationSettings } from "@/features/preparation/hooks";

const EMPTY_FORM = {
  name: "",
  description: "",
  price: "",
  category: "",
  emoji: "☕",
  points_per_item: 1,
  loyalty_reward: true,
  is_available: true,
  is_featured: false,
  image_url: "",
  preparation_area: "" as string,
  requires_preparation: true,
};

type FormState = typeof EMPTY_FORM;

type ImgStatus =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "uploading"; previewUrl: string }
  | { status: "done"; previewUrl: string }
  | { status: "error"; error: string };

const CAT_COLOURS: Record<string, string> = {
  Coffee: "bg-amber-100 text-amber-800",
  Tea: "bg-emerald-100 text-emerald-800",
  Food: "bg-rose-100 text-rose-800",
  Snacks: "bg-orange-100 text-orange-800",
  Drinks: "bg-sky-100 text-sky-800",
};

function catClass(cat: string) {
  return CAT_COLOURS[cat] ?? "bg-mist text-foreground";
}

export function MerchantMenuPage() {
  if (typeof window === "undefined") return null;

  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [merchantId, setMerchantId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("All");

  const [imgState, setImgState] = useState<ImgStatus>({ status: "idle" });
  const imgInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { data: prepSettings } = usePreparationSettings();
  const { data: prepAreas = [] } = usePreparationAreas();
  const showPrepFields = prepSettings?.preparation_routing_enabled && prepAreas.length > 0;

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [itemsData, merchantData] = await Promise.all([
        menuApi.myItems(),
        merchantApi.me(),
      ]);
      setItems(itemsData);
      setMerchantId(merchantData.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImgState({ status: "idle" });
    setShowForm(true);
  }

  function openEdit(item: MenuItem) {
    setEditing(item);
    setForm({
      name: item.name,
      description: item.description,
      price: item.price,
      category: item.category,
      emoji: item.emoji,
      points_per_item: item.points_per_item,
      loyalty_reward: item.loyalty_reward,
      is_available: item.is_available,
      is_featured: item.is_featured,
      image_url: item.image_url,
      preparation_area: item.preparation_area ? String(item.preparation_area) : "",
      requires_preparation: item.requires_preparation ?? true,
    });
    setImgState(
      item.image_url
        ? { status: "done", previewUrl: item.image_url }
        : { status: "idle" }
    );
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setImgState({ status: "idle" });
  }

  async function handleImageFile(file: File) {
    if (!merchantId) return;
    setImgState({ status: "processing" });
    let optimized;
    try {
      optimized = await optimizeImage(file, "product");
    } catch (err: any) {
      setImgState({ status: "error", error: err.message ?? "Could not process image." });
      return;
    }
    setImgState({ status: "uploading", previewUrl: optimized.previewUrl });
    try {
      const productKey = editing?.id ?? `tmp-${Date.now()}`;
      const { publicUrl } = await uploadImage(
        file, "product", "product-images", `${merchantId}/${productKey}.webp`
      );
      setForm((f) => ({ ...f, image_url: publicUrl }));
      setImgState({ status: "done", previewUrl: optimized.previewUrl });
    } catch (err: any) {
      setImgState({ status: "error", error: err.message ?? "Upload failed." });
    }
  }

  function handleImgInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleImageFile(file);
    e.target.value = "";
  }

  function handleImgDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleImageFile(file);
  }

  function clearImage() {
    setForm((f) => ({ ...f, image_url: "" }));
    setImgState({ status: "idle" });
  }

  async function handleSave() {
    if (!form.name.trim() || !form.price) return;
    const imgUploading = imgState.status === "uploading" || imgState.status === "processing";
    if (imgUploading) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        price: form.price,
        points_per_item: Number(form.points_per_item),
        preparation_area: form.preparation_area ? Number(form.preparation_area) : null,
        requires_preparation: form.requires_preparation,
      };
      if (editing) {
        const updated = await menuApi.update(editing.id, payload);
        setItems((prev) => prev.map((i) => (i.id === editing.id ? updated : i)));
      } else {
        const created = await menuApi.create(payload);
        setItems((prev) => [created, ...prev]);
      }
      closeForm();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await menuApi.delete(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(id: string) {
    setToggling(id);
    try {
      const updated = await menuApi.toggleAvailability(id);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setToggling(null);
    }
  }

  const categories = ["All", ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))];
  const visible = filterCat === "All" ? items : items.filter((i) => i.category === filterCat);

  const grouped = Array.from(
    visible.reduce((map, item) => {
      const key = item.category || "Uncategorized";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
      return map;
    }, new Map<string, MenuItem[]>()).entries()
  );

  const imgUploading = imgState.status === "processing" || imgState.status === "uploading";
  const imgPreviewUrl =
    imgState.status === "uploading" || imgState.status === "done"
      ? imgState.previewUrl
      : form.image_url || null;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Manage</p>
          <h1 className="font-display mt-1 text-5xl text-foreground">Menu</h1>
        </div>
        <button
          onClick={openCreate}
          className="gradient-ember inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-sm font-medium text-white transition-transform active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">Dismiss</button>
        </div>
      )}

      {categories.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${filterCat === cat ? "bg-ink text-primary-foreground" : "bg-mist text-foreground hover:bg-ink/10"
                }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total items", value: items.length },
          { label: "Available", value: items.filter((i) => i.is_available).length },
          { label: "Featured", value: items.filter((i) => i.is_featured).length },
        ].map(({ label, value }) => (
          <div key={label} className="glass rounded-2xl p-4 text-center">
            <p className="font-display text-3xl text-foreground">{value}</p>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : visible.length === 0 ? (
        <div className="glass rounded-3xl py-16 text-center">
          <p className="text-4xl">🍵</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {filterCat === "All" ? "No items yet — add your first one." : `No items in "${filterCat}".`}
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {filterCat === "All" ? (
            grouped.map(([cat, catItems]) => (
              <section key={cat}>
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="font-display text-2xl text-foreground">{cat}</h2>
                  <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {catItems.length}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${catClass(cat)}`}>
                    {cat}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {catItems.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onEdit={() => openEdit(item)}
                      onDelete={() => handleDelete(item.id)}
                      onToggle={() => handleToggle(item.id)}
                      deleting={deleting === item.id}
                      toggling={toggling === item.id}
                      catClass={catClass(item.category)}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onEdit={() => openEdit(item)}
                  onDelete={() => handleDelete(item.id)}
                  onToggle={() => handleToggle(item.id)}
                  deleting={deleting === item.id}
                  toggling={toggling === item.id}
                  catClass={catClass(item.category)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && closeForm()}
        >
          <div
            ref={dialogRef}
            className="glass-strong w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-display text-2xl text-foreground">
                {editing ? "Edit item" : "New item"}
              </h2>
              <button
                onClick={closeForm}
                className="grid h-8 w-8 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">

              {/* Product image upload */}
              <div>
                <p className="mb-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                  Product image
                </p>
                <input
                  ref={imgInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={handleImgInputChange}
                  disabled={imgUploading}
                />
                {/* Drop zone — square */}
                <div
                  className={`relative aspect-square w-full cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-colors
                    ${imgUploading ? "cursor-wait" : "hover:border-ink/40"}
                    ${imgState.status === "error" ? "border-rose-400" : ""}
                    ${imgState.status === "done" ? "border-emerald-400" : "border-border"}
                  `}
                  onClick={() => !imgUploading && imgInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImgDrop}
                >
                  {imgPreviewUrl ? (
                    <img src={imgPreviewUrl} alt="Preview" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 bg-mist">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">Click or drag image here</p>
                      <p className="text-[10px] text-muted-foreground/60">JPG · PNG · WebP · max 5 MB</p>
                    </div>
                  )}

                  {/* Processing / uploading overlay */}
                  {imgUploading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50">
                      <Loader2 className="h-8 w-8 animate-spin text-white" />
                      <p className="text-xs font-medium text-white">
                        {imgState.status === "processing" ? "Optimising…" : "Uploading…"}
                      </p>
                    </div>
                  )}

                  {/* Done badge */}
                  {imgState.status === "done" && (
                    <div className="absolute bottom-2 right-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 shadow">
                        <Check className="h-4 w-4 text-white" />
                      </span>
                    </div>
                  )}

                  {/* Clear ✕ */}
                  {imgPreviewUrl && !imgUploading && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); clearImage(); }}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Status + change button */}
                <div className="mt-1.5 flex min-h-[18px] items-center justify-between">
                  {imgState.status === "error" && (
                    <p className="text-xs text-rose-500">{imgState.error}</p>
                  )}
                  {imgState.status === "done" && (
                    <p className="text-xs text-emerald-600">Image saved ✓</p>
                  )}
                  {imgPreviewUrl && !imgUploading && (
                    <button
                      type="button"
                      onClick={() => imgInputRef.current?.click()}
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground hover:border-ink hover:text-foreground"
                    >
                      <Upload className="h-3 w-3" /> Change
                    </button>
                  )}
                </div>
              </div>

              {/* Emoji + Name */}
              <div className="flex gap-3">
                <div className="shrink-0">
                  <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Emoji</label>
                  <input
                    value={form.emoji}
                    onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                    className="h-11 w-16 rounded-xl border border-border bg-white/50 text-center text-xl focus:outline-none focus:ring-2 focus:ring-ink/20"
                    maxLength={2}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Name *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Flat white"
                    className="h-11 w-full rounded-xl border border-border bg-white/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="A short description…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-white/50 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>

              {/* Price + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Price (NPR) *</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="350.00"
                    className="h-11 w-full rounded-xl border border-border bg-white/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Category</label>
                  <input
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="Coffee, Tea, Food…"
                    list="cats"
                    className="h-11 w-full rounded-xl border border-border bg-white/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                  <datalist id="cats">
                    {["Coffee", "Tea", "Food", "Snacks", "Drinks"].map((c) => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              {/* Points */}
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Points per item</label>
                <input
                  type="number" min="0"
                  value={form.points_per_item}
                  onChange={(e) => setForm((f) => ({ ...f, points_per_item: Number(e.target.value) }))}
                  className="h-11 w-40 rounded-xl border border-border bg-white/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>

              {/* Preparation Area (only shown when routing is enabled) */}
              {showPrepFields && (
                <div className="space-y-2">
                  <label className="mb-1.5 block text-[11px] uppercase tracking-widest text-muted-foreground">Preparation Area</label>
                  <select
                    value={form.preparation_area}
                    onChange={(e) => setForm((f) => ({ ...f, preparation_area: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-border bg-white/50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    <option value="">No specific area</option>
                    {prepAreas.filter((a) => a.is_active).map((area) => (
                      <option key={area.id} value={String(area.id)}>{area.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, requires_preparation: !f.requires_preparation }))}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      form.requires_preparation
                        ? "border-ink bg-ink text-primary-foreground"
                        : "border-border bg-white/50 text-muted-foreground"
                    }`}
                  >
                    {form.requires_preparation ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    Requires preparation
                  </button>
                </div>
              )}

              {/* Toggles */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  ["loyalty_reward", "Earns points"],
                  ["is_available", "Available"],
                  ["is_featured", "Featured"],
                ] as [keyof FormState, string][]).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, [key]: !f[key as keyof FormState] }))}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-colors ${form[key as keyof FormState]
                        ? "border-ink bg-ink text-primary-foreground"
                        : "border-border bg-white/50 text-muted-foreground"
                      }`}
                  >
                    {form[key as keyof FormState] ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <button onClick={closeForm} className="h-11 flex-1 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || imgUploading || !form.name.trim() || !form.price}
                className="gradient-ember flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-medium text-white disabled:opacity-50"
              >
                {(saving || imgUploading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {imgUploading ? "Uploading image…" : saving ? "Saving…" : editing ? "Save changes" : "Add item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item, onEdit, onDelete, onToggle, deleting, toggling, catClass,
}: {
  item: MenuItem;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  deleting: boolean;
  toggling: boolean;
  catClass: string;
}) {
  return (
    <article className={`glass-strong cv-auto overflow-hidden rounded-3xl transition-opacity ${!item.is_available ? "opacity-60" : ""}`}>
      {item.image_url ? (
        <div className="h-40 w-full overflow-hidden">
          <img src={item.image_url} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
        </div>
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-mist text-5xl">{item.emoji}</div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            {item.image_url && <span className="text-xl">{item.emoji}</span>}
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="font-display text-lg leading-tight text-foreground">{item.name}</h3>
                {item.is_featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
              </div>
              {item.category && (
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${catClass}`}>
                  {item.category}
                </span>
              )}
            </div>
          </div>
          <p className="font-display shrink-0 text-xl text-foreground">NPR {Number(item.price).toLocaleString()}</p>
        </div>
        {item.description && (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
        )}
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${item.loyalty_reward ? "bg-emerald-100 text-emerald-700" : "bg-mist text-muted-foreground"}`}>
            {item.loyalty_reward ? `+${item.points_per_item} pts` : "No points"}
          </span>
          <span className="ml-auto" />
          <button onClick={onToggle} disabled={toggling} title={item.is_available ? "Mark unavailable" : "Mark available"} className="grid h-8 w-8 place-items-center rounded-xl bg-mist text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
            {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : item.is_available ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onEdit} className="grid h-8 w-8 place-items-center rounded-xl bg-mist text-muted-foreground transition-colors hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} disabled={deleting} className="grid h-8 w-8 place-items-center rounded-xl bg-rose-50 text-rose-400 transition-colors hover:bg-rose-100 hover:text-rose-600 disabled:opacity-50">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </article>
  );
}
