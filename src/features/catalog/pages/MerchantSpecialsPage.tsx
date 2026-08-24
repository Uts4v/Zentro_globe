import { useState, useEffect, useRef } from "react";
import {
  Plus, Pencil, Trash2, Loader2, X, Check,
  ImageIcon, Upload, Sparkles, Percent, Tag,
} from "lucide-react";
import { specialApi, menuApi, loyaltyApi, type TodaySpecial, type MenuItem, type Reward } from "@/lib/api";
import { uploadImage } from "@/lib/image-upload";
import { optimizeImage } from "@/lib/image-optimize";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export function MerchantSpecialsPage() {
  const { merchantProfile } = useAuth();
  const [specials, setSpecials] = useState<TodaySpecial[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | TodaySpecial | null>(null);

  useEffect(() => {
    Promise.all([
      specialApi.list(),
      menuApi.myItems(),
      loyaltyApi.getRewards(),
    ]).then(([s, m, r]) => {
      setSpecials(s);
      setMenuItems(m);
      setRewards(r);
    }).finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    await specialApi.delete(id);
    setSpecials((prev) => prev.filter((s) => s.id !== id));
    toast.success("Special deleted.");
  }

  async function handleToggle(special: TodaySpecial) {
    const updated = await specialApi.update(special.id, { is_active: !special.is_active });
    setSpecials((prev) => prev.map((s) => s.id === updated.id ? updated : s));
  }

  async function handleSave(data: Partial<TodaySpecial>) {
    if (typeof modal === "object" && modal !== null) {
      const updated = await specialApi.update(modal.id, data);
      setSpecials((prev) => prev.map((s) => s.id === updated.id ? updated : s));
      toast.success("Special updated.");
    } else {
      const created = await specialApi.create(data);
      setSpecials((prev) => [created, ...prev]);
      toast.success("Special created.");
    }
    setModal(null);
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Promotions</p>
          <h1 className="font-display mt-1 text-5xl text-foreground">Today's Special</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            A popup banner shown to customers when they first open your store page.
            Add multiple specials — customers can swipe through them all.
          </p>
        </div>
        <button
          onClick={() => setModal("new")}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> New special
        </button>
      </div>

      {specials.length === 0 ? (
        <div className="glass-strong flex flex-col items-center rounded-3xl py-16 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/30" />
          <p className="mt-4 text-sm font-medium text-foreground">No specials yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first banner to surprise customers.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {specials.map((s) => (
            <div
              key={s.id}
              className={`glass-strong overflow-hidden rounded-3xl transition-opacity ${
                s.is_active ? "" : "opacity-60"
              }`}
            >
              {s.image_url && (
                <img
                  src={s.image_url}
                  alt={s.title}
                  className="h-40 w-full object-cover"
                />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{s.title}</p>
                    {s.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    )}
                    {(s.linked_menu_item_name || s.linked_reward_name) && (
                      <p className="mt-2 text-[11px] text-ember">
                        Linked to: {s.linked_menu_item_name ?? s.linked_reward_name}
                      </p>
                    )}
                    {s.discount_type !== "none" && s.discount_value != null && (
                      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        <Tag className="h-3 w-3" />
                        {s.discount_type === "percentage"
                          ? `${s.discount_value}% off`
                          : `Rs. ${s.discount_value} off`}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconBtn onClick={() => setModal(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => handleDelete(s.id)} danger>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className={`text-xs ${s.is_active ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {s.is_active ? "Active — visible to customers" : "Inactive"}
                  </span>
                  <Toggle active={s.is_active} onToggle={() => handleToggle(s)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <SpecialModal
          initial={modal === "new" ? null : modal}
          menuItems={menuItems}
          rewards={rewards}
          merchantId={String(merchantProfile?.id ?? "")}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function SpecialModal({
  initial, menuItems, rewards, merchantId, onSave, onClose,
}: {
  initial: TodaySpecial | null;
  menuItems: MenuItem[];
  rewards: Reward[];
  merchantId: string;
  onSave: (data: Partial<TodaySpecial>) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDesc] = useState(initial?.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [linkedItem, setLinkedItem] = useState(initial?.linked_menu_item ?? "");
  const [linkedReward, setLinkedReward] = useState(initial?.linked_reward ?? "");
  const [discountType, setDiscountType] = useState<"none" | "percentage" | "fixed">(
    initial?.discount_type ?? "none"
  );
  const [discountValue, setDiscountValue] = useState(
    initial?.discount_value != null ? String(initial.discount_value) : ""
  );
  const [saving, setSaving] = useState(false);
  const [imgState, setImgState] = useState<
    "idle" | "processing" | "uploading" | "done" | "error"
  >(initial?.image_url ? "done" : "idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  async function handleImageFile(file: File) {
    setImgState("processing");
    try {
      const optimized = await optimizeImage(file, "banner");
      setImgState("uploading");
      const { publicUrl } = await uploadImage(
        file, "banner", "special-images", `${merchantId}/special-${Date.now()}.webp`
      );
      setImageUrl(publicUrl);
      setImgState("done");
    } catch {
      setImgState("error");
    }
  }

  async function handleSubmit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        title,
        description,
        image_url: imageUrl,
        linked_menu_item: linkedItem === "" || linkedItem == null ? null : Number(linkedItem),
        linked_reward: linkedReward || null,
        discount_type: discountType,
        discount_value: discountType === "none" ? null : discountValue ? Number(discountValue) : null,
        is_active: initial?.is_active ?? true,
      });
    } finally {
      setSaving(false);
    }
  }

  const imgBusy = imgState === "processing" || imgState === "uploading";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg space-y-4 rounded-t-3xl bg-background p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl text-foreground">
            {initial ? "Edit special" : "New special"}
          </h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-mist"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Image upload */}
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Banner image
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImageFile(f);
                e.target.value = "";
              }}
            />
            <div
              onClick={() => !imgBusy && inputRef.current?.click()}
              className={`relative mt-1.5 flex h-36 w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition-colors ${
                imgBusy ? "cursor-wait" : "hover:border-ink/40"
              } ${imgState === "done" ? "border-emerald-400" : "border-border"}`}
            >
              {imageUrl ? (
                <img src={imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Click to upload banner</p>
                </div>
              )}
              {imgBusy && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}
              {imageUrl && !imgBusy && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setImageUrl(""); setImgState("idle"); }}
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {imageUrl && !imgBusy && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Upload className="h-3 w-3" /> Change image
              </button>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Buy one get one free today!"
              className="mt-1.5 h-11 w-full rounded-2xl bg-mist px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Add more details about the offer…"
              rows={3}
              className="mt-1.5 w-full resize-none rounded-2xl bg-mist px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
            />
          </div>

          {/* Link to menu item */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Link to menu item (optional)
            </label>
            <select
              value={linkedItem}
              onChange={(e) => { setLinkedItem(e.target.value); if (e.target.value) setLinkedReward(""); }}
              className="mt-1.5 h-11 w-full rounded-2xl bg-mist px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
            >
              <option value="">— None —</option>
              {menuItems.map((m) => (
                <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>
              ))}
            </select>
          </div>

          {/* Link to reward */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Link to reward (optional)
            </label>
            <select
              value={linkedReward}
              onChange={(e) => { setLinkedReward(e.target.value); if (e.target.value) setLinkedItem(""); }}
              className="mt-1.5 h-11 w-full rounded-2xl bg-mist px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
            >
              <option value="">— None —</option>
              {rewards.map((r) => (
                <option key={r.id} value={r.id}>{r.emoji} {r.name}</option>
              ))}
            </select>
          </div>

          {/* Discount (optional) */}
          <div className="rounded-2xl border border-dashed border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Percent className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Discount (optional)
              </label>
            </div>
            <div className="flex gap-2">
              <select
                value={discountType}
                onChange={(e) => {
                  setDiscountType(e.target.value as "none" | "percentage" | "fixed");
                  if (e.target.value === "none") setDiscountValue("");
                }}
                className="h-11 w-36 rounded-2xl bg-mist px-4 text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40"
              >
                <option value="none">No discount</option>
                <option value="percentage">Percentage %</option>
                <option value="fixed">Fixed amount</option>
              </select>
              {discountType !== "none" && (
                <div className="relative flex-1">
                  {discountType === "fixed" && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rs.</span>
                  )}
                  <input
                    type="number"
                    min="0"
                    max={discountType === "percentage" ? "100" : undefined}
                    step={discountType === "percentage" ? "1" : "0.01"}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder={discountType === "percentage" ? "0-100" : "Amount"}
                    className={`h-11 w-full rounded-2xl bg-mist text-sm text-foreground outline-none focus:ring-2 focus:ring-ember/40 ${
                      discountType === "fixed" ? "pl-8 pr-4" : "px-4"
                    }`}
                  />
                  {discountType === "percentage" && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl border border-border text-sm text-muted-foreground hover:bg-mist"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !title.trim() || imgBusy}
            className="h-11 flex-1 rounded-2xl bg-ink text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        active ? "bg-ink" : "bg-border"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          active ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function IconBtn({
  onClick, danger, children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors ${
        danger ? "hover:bg-rose-50 hover:text-rose-500" : "hover:bg-mist"
      }`}
    >
      {children}
    </button>
  );
}
