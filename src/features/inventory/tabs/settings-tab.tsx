// src/features/inventory/tabs/settings-tab.tsx
import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, History } from "lucide-react";
import { inventoryApi, type AuditLogEntry, type InventorySettings } from "@/lib/api";
import {
  ErrorBlock,
  LoadingBlock,
  SectionHeader,
  formatDateTime,
  errorMessage,
} from "@/features/inventory/components/bits";

function Toggle({
  label,
  desc,
  checked,
  onToggle,
  disabled,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-2xl border border-border bg-card px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onToggle(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsTab() {
  const [settings, setSettings] = useState<InventorySettings | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [s, a] = await Promise.all([inventoryApi.settings(), inventoryApi.audit()]);
      setSettings(s);
      setAudit(a.results ?? []);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to load inventory settings"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function update(patch: Partial<InventorySettings>) {
    setSaving(true);
    setError("");
    try {
      const updated = await inventoryApi.patchSettings(patch);
      setSettings(updated);
    } catch (e: unknown) {
      setError(errorMessage(e, "Failed to update settings"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error && !settings) return <ErrorBlock message={error} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Settings"
        subtitle="Choose when a manager needs to review stock changes."
        action={saving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      />

      {error && <ErrorBlock message={error} />}

      <div className="grid gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Stock Rules
        </span>
        <Toggle
          label="Count Approval"
          desc="A manager must approve stock counts before quantities are updated."
          checked={settings?.require_count_approval ?? true}
          onToggle={(v) => update({ require_count_approval: v })}
        />
        <Toggle
          label="Stock Correction Approval"
          desc="A manager must approve manual stock corrections."
          checked={settings?.require_adjustment_approval ?? false}
          onToggle={(v) => update({ require_adjustment_approval: v })}
        />
        <Toggle
          label="Prevent Negative Stock"
          desc="Do not allow actions that would make stock go below zero."
          checked={settings?.prevent_negative_stock ?? false}
          onToggle={(v) => update({ prevent_negative_stock: v })}
        />
      </div>

      <div className="space-y-3">
        <SectionHeader
          title="Advanced: Audit History"
          subtitle="Recent sensitive actions for this merchant"
          action={<History className="h-4 w-4 text-muted-foreground" />}
        />
        {audit.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
            No audit entries yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Entity</th>
                  <th className="px-4 py-2.5">User</th>
                  <th className="px-4 py-2.5 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-2.5 font-medium text-foreground">{a.action}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {a.entity_type} #{a.entity_id}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.user_name || "—"}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {formatDateTime(a.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
