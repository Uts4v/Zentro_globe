// src/features/inventory/screens/SettingsScreen.tsx
// Keep settings simple: three safety switches, places, categories, audit.
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { inventoryApi, type InventorySettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ConfirmDialog,
  ErrorBlock,
  ListSkeleton,
  ScreenHeader,
  SectionHeader,
  errorMessage,
  formatDateTime,
  inputCls,
} from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { P, QK, useCategories, useInventory, useLocations } from "@/features/inventory/context";

const s = copy.settings;

function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = label.replace(/\s+/g, "-").toLowerCase();
  return (
    <div className="flex items-center justify-between gap-6 rounded-2xl border border-border bg-card px-4 py-3">
      <div>
        <p id={id} className="font-semibold text-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-0"}`}
        />
        <span className="sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

type Named = { id: number; name: string; is_active: boolean };

function NameList({
  title,
  hint,
  addLabel,
  items,
  loading,
  onAdd,
  onRename,
  onDelete,
}: {
  title: string;
  hint: string;
  addLabel: string;
  items: Named[];
  loading: boolean;
  onAdd: (name: string) => Promise<unknown>;
  onRename: (id: number, name: string) => Promise<unknown>;
  onDelete: (id: number) => Promise<{ result: string }>;
}) {
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Named | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <SectionHeader title={title} subtitle={hint} />
      {error && <ErrorBlock message={error} />}
      {loading ? (
        <ListSkeleton rows={3} />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex min-h-[56px] items-center justify-between gap-2 px-4 py-2"
            >
              {editing?.id === it.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await onRename(it.id, editing.name.trim());
                      setEditing(null);
                    });
                  }}
                >
                  <input
                    aria-label={s.rename}
                    className={inputCls}
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: it.id, name: e.target.value })}
                  />
                  <Button
                    type="submit"
                    className="h-11 w-11 p-0"
                    aria-label={copy.common.save}
                    disabled={busy || !editing.name.trim()}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-11 p-0"
                    aria-label={copy.common.cancel}
                    onClick={() => setEditing(null)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className={it.is_active ? "text-foreground" : "text-muted-foreground"}>
                    {it.name}
                    {!it.is_active && <span className="block text-xs">{s.hidden}</span>}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      className="h-11 w-11 p-0"
                      aria-label={`${s.rename} ${it.name}`}
                      onClick={() => setEditing({ id: it.id, name: it.name })}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    {it.is_active && (
                      <Button
                        variant="ghost"
                        className="h-11 w-11 p-0 text-danger hover:bg-bordeaux-soft hover:text-danger"
                        aria-label={`${copy.common.delete} ${it.name}`}
                        onClick={() => setDeleting(it)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          run(async () => {
            await onAdd(adding.trim());
            setAdding("");
          });
        }}
      >
        <input
          aria-label={addLabel}
          className={inputCls}
          placeholder={addLabel}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        <Button type="submit" className="h-11" disabled={busy || !adding.trim()}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {addLabel}
        </Button>
      </form>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={deleting ? `${copy.common.delete} ${deleting.name}?` : ""}
        danger
        busy={busy}
        confirmLabel={copy.common.delete}
        onConfirm={() =>
          run(async () => {
            if (!deleting) return;
            const res = await onDelete(deleting.id);
            toast.success(
              res.result === "deleted"
                ? `${deleting.name} deleted.`
                : `${deleting.name} hidden. Old records still use it.`,
            );
            setDeleting(null);
          })
        }
      />
    </section>
  );
}

export function SettingsScreen() {
  const { can, go, refresh } = useInventory();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["inventory", "settings"],
    queryFn: inventoryApi.settings,
    enabled: can(P.MANAGE_SETTINGS),
  });
  const locations = useLocations();
  const categories = useCategories();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const audit = useInfiniteQuery({
    queryKey: ["inventory", "audit"],
    queryFn: ({ pageParam }) => inventoryApi.audit({ page: pageParam, page_size: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: can(P.MANAGE_SETTINGS),
  });

  async function update(patch: Partial<InventorySettings>) {
    setSaving(true);
    setError("");
    try {
      const updated = await inventoryApi.patchSettings(patch);
      qc.setQueryData(["inventory", "settings"], updated);
      refresh();
      toast.success(copy.common.saved);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const refreshRefs = (name: string) => () => qc.invalidateQueries({ queryKey: QK.refs(name) });

  return (
    <div className="space-y-8">
      <ScreenHeader
        title={s.title}
        onBack={() => go("home")}
        action={
          saving ? (
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              aria-label={copy.common.saving}
            />
          ) : null
        }
      />
      {error && <ErrorBlock message={error} />}

      {can(P.MANAGE_SETTINGS) && (
        <section className="space-y-3">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {s.safety}
          </p>
          {settings.isLoading ? (
            <ListSkeleton rows={3} />
          ) : (
            settings.data && (
              <>
                <Switch
                  label={s.countApproval}
                  hint={s.countApprovalHint}
                  checked={settings.data.require_count_approval}
                  disabled={saving}
                  onChange={(v) => update({ require_count_approval: v })}
                />
                <Switch
                  label={s.negativeStock}
                  hint={s.negativeStockHint}
                  checked={settings.data.prevent_negative_stock}
                  disabled={saving}
                  onChange={(v) => update({ prevent_negative_stock: v })}
                />
                <Switch
                  label={s.fixApproval}
                  hint={s.fixApprovalHint}
                  checked={settings.data.require_adjustment_approval}
                  disabled={saving}
                  onChange={(v) => update({ require_adjustment_approval: v })}
                />
              </>
            )
          )}
        </section>
      )}

      {can(P.MANAGE_ITEMS) && (
        <div className="grid gap-8 lg:grid-cols-2">
          <NameList
            title={s.places}
            hint={s.placesHint}
            addLabel={s.addPlace}
            items={locations.data ?? []}
            loading={locations.isLoading}
            onAdd={(name) => inventoryApi.createLocation(name).then(refreshRefs("locations"))}
            onRename={(id, name) =>
              inventoryApi.patchLocation(id, { name }).then(refreshRefs("locations"))
            }
            onDelete={(id) =>
              inventoryApi.deleteLocation(id).then((r) => (refreshRefs("locations")(), r))
            }
          />
          <NameList
            title={s.categories}
            hint={s.categoriesHint}
            addLabel={s.addCategory}
            items={categories.data ?? []}
            loading={categories.isLoading}
            onAdd={(name) => inventoryApi.createCategory(name).then(refreshRefs("categories"))}
            onRename={(id, name) =>
              inventoryApi.patchCategory(id, { name }).then(refreshRefs("categories"))
            }
            onDelete={(id) =>
              inventoryApi.deleteCategory(id).then((r) => (refreshRefs("categories")(), r))
            }
          />
        </div>
      )}

      {can(P.MANAGE_SETTINGS) && (
        <details className="rounded-2xl border border-border">
          <summary className="flex min-h-[52px] cursor-pointer items-center px-4 font-semibold text-foreground">
            {s.audit}
          </summary>
          <div className="border-t border-border p-4">
            <p className="mb-3 text-sm text-muted-foreground">{s.auditHint}</p>
            <ul className="divide-y divide-border text-sm">
              {(audit.data?.pages.flatMap((p) => p.results) ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="text-foreground">
                    {a.action.replace(/_/g, " ")}
                    {typeof a.metadata?.name === "string" ? ` · ${a.metadata.name}` : ""}
                    {typeof a.metadata?.staff === "string" && a.metadata.staff
                      ? ` · ${a.metadata.staff}`
                      : ""}
                  </span>
                  <span className="text-muted-foreground">
                    {a.user_name || "—"} · {formatDateTime(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
            {audit.hasNextPage && (
              <Button
                variant="outline"
                className="mt-3 h-11 w-full"
                onClick={() => audit.fetchNextPage()}
              >
                {copy.history.loadMore}
              </Button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
