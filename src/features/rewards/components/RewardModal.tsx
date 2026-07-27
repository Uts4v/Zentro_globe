import React, { useState } from "react";
import { Reward, MenuItem } from "@/lib/api";
import { Modal, FL, inputCls } from "@/components/LoyaltyShared";

export function RewardModal({ initial, menuItems, saving, onSave, onClose }: {
  initial: Reward | null; menuItems: MenuItem[]; saving: boolean;
  onSave: (d: Omit<Reward, "id" | "merchant_id" | "created_at" | "linked_menu_item_name">) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDesc] = useState(initial?.description ?? "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎁");
  const [pointsCost, setPoints] = useState(String(initial?.points_cost ?? 100));
  const [stock, setStock] = useState(String(initial?.stock ?? -1));
  const [linkedItem, setLinkedItem] = useState(String(initial?.linked_menu_item ?? ""));
  return (
    <Modal title={initial ? "Edit reward" : "New reward"} onClose={onClose}>
      <div className="space-y-3">
        <FL label="Reward name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Free flat white" className={inputCls} /></FL>
        <FL label="Description"><input value={description} onChange={(e) => setDesc(e.target.value)} placeholder="What the customer gets" className={inputCls} /></FL>
        <FL label="Link to product (optional)">
          <select value={linkedItem} onChange={(e) => setLinkedItem(e.target.value)} className={inputCls}>
            <option value="">None</option>
            {menuItems.map((m) => (
              <option key={m.id} value={m.id}>{m.emoji} {m.name}</option>
            ))}
          </select>
        </FL>
        <div className="grid grid-cols-3 gap-3">
          <FL label="Emoji"><input value={emoji} onChange={(e) => setEmoji(e.target.value)} className={inputCls} maxLength={2} /></FL>
          <FL label="Points cost"><input type="number" min={1} value={pointsCost} onChange={(e) => setPoints(e.target.value)} className={inputCls} /></FL>
          <FL label="Stock (-1=∞)"><input type="number" min={-1} value={stock} onChange={(e) => setStock(e.target.value)} className={inputCls} /></FL>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="h-10 flex-1 rounded-2xl border border-border text-sm text-muted-foreground">Cancel</button>
          <button
            onClick={() => onSave({ name, description, emoji, points_cost: Number(pointsCost), stock: Number(stock), is_active: initial?.is_active ?? true, linked_menu_item: linkedItem ? Number(linkedItem) : null })}
            disabled={saving || !name.trim()}
            className="h-10 flex-1 rounded-2xl bg-ink text-sm font-medium text-primary-foreground disabled:opacity-50">
            {saving ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
