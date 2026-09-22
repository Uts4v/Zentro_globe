import { useState, useEffect } from "react";
import { X, Plus, Pencil, Trash2, Loader2, Check, Star, Minus } from "lucide-react";
import { menuApi, type MenuOption, type MenuOptionGroup } from "@/lib/api";

type Kind = "variant" | "modifier";

interface Props {
  itemId: string;
  itemName: string;
  onClose: () => void;
  onChanged: () => void;
}

type GroupForm = {
  name: string;
  kind: Kind;
  required: boolean;
  min_select: number;
  max_select: number;
  is_active: boolean;
  display_order: number;
};

type OptionForm = {
  name: string;
  sku: string;
  price: string;
  price_delta: string;
  is_default: boolean;
  is_available: boolean;
  display_order: number;
};

const EMPTY_GROUP: GroupForm = {
  name: "",
  kind: "variant",
  required: false,
  min_select: 1,
  max_select: 1,
  is_active: true,
  display_order: 0,
};

export function OptionGroupsEditor({ itemId, itemName, onClose, onChanged }: Props) {
  const [groups, setGroups] = useState<MenuOptionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGroup, setEditingGroup] = useState<MenuOptionGroup | null>(null);
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<{
    group: MenuOptionGroup;
    option: MenuOption | null;
  } | null>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>(EMPTY_GROUP);
  const [optionForm, setOptionForm] = useState<OptionForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const g = await menuApi.optionGroups(itemId);
      setGroups(g);
    } finally {
      setLoading(false);
    }
  }

  function openGroupEdit(group: MenuOptionGroup | null) {
    setEditingGroup(group);
    setGroupForm(group ?? EMPTY_GROUP);
    setGroupFormOpen(true);
  }

  function openOptionEdit(group: MenuOptionGroup, option: MenuOption | null) {
    setEditingOption({ group, option });
    setOptionForm(
      option
        ? {
            name: option.name,
            sku: option.sku ?? "",
            price: option.price ?? "",
            price_delta: option.price_delta ?? "",
            is_default: option.is_default,
            is_available: option.is_available,
            display_order: option.display_order,
          }
        : {
            name: "",
            sku: "",
            price: "",
            price_delta: "",
            is_default: false,
            is_available: true,
            display_order: 0,
          },
    );
  }

  async function saveGroup() {
    setSaving(true);
    try {
      const payload = {
        name: groupForm.name,
        kind: groupForm.kind,
        required: Boolean(groupForm.required),
        min_select: Number(groupForm.min_select),
        max_select: Number(groupForm.max_select),
        is_active: Boolean(groupForm.is_active),
        display_order: Number(groupForm.display_order ?? 0),
      };
      if (editingGroup) {
        await menuApi.updateOptionGroup(itemId, editingGroup.id, payload);
      } else {
        await menuApi.createOptionGroup(itemId, payload);
      }
      setEditingGroup(null);
      setGroupFormOpen(false);
      await load();
      onChanged();
    } catch (e: unknown) {
      alert((e as { message?: string }).message || "Could not save group.");
    } finally {
      setSaving(false);
    }
  }

  async function saveOption() {
    if (!editingOption || !optionForm) return;
    setSaving(true);
    try {
      const payload = {
        name: optionForm.name,
        sku: optionForm.sku || null,
        price: optionForm.price !== "" ? String(optionForm.price) : null,
        price_delta: optionForm.price_delta !== "" ? String(optionForm.price_delta) : null,
        is_default: Boolean(optionForm.is_default),
        is_available: Boolean(optionForm.is_available),
        display_order: Number(optionForm.display_order ?? 0),
      };
      if (editingOption.option) {
        await menuApi.updateOption(
          itemId,
          editingOption.group.id,
          editingOption.option.id,
          payload,
        );
      } else {
        await menuApi.addOption(itemId, editingOption.group.id, payload);
      }
      setEditingOption(null);
      await load();
      onChanged();
    } catch (e: unknown) {
      alert((e as { message?: string }).message || "Could not save option.");
    } finally {
      setSaving(false);
    }
  }

  async function removeGroup(group: MenuOptionGroup) {
    if (!confirm(`Delete group "${group.name}"? Its options are removed too.`)) return;
    setBusy(`g:${group.id}`);
    try {
      await menuApi.deleteOptionGroup(itemId, group.id);
      await load();
      onChanged();
    } catch (e: unknown) {
      alert((e as { message?: string }).message || "Could not delete group.");
    } finally {
      setBusy(null);
    }
  }

  async function removeOption(group: MenuOptionGroup, option: MenuOption) {
    if (!confirm(`Delete option "${option.name}"?`)) return;
    setBusy(`o:${group.id}:${option.id}`);
    try {
      await menuApi.deleteOption(itemId, group.id, option.id);
      await load();
      onChanged();
    } catch (e: unknown) {
      alert((e as { message?: string }).message || "Could not delete option.");
    } finally {
      setBusy(null);
    }
  }

  function optPrice(group: MenuOptionGroup, opt: MenuOption): string {
    if (group.kind === "variant") {
      if (opt.price == null) return "Base price";
      return `NPR ${Number(opt.price).toLocaleString()}`;
    }
    if (opt.price_delta == null) return "Included";
    const v = Number(opt.price_delta);
    return v === 0 ? "Included" : `+NPR ${v.toLocaleString()}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-strong max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-3xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Variants &amp; modifiers
            </p>
            <h2 className="font-display text-xl text-foreground">{itemName}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-72px)] space-y-4 overflow-y-auto p-6">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-10 text-center">
              <p className="text-3xl">🧀</p>
              <p className="mt-2 text-sm text-muted-foreground">
                No options yet — add sizes (Large +NPR 40), extras (Extra shot), or choices (Hot /
                Iced).
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <div
                key={g.id}
                className={`rounded-2xl border p-4 ${g.is_active ? "border-border bg-white/40" : "border-border bg-mist/50 opacity-70"}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${g.kind === "variant" ? "bg-teal-100 text-teal-700" : "bg-violet-100 text-violet-700"}`}
                  >
                    {g.kind}
                  </span>
                  {g.required && (
                    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-medium text-rose-600">
                      Required
                    </span>
                  )}
                  <h3 className="font-display text-lg text-foreground">{g.name}</h3>
                  <span className="text-[11px] text-muted-foreground">
                    select {g.min_select}–{g.kind === "variant" ? 1 : g.max_select}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => openGroupEdit(g)}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-mist text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => removeGroup(g)}
                      disabled={busy === `g:${g.id}`}
                      className="grid h-7 w-7 place-items-center rounded-lg bg-rose-50 text-rose-400 hover:text-rose-600 disabled:opacity-40"
                    >
                      {busy === `g:${g.id}` ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {g.options.length === 0 && (
                    <p className="text-xs text-muted-foreground">No options yet.</p>
                  )}
                  {g.options.map((o) => (
                    <div
                      key={o.id}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 ${o.is_available ? "bg-mist/60" : "bg-mist/30 opacity-60"}`}
                    >
                      {o.is_default && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      <span className="text-sm text-foreground">{o.name}</span>
                      {o.sku && (
                        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          {o.sku}
                        </span>
                      )}
                      <span className="ml-auto text-sm font-medium text-foreground">
                        {optPrice(g, o)}
                      </span>
                      <button
                        onClick={() => openOptionEdit(g, o)}
                        className="grid h-6 w-6 place-items-center rounded-md bg-white text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() => removeOption(g, o)}
                        disabled={busy === `o:${g.id}:${o.id}`}
                        className="grid h-6 w-6 place-items-center rounded-md bg-rose-50 text-rose-400 hover:text-rose-600 disabled:opacity-40"
                      >
                        {busy === `o:${g.id}:${o.id}` ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-2.5 w-2.5" />
                        )}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => openOptionEdit(g, null)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add option
                  </button>
                </div>
              </div>
            ))
          )}

          <button
            onClick={() => openGroupEdit(null)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-teal-400/50 py-3 text-sm font-medium text-teal-700 hover:bg-teal-50"
          >
            <Plus className="h-4 w-4" /> Add option group
          </button>
        </div>

        {/* Group form */}
        {groupFormOpen && (
          <ModalPanel
            title={editingGroup ? "Edit group" : "New option group"}
            onClose={() => {
              setGroupFormOpen(false);
              setEditingGroup(null);
            }}
          >
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                  Name *
                </span>
                <input
                  value={groupForm.name}
                  onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                  placeholder="Size, Extras, Milk…"
                  className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["variant", "modifier"] as Kind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() =>
                      setGroupForm({
                        ...groupForm,
                        kind: k,
                        max_select: k === "variant" ? 1 : groupForm.max_select,
                      })
                    }
                    className={`flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium ${groupForm.kind === k ? "border-teal-600 bg-teal-600 text-white" : "border-border bg-white/60 text-muted-foreground"}`}
                  >
                    {groupForm.kind === k && <Check className="h-3.5 w-3.5" />}
                    {k === "variant" ? "Variant (pick one)" : "Modifier (add-ons)"}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                    Min select
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={groupForm.min_select}
                    onChange={(e) =>
                      setGroupForm({ ...groupForm, min_select: Number(e.target.value) })
                    }
                    className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                    Max select
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={groupForm.kind === "variant" ? 1 : groupForm.max_select}
                    onChange={(e) =>
                      setGroupForm({ ...groupForm, max_select: Number(e.target.value) })
                    }
                    disabled={groupForm.kind === "variant"}
                    className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50"
                  />
                </label>
                <label className="flex items-end pb-1">
                  <button
                    onClick={() => setGroupForm({ ...groupForm, required: !groupForm.required })}
                    className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border text-xs font-medium ${groupForm.required ? "border-rose-500 bg-rose-500 text-white" : "border-border bg-white/60 text-muted-foreground"}`}
                  >
                    {groupForm.required ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Minus className="h-3.5 w-3.5" />
                    )}
                    Required
                  </button>
                </label>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingGroup(null)}
                  className="h-11 flex-1 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={saveGroup}
                  disabled={saving || !groupForm.name.trim()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save group
                </button>
              </div>
            </div>
          </ModalPanel>
        )}

        {/* Option form */}
        {editingOption && optionForm && (
          <ModalPanel
            title={editingOption.option ? "Edit option" : "New option"}
            onClose={() => setEditingOption(null)}
          >
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                  Name *
                </span>
                <input
                  value={optionForm.name}
                  onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
                  placeholder={editingOption.group.kind === "variant" ? "Large" : "Extra shot"}
                  className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                    SKU (optional)
                  </span>
                  <input
                    value={optionForm.sku ?? ""}
                    onChange={(e) => setOptionForm({ ...optionForm, sku: e.target.value })}
                    placeholder="LGE-M1"
                    className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </label>
                {editingOption.group.kind === "variant" ? (
                  <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                      Set price (replaces base)
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={optionForm.price ?? ""}
                      onChange={(e) => setOptionForm({ ...optionForm, price: e.target.value })}
                      placeholder="Blank = base price"
                      className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                    />
                  </label>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-widest text-muted-foreground">
                      Price delta (+NPR)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={optionForm.price_delta ?? ""}
                      onChange={(e) =>
                        setOptionForm({ ...optionForm, price_delta: e.target.value })
                      }
                      placeholder="40 = add NPR 40"
                      className="h-10 w-full rounded-xl border border-border bg-white/60 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                    />
                  </label>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    setOptionForm({ ...optionForm, is_default: !optionForm.is_default })
                  }
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium ${optionForm.is_default ? "border-amber-500 bg-amber-500 text-white" : "border-border bg-white/60 text-muted-foreground"}`}
                >
                  {optionForm.is_default && <Check className="h-3.5 w-3.5" />} Default
                </button>
                <button
                  onClick={() =>
                    setOptionForm({ ...optionForm, is_available: !optionForm.is_available })
                  }
                  className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium ${optionForm.is_available ? "border-teal-600 bg-teal-600 text-white" : "border-border bg-white/60 text-muted-foreground"}`}
                >
                  {optionForm.is_available ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}{" "}
                  Available
                </button>
              </div>
              {editingOption.group.kind === "modifier" && optionForm.is_default && (
                <p className="text-[11px] text-muted-foreground">
                  A default modifier is pre-selected for customers — good for “sugar normal”
                  defaults.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingOption(null)}
                  className="h-11 flex-1 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={saveOption}
                  disabled={saving || !optionForm.name.trim()}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-teal-700 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save option
                </button>
              </div>
            </div>
          </ModalPanel>
        )}
      </div>
    </div>
  );
}

function ModalPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="glass-strong w-full max-w-md rounded-t-3xl p-6 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl text-foreground">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full bg-mist text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
