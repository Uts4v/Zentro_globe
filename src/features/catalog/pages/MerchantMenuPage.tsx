import { useState, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Star,
  X,
  Check,
  Loader2,
  ImageIcon,
  Upload,
  FileType,
  ArrowRight,
  Layers,
} from "lucide-react";
import {
  menuApi,
  merchantApi,
  type MenuItem,
  type MenuCategory,
  type MenuItemInput,
} from "@/lib/api";
import { optimizeImage } from "@/lib/image-optimize";
import { uploadImage } from "@/lib/image-upload";
import { usePreparationAreas, usePreparationSettings } from "@/features/preparation/hooks";
import { OptionGroupsEditor } from "@/features/catalog/components/OptionGroupsEditor";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";

const EMPTY_FORM = {
  name: "",
  description: "",
  short_description: "",
  price: "",
  discount_type: "none" as "none" | "percentage" | "fixed",
  discount_value: "",
  discount_source: "manual" as "manual" | "special",
  category: "",
  category_ref: "" as string,
  dietary_tags: "",
  allergens: "",
  status: "active",
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

function errMessage(e: unknown): string {
  return (e as { message?: string }).message || "Something went wrong.";
}

export function MerchantMenuPage() {
  const isClient = typeof window !== "undefined";

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
  const [categories, setCategories] = useState<MenuCategory[]>([]);

  const [optionItem, setOptionItem] = useState<MenuItem | null>(null);

  const [imgState, setImgState] = useState<ImgStatus>({ status: "idle" });
  const imgInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const { data: prepSettings } = usePreparationSettings();
  const { data: prepAreas = [] } = usePreparationAreas();
  const showPrepFields = prepSettings?.preparation_routing_enabled && prepAreas.length > 0;
  const { merchantProfile } = useAuth();
  const currencySymbol = merchantProfile?.currency_symbol || "Rs";

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [itemsData, merchantData, catData] = await Promise.all([
        menuApi.myItems(),
        merchantApi.me(),
        menuApi.categories().catch(() => [] as MenuCategory[]),
      ]);
      setItems(itemsData);
      setMerchantId(merchantData.id);
      setCategories(catData);
    } catch (e: unknown) {
      setError(errMessage(e));
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
      short_description: item.short_description ?? "",
      price: item.price,
      discount_type: item.discount_type ?? "none",
      discount_value: item.discount_value ?? "",
      discount_source: item.discount_source ?? "manual",
      category: item.category,
      category_ref: item.category_ref != null ? String(item.category_ref) : "",
      dietary_tags: (item.dietary_tags ?? []).join(", "),
      allergens: (item.allergens ?? []).join(", "),
      status: item.status ?? "active",
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
      item.image_url ? { status: "done", previewUrl: item.image_url } : { status: "idle" },
    );
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setImgState({ status: "idle" });
  }

  const [showLayout, setShowLayout] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatEmoji, setNewCatEmoji] = useState("🍽️");

  function openLayoutManager() {
    setShowLayout(true);
    menuApi
      .categories()
      .then(setCategories)
      .catch(() => {});
  }

  const sortedCats = [...categories].sort((a, b) => a.display_order - b.display_order);

  useEffect(() => {
    if (!showForm) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showForm]);

  useEffect(() => {
    if (!showLayout) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowLayout(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [showLayout]);

  async function createCat() {
    if (!newCatName.trim()) return;
    try {
      const created = await menuApi.createCategory({
        name: newCatName.trim(),
        emoji: newCatEmoji || "🍽️",
      });
      setCategories((prev) => [...prev, created]);
      setNewCatName("");
      setNewCatEmoji("🍽️");
    } catch (e: unknown) {
      setError(errMessage(e));
    }
  }

  async function deleteCat(cat: MenuCategory) {
    if (cat.item_count > 0) {
      setError("Move items out of this section before deleting it.");
      return;
    }
    if (!confirm(`Delete section "${cat.name}"?`)) return;
    try {
      await menuApi.deleteCategory(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch (e: unknown) {
      setError(errMessage(e));
    }
  }

  async function moveCat(index: number, dir: number) {
    const next = [...sortedCats];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    try {
      await menuApi.reorderCategories(next.map((c) => Number(c.id)));
      setCategories(await menuApi.categories());
    } catch (e: unknown) {
      setError(errMessage(e));
    }
  }

  async function handleImageFile(file: File) {
    if (!merchantId) return;
    setImgState({ status: "processing" });
    let optimized;
    try {
      optimized = await optimizeImage(file, "product");
    } catch (err: unknown) {
      setImgState({ status: "error", error: errMessage(err) });
      return;
    }
    setImgState({ status: "uploading", previewUrl: optimized.previewUrl });
    try {
      const productKey = editing?.id ?? `tmp-${Date.now()}`;
      const { publicUrl } = await uploadImage(
        file,
        "product",
        "product-images",
        `${merchantId}/${productKey}.webp`,
      );
      setForm((f) => ({ ...f, image_url: publicUrl }));
      setImgState({ status: "done", previewUrl: optimized.previewUrl });
    } catch (err: unknown) {
      setImgState({ status: "error", error: errMessage(err) });
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
      const payload: Partial<MenuItemInput> = {
        ...form,
        price: form.price,
        points_per_item: Number(form.points_per_item),
        preparation_area: form.preparation_area ? Number(form.preparation_area) : null,
        requires_preparation: form.requires_preparation,
        category_ref: form.category_ref ? Number(form.category_ref) : null,
        dietary_tags: form.dietary_tags
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean),
        allergens: form.allergens
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean),
        short_description: form.short_description,
        status: form.status as MenuItemInput["status"],
        discount_source: undefined,
        discount_type: form.discount_type,
        discount_value:
          form.discount_type === "none" || !form.discount_value ? null : form.discount_value,
      };
      if (editing) {
        await menuApi.update(editing.id, payload);
      } else {
        await menuApi.create(payload);
      }
      await loadAll();
      closeForm();
    } catch (e: unknown) {
      setError(errMessage(e));
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
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggle(id: string) {
    setToggling(id);
    try {
      const updated = await menuApi.toggleAvailability(id);
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setToggling(null);
    }
  }

  const catFilters = ["All", ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))];
  const visible = filterCat === "All" ? items : items.filter((i) => i.category === filterCat);

  const grouped = Array.from(
    visible
      .reduce((map, item) => {
        const key = item.category || "Uncategorized";
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(item);
        return map;
      }, new Map<string, MenuItem[]>())
      .entries(),
  );

  const imgUploading = imgState.status === "processing" || imgState.status === "uploading";
  const imgPreviewUrl =
    imgState.status === "uploading" || imgState.status === "done"
      ? imgState.previewUrl
      : form.image_url || null;

  if (!isClient) return null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Manage</p>
          <h1 className="font-display mt-1 text-3xl sm:text-4xl text-foreground">Menu</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={openLayoutManager}
            className="h-11 rounded-2xl text-muted-foreground"
          >
            <Layers className="h-4 w-4" /> Layout
          </Button>
          <Button onClick={openCreate} className="h-11 rounded-2xl px-5">
            <Plus className="h-4 w-4" /> Add item
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button onClick={() => setError("")} className="ml-3 underline">
            Dismiss
          </button>
        </div>
      )}

      <Link
        to="/merchant/pdf-menu"
        className="group flex items-center gap-3 rounded-2xl border border-border bg-gradient-to-r from-ember/10 via-ember/5 to-transparent px-4 py-3 transition-colors hover:border-ember/30"
      >
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ember/15 text-ember">
          <FileType className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Give customers your menu as a PDF</p>
          <p className="text-xs text-muted-foreground">
            Upload a PDF and get a QR code your customers can scan — no app needed.
          </p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>

      {catFilters.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
          {catFilters.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCat(cat)}
              role="tab"
              aria-selected={filterCat === cat}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                filterCat === cat
                  ? "bg-ink text-primary-foreground"
                  : "bg-mist text-foreground hover:bg-ink/10"
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
            <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {label}
            </p>
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
            {filterCat === "All"
              ? "No items yet — add your first one."
              : `No items in "${filterCat}".`}
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${catClass(cat)}`}
                  >
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
                      onOptions={() => setOptionItem(item)}
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
                  onOptions={() => setOptionItem(item)}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-item-dialog-title"
            className="glass-strong w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 id="menu-item-dialog-title" className="font-display text-2xl text-foreground">
                {editing ? "Edit item" : "New item"}
              </h2>
              <button
                onClick={closeForm}
                aria-label="Close dialog"
                className="grid h-10 w-10 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              {/* Product image upload */}
              <div>
                <p className="mb-1.5 text-xs uppercase tracking-widest text-muted-foreground">
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
                      <p className="text-xs text-muted-foreground/60">
                        JPG · PNG · WebP · max 5 MB
                      </p>
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
                      aria-label="Remove image"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearImage();
                      }}
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
                      className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-ink hover:text-foreground"
                    >
                      <Upload className="h-3 w-3" /> Change
                    </button>
                  )}
                </div>
              </div>

              {/* Emoji + Name */}
              <div className="flex gap-3">
                <div className="shrink-0">
                  <label
                    htmlFor="menu-item-emoji"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Emoji
                  </label>
                  <input
                    id="menu-item-emoji"
                    value={form.emoji}
                    onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                    className="h-11 w-16 rounded-xl border border-border bg-muted text-center text-xl focus:outline-none focus:ring-2 focus:ring-ink/20"
                    maxLength={2}
                  />
                </div>
                <div className="flex-1">
                  <label
                    htmlFor="menu-item-name"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Name *
                  </label>
                  <input
                    id="menu-item-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Flat white"
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="menu-item-description"
                  className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                >
                  Description
                </label>
                <textarea
                  id="menu-item-description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="A short description…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>

              {/* Short description (menu cards) */}
              <div>
                <label
                  htmlFor="menu-item-short-description"
                  className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                >
                  Menu card blurb (optional)
                </label>
                <textarea
                  id="menu-item-short-description"
                  value={form.short_description}
                  onChange={(e) => setForm((f) => ({ ...f, short_description: e.target.value }))}
                  placeholder="One line for the menu grid, e.g. “Double ristretto over silky milk.”"
                  rows={1}
                  maxLength={200}
                  className="w-full resize-none rounded-xl border border-border bg-muted px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
              </div>

              {/* Price + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="menu-item-price"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Price ({currencySymbol}) *
                  </label>
                  <input
                    id="menu-item-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="350.00"
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Set to 0 for free / comp items (e.g. staff food)
                  </p>
                </div>
                <div>
                  <label
                    htmlFor="menu-item-section"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Section
                  </label>
                  <select
                    id="menu-item-section"
                    value={form.category_ref || "__new"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__new") return;
                      const cat = categories.find((c) => String(c.id) === v);
                      setForm((f) => ({
                        ...f,
                        category_ref: v,
                        category: cat ? cat.name : f.category,
                      }));
                    }}
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.emoji} {c.name}
                      </option>
                    ))}
                    <option value="__new">New section…</option>
                  </select>
                  {!form.category_ref && (
                    <input
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                      placeholder="New section name (Coffee, Tea…)"
                      aria-label="New section name"
                      className="mt-1.5 h-9 w-full rounded-xl border border-border bg-muted px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                    />
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick a section or type a new one.
                  </p>
                </div>
              </div>

              {/* Discount */}
              <div>
                <label
                  htmlFor="menu-item-discount-type"
                  className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                >
                  Discount
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    id="menu-item-discount-type"
                    value={form.discount_type}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        discount_type: e.target.value as FormState["discount_type"],
                        discount_value: e.target.value === "none" ? "" : f.discount_value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    <option value="none">No discount</option>
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed amount ({currencySymbol})</option>
                  </select>
                  <input
                    id="menu-item-discount-value"
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={form.discount_type === "none"}
                    value={form.discount_value}
                    onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                    placeholder={form.discount_type === "percentage" ? "10" : "50.00"}
                    aria-label="Discount value"
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20 disabled:opacity-40"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {form.discount_source === "special"
                    ? "Managed by an active Today's Special — editing it will switch to a manual discount."
                    : "Applies to the base price; variants keep their own price."}
                </p>
              </div>

              {/* Dietary + allergens */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="menu-item-dietary"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Dietary tags
                  </label>
                  <input
                    id="menu-item-dietary"
                    value={form.dietary_tags}
                    onChange={(e) => setForm((f) => ({ ...f, dietary_tags: e.target.value }))}
                    placeholder="Vegan, Gluten-free…"
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Comma separated</p>
                </div>
                <div>
                  <label
                    htmlFor="menu-item-allergens"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Allergens
                  </label>
                  <input
                    id="menu-item-allergens"
                    value={form.allergens}
                    onChange={(e) => setForm((f) => ({ ...f, allergens: e.target.value }))}
                    placeholder="Milk, Nuts…"
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Comma separated</p>
                </div>
              </div>

              {/* Points */}
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[10rem] flex-1">
                  <label
                    htmlFor="menu-item-points"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Points per item
                  </label>
                  <input
                    id="menu-item-points"
                    type="number"
                    min="0"
                    value={form.points_per_item}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, points_per_item: Number(e.target.value) }))
                    }
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
                <div className="min-w-[10rem] flex-1">
                  <label
                    htmlFor="menu-item-status"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Status
                  </label>
                  <select
                    id="menu-item-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Draft hides from customers; archived hides everywhere.
                  </p>
                </div>
              </div>

              {/* Preparation Area (only shown when routing is enabled) */}
              {showPrepFields && (
                <div className="space-y-2">
                  <label
                    htmlFor="menu-item-prep-area"
                    className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Preparation Area
                  </label>
                  <select
                    id="menu-item-prep-area"
                    value={form.preparation_area}
                    onChange={(e) => setForm((f) => ({ ...f, preparation_area: e.target.value }))}
                    className="h-11 w-full rounded-xl border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    <option value="">No specific area</option>
                    {prepAreas
                      .filter((a) => a.is_active)
                      .map((area) => (
                        <option key={area.id} value={String(area.id)}>
                          {area.name}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.requires_preparation}
                    onClick={() =>
                      setForm((f) => ({ ...f, requires_preparation: !f.requires_preparation }))
                    }
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                      form.requires_preparation
                        ? "border-ink bg-ink text-primary-foreground"
                        : "border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {form.requires_preparation ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    Requires preparation
                  </button>
                </div>
              )}

              {/* Toggles */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    ["loyalty_reward", "Earns points"],
                    ["is_available", "Available"],
                    ["is_featured", "Featured"],
                  ] as [
                    keyof FormState & ("loyalty_reward" | "is_available" | "is_featured"),
                    string,
                  ][]
                ).map(([key, label]) => {
                  const on = Boolean(form[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={label}
                      onClick={() => setForm((f) => ({ ...f, [key]: !f[key] }))}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-colors ${
                        on
                          ? "border-ink bg-ink text-primary-foreground"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                onClick={closeForm}
                className="h-11 flex-1 rounded-2xl text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || imgUploading || !form.name.trim() || !form.price}
                className="h-11 flex-1 rounded-2xl"
              >
                {(saving || imgUploading) && <Loader2 className="h-4 w-4 animate-spin" />}
                {imgUploading
                  ? "Uploading image…"
                  : saving
                    ? "Saving…"
                    : editing
                      ? "Save changes"
                      : "Add item"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Option groups editor */}
      {optionItem && (
        <OptionGroupsEditor
          itemId={optionItem.id}
          itemName={optionItem.name}
          currencySymbol={currencySymbol}
          onClose={() => setOptionItem(null)}
          onChanged={() => loadAll()}
        />
      )}

      {/* Layout manager */}
      {showLayout && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
          onClick={(e) => e.target === e.currentTarget && setShowLayout(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-layout-dialog-title"
            className="glass-strong w-full max-w-lg rounded-t-3xl p-6 sm:rounded-3xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 id="menu-layout-dialog-title" className="font-display text-2xl text-foreground">
                  Menu layout
                </h2>
                <p className="text-xs text-muted-foreground">
                  Reorder sections — customers see them in this order.
                </p>
              </div>
              <button
                onClick={() => setShowLayout(false)}
                aria-label="Close dialog"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {categories.length === 0 && (
                <p className="rounded-2xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
                  No sections yet. Categories are created automatically as you write a category on
                  an item, or add one below.
                </p>
              )}
              {[...categories]
                .sort((a, b) => a.display_order - b.display_order)
                .map((c, i) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted px-3 py-2.5"
                  >
                    <span className="text-lg">{c.emoji}</span>
                    <span className="text-sm font-medium text-foreground">{c.name}</span>
                    <span className="rounded-full bg-mist px-2 py-0.5 text-xs text-muted-foreground">
                      {c.item_count} items
                    </span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        disabled={i === 0}
                        onClick={() => moveCat(i, -1)}
                        aria-label={`Move ${c.name} up`}
                        className="grid h-10 w-10 place-items-center rounded-lg bg-mist text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        disabled={i === categories.length - 1}
                        onClick={() => moveCat(i, 1)}
                        aria-label={`Move ${c.name} down`}
                        className="grid h-10 w-10 place-items-center rounded-lg bg-mist text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => setNewCatName(c.name)}
                        aria-label={`Rename ${c.name}`}
                        className="grid h-10 w-10 place-items-center rounded-lg bg-mist text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        disabled={c.item_count > 0}
                        onClick={() => deleteCat(c)}
                        aria-label={`Delete ${c.name}`}
                        className="grid h-10 w-10 place-items-center rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="New section name (e.g. Pastries)"
                aria-label="New section name"
                className="h-11 min-w-[10rem] flex-1 rounded-2xl bg-mist px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
              />
              <input
                value={newCatEmoji}
                onChange={(e) => setNewCatEmoji(e.target.value)}
                aria-label="Section emoji"
                className="h-11 w-14 rounded-2xl bg-mist text-center text-lg outline-none focus:ring-2 focus:ring-ember/40"
                maxLength={4}
              />
              <Button
                onClick={createCat}
                disabled={!newCatName.trim()}
                className="h-11 rounded-2xl px-4"
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({
  item,
  onEdit,
  onDelete,
  onToggle,
  onOptions,
  deleting,
  toggling,
  catClass,
}: {
  item: MenuItem;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onOptions: () => void;
  deleting: boolean;
  toggling: boolean;
  catClass: string;
}) {
  const { merchantProfile } = useAuth();
  const currencySymbol = merchantProfile?.currency_symbol || "Rs";
  return (
    <article
      className={`glass-strong cv-auto overflow-hidden rounded-3xl transition-opacity ${!item.is_available ? "opacity-60" : ""}`}
    >
      {item.image_url ? (
        <div className="h-40 w-full overflow-hidden">
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex h-40 w-full items-center justify-center bg-mist text-5xl">
          {item.emoji}
        </div>
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
                <span
                  className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${catClass}`}
                >
                  {item.category}
                </span>
              )}
            </div>
          </div>
          <p className="font-display shrink-0 text-xl text-foreground">
            {Number(item.price) === 0 ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-bold text-emerald-700">
                FREE
              </span>
            ) : (
              formatCurrency(item.price, currencySymbol)
            )}
          </p>
        </div>
        {item.description && (
          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {item.discount_type && item.discount_type !== "none" && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              {item.discount_type === "percentage"
                ? `-${Number(item.discount_value)}%`
                : `-${formatCurrency(item.discount_value ?? "0", currencySymbol)}`}
              {item.discount_source === "special" ? " · Special" : ""}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.loyalty_reward ? "bg-emerald-100 text-emerald-700" : "bg-mist text-muted-foreground"}`}
          >
            {item.loyalty_reward ? `+${item.points_per_item} pts` : "No points"}
          </span>
          {(item.groups?.length ?? 0) > 0 && (
            <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-700">
              {(item.groups ?? []).map((g) => g.options.length).reduce((a, b) => a + b, 0)} options
            </span>
          )}
          <span className="ml-auto" />
          <button
            onClick={onOptions}
            title="Variants & modifiers"
            aria-label="Variants & modifiers"
            className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700 transition-colors hover:bg-teal-100"
          >
            <Layers className="h-4 w-4" />
          </button>
          <button
            onClick={onToggle}
            disabled={toggling}
            title={item.is_available ? "Mark unavailable" : "Mark available"}
            aria-label={item.is_available ? "Mark unavailable" : "Mark available"}
            className="grid h-10 w-10 place-items-center rounded-xl bg-mist text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : item.is_available ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={onEdit}
            aria-label="Edit item"
            className="grid h-10 w-10 place-items-center rounded-xl bg-mist text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete item"
            className="grid h-10 w-10 place-items-center rounded-xl bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
