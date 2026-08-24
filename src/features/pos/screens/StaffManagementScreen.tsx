import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore } from "../store";
import { posListWorkers, posCreateWorker, posUpdateWorker, ShiftWorker } from "../api";
import {
  listPreparationAreas,
  getStaffPreparationAreas,
  setStaffPreparationAreas,
} from "@/features/preparation/api";
import type { PreparationArea } from "@/features/preparation/types";
import {
  Users,
  Plus,
  Pencil,
  Shield,
  Eye,
  Loader2,
  X,
  Check,
  UserX,
  UserCheck,
  ChefHat,
} from "lucide-react";

const ROLES = [
  { value: "cashier", label: "Cashier" },
  { value: "waiter", label: "Waiter" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const ROLE_COLORS: Record<string, string> = {
  cashier: "bg-blue-100 text-blue-700",
  waiter: "bg-green-100 text-green-700",
  manager: "bg-amber-100 text-amber-700",
  admin: "bg-purple-100 text-purple-700",
};

const ALL_ACCESS_ROLES = ["manager", "admin"];

export default function StaffManagementScreen() {
  const [workers, setWorkers] = useState<ShiftWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingWorker, setEditingWorker] = useState<ShiftWorker | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState("cashier");
  const [newDiscount, setNewDiscount] = useState(false);
  const [newRefund, setNewRefund] = useState(false);
  const [newCloseShift, setNewCloseShift] = useState(false);
  const [newViewReports, setNewViewReports] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preparation areas + per-worker assignments
  const [areas, setAreas] = useState<PreparationArea[]>([]);
  const [workerAreaIds, setWorkerAreaIds] = useState<Record<string, number[]>>({});
  const [savingAreaFor, setSavingAreaFor] = useState<string | null>(null);
  const [newAreaIds, setNewAreaIds] = useState<number[]>([]);

  useEffect(() => {
    loadWorkers();
    loadAreas();
  }, []);

  async function loadAreas() {
    try {
      const data = await listPreparationAreas();
      setAreas(data.filter((a) => a.is_active));
    } catch {
      // preparation routing may be disabled — ignore
    }
  }

  async function loadWorkerAreas(workerId: string) {
    try {
      const data = await getStaffPreparationAreas(workerId);
      setWorkerAreaIds((prev) => ({
        ...prev,
        [workerId]: data.map((a) => a.area_id),
      }));
    } catch {
      // ignore
    }
  }

  async function handleToggleArea(workerId: string, areaId: number) {
    const current = workerAreaIds[workerId] ?? [];
    const next = current.includes(areaId)
      ? current.filter((id) => id !== areaId)
      : [...current, areaId];
    setWorkerAreaIds((prev) => ({ ...prev, [workerId]: next }));
    setSavingAreaFor(workerId);
    try {
      await setStaffPreparationAreas(workerId, next);
    } catch {
      await loadWorkerAreas(workerId);
    } finally {
      setSavingAreaFor(null);
    }
  }

  async function loadWorkers() {
    setLoading(true);
    try {
      const data = await posListWorkers();
      setWorkers(data);
      data.forEach((w) => loadWorkerAreas(w.id));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim() || newPin.length < 4) return;
    setCreating(true);
    setError(null);
    try {
      await posCreateWorker({
        display_name: newName.trim(),
        pin: newPin,
        role: newRole,
        can_apply_discount: newDiscount,
        can_process_refund: newRefund,
        can_close_shift: newCloseShift,
        can_view_reports: newViewReports,
      }).then(async (created) => {
        if (newAreaIds.length > 0) {
          await setStaffPreparationAreas(created.id, newAreaIds);
        }
        return created;
      });
      setShowCreate(false);
      resetForm();
      await loadWorkers();
    } catch (err: any) {
      setError(err?.message || "Failed to create worker");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(worker: ShiftWorker) {
    try {
      await posUpdateWorker(worker.id, { is_active: !worker.is_active });
      await loadWorkers();
    } catch {
      // ignore
    }
  }

  async function handleUpdatePermissions(worker: ShiftWorker, field: string, value: boolean) {
    try {
      await posUpdateWorker(worker.id, { [field]: value });
      await loadWorkers();
    } catch {
      // ignore
    }
  }

  function resetForm() {
    setNewName("");
    setNewPin("");
    setNewRole("cashier");
    setNewDiscount(false);
    setNewRefund(false);
    setNewCloseShift(false);
    setNewViewReports(false);
    setNewAreaIds([]);
    setError(null);
  }

  const activeCount = workers.filter((w) => w.is_active).length;
  const currentWorker = usePosStore((s) => s.currentWorker);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="h-5 w-5 text-ink" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Staff Management</h1>
            <p className="text-xs text-muted-foreground">
              {activeCount} active worker{activeCount !== 1 ? "s" : ""}
              {!currentWorker && " — setup mode (no worker signed in)"}
            </p>
          </div>
        </div>
        {!currentWorker && (
          <Link
            to="/pos"
            className="mr-auto rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ← Back to terminal
          </Link>
        )}
        <button
          onClick={() => {
            resetForm();
            setShowCreate(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add Worker
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : workers.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Users className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No workers yet</p>
          <p className="mt-1 text-xs">Add your first worker to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {workers.map((worker) => (
            <div
              key={worker.id}
              className={`rounded-2xl border bg-card p-4 transition-opacity ${
                !worker.is_active ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`grid h-10 w-10 place-items-center rounded-full ${
                      worker.is_active ? "bg-ink/10" : "bg-muted"
                    }`}
                  >
                    <Users
                      className={`h-5 w-5 ${worker.is_active ? "text-ink" : "text-muted-foreground"}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-foreground">{worker.display_name}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ROLE_COLORS[worker.role] || "bg-gray-100 text-gray-700"}`}
                      >
                        {worker.role}
                      </span>
                      {!worker.is_active && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      ID: {worker.id.slice(0, 8)}...
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleActive(worker)}
                    className={`rounded-lg p-1.5 transition-colors ${
                      worker.is_active
                        ? "text-green-600 hover:bg-green-50"
                        : "text-red-500 hover:bg-red-50"
                    }`}
                    title={worker.is_active ? "Deactivate" : "Activate"}
                  >
                    {worker.is_active ? (
                      <UserCheck className="h-4 w-4" />
                    ) : (
                      <UserX className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Permissions */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <PermissionToggle
                  label="Discounts"
                  checked={worker.can_apply_discount}
                  disabled={!worker.is_active}
                  onChange={(v) => handleUpdatePermissions(worker, "can_apply_discount", v)}
                />
                <PermissionToggle
                  label="Refunds"
                  checked={worker.can_process_refund}
                  disabled={!worker.is_active}
                  onChange={(v) => handleUpdatePermissions(worker, "can_process_refund", v)}
                />
                <PermissionToggle
                  label="Close Shift"
                  checked={worker.can_close_shift}
                  disabled={!worker.is_active}
                  onChange={(v) => handleUpdatePermissions(worker, "can_close_shift", v)}
                />
                <PermissionToggle
                  label="View Reports"
                  checked={worker.can_view_reports}
                  disabled={!worker.is_active}
                  onChange={(v) => handleUpdatePermissions(worker, "can_view_reports", v)}
                />
              </div>

              {/* Preparation area access */}
              {ALL_ACCESS_ROLES.includes(worker.role) ? (
                <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
                  <ChefHat className="h-3.5 w-3.5" />
                  {worker.role === "manager" ? "Manager" : "Admin"} — has access to all preparation
                  areas (Kitchen, Bar, …)
                </p>
              ) : (
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Preparation screens
                    </span>
                    {savingAreaFor === worker.id && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {areas.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      No preparation areas yet. Enable preparation routing in Settings.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {areas.map((area) => {
                        const selected = (workerAreaIds[worker.id] ?? []).includes(area.id);
                        return (
                          <button
                            key={area.id}
                            onClick={() => handleToggleArea(worker.id, area.id)}
                            disabled={!worker.is_active || savingAreaFor === worker.id}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                              selected ? "bg-ink/10 text-ink" : "bg-muted text-muted-foreground"
                            } ${!worker.is_active ? "opacity-40" : "hover:opacity-80"}`}
                          >
                            <ChefHat className="h-3 w-3" />
                            {area.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Worker Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-lg font-bold text-foreground">Add Worker</h2>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Display Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Ali"
                  autoFocus
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>

              {/* PIN */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  PIN (4-8 digits)
                </label>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="****"
                  maxLength={8}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm tracking-[0.5em] focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>

              {/* Role */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
                <div className="flex gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setNewRole(r.value)}
                      className={`flex-1 rounded-xl py-2 text-xs font-medium transition-colors ${
                        newRole === r.value
                          ? "bg-ink text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permissions */}
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">
                  Permissions
                </label>
                <div className="space-y-2">
                  <Checkbox
                    label="Can apply discounts"
                    checked={newDiscount}
                    onChange={setNewDiscount}
                  />
                  <Checkbox
                    label="Can process refunds"
                    checked={newRefund}
                    onChange={setNewRefund}
                  />
                  <Checkbox
                    label="Can close shifts"
                    checked={newCloseShift}
                    onChange={setNewCloseShift}
                  />
                  <Checkbox
                    label="Can view reports"
                    checked={newViewReports}
                    onChange={setNewViewReports}
                  />
                </div>
              </div>

              {/* Preparation area access */}
              {newRole === "manager" || newRole === "admin" ? (
                <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                  {newRole === "manager" ? "Managers" : "Admins"} get access to all preparation
                  areas automatically.
                </p>
              ) : areas.length > 0 ? (
                <div>
                  <label className="mb-2 block text-xs font-medium text-muted-foreground">
                    Preparation screens (Kitchen / Bar)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {areas.map((area) => {
                      const selected = newAreaIds.includes(area.id);
                      return (
                        <button
                          key={area.id}
                          type="button"
                          onClick={() =>
                            setNewAreaIds((prev) =>
                              selected ? prev.filter((id) => id !== area.id) : [...prev, area.id],
                            )
                          }
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            selected ? "bg-ink/10 text-ink" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          <ChefHat className="h-3 w-3" />
                          {area.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Error */}
              {error && (
                <p className="rounded-xl bg-red-50 p-3 text-center text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="flex gap-3 border-t border-border px-5 py-4">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || newPin.length < 4 || creating}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Worker"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function PermissionToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        checked ? "bg-ink/10 text-ink" : "bg-muted text-muted-foreground"
      } ${disabled ? "opacity-40" : "hover:opacity-80"}`}
    >
      {checked ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </button>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        className={`grid h-5 w-5 place-items-center rounded border transition-colors ${
          checked ? "border-ink bg-ink" : "border-border bg-background"
        }`}
      >
        {checked && <Check className="h-3 w-3 text-white" />}
      </div>
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}
