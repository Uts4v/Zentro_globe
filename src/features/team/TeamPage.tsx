// src/features/team/TeamPage.tsx
// Team → Employees and Roles & Permissions.
//   ROLE = what the employee can do.  AREA = which tables they handle.
// One role per employee, no per-person exceptions: to give someone a
// different mix, create (copy) another role.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { areaApi, teamApi, type Employee, type PermissionGroup, type StaffRole } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ConfirmDialog,
  EmptyState,
  ErrorBlock,
  Field,
  FilterChips,
  ListSkeleton,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import { useAccess } from "@/features/team/access";

const t = {
  title: "Team",
  employees: "Employees",
  roles: "Roles & Permissions",
  addEmployee: "Add Employee",
  editEmployee: "Edit Employee",
  name: "Name",
  pin: "PIN",
  pinHint: "4 to 8 digits. Used to sign in on the POS and in staff mode.",
  pinKeep: "Leave empty to keep the current PIN.",
  role: "Role",
  areas: "Assigned Areas",
  areasHint: "Leave all unticked to work in every area.",
  active: "Active",
  save: "Save Employee",
  noEmployees: "No employees yet.",
  noEmployeesHint: "Add the people who work here and choose what each can do.",
  allAreas: "All areas",
  inactive: "Not active",
  staffCode: "Staff Code",
  staffCodeHint:
    "Unique numeric code for POS staff login (e.g. 1001). Leave blank to auto-generate.",
  phone: "Phone",
  phoneHint: "Phone number (optional)",
  email: "Email",
  emailHint: "Email address (optional)",
  deleteEmployee: "Delete Employee",
  deleteEmployeeConfirm:
    "Are you sure you want to remove this employee? If they have existing shift or order history, they will be archived safely to protect audit records.",
  createRole: "Create Role",
  editRole: "Edit Role",
  roleName: "Role name",
  startFrom: "Start from",
  fullAccess: "Full Access",
  systemRole: "System Role",
  perms: (n: number) => `${n} permission${n === 1 ? "" : "s"}`,
  people: (n: number) => `${n} employee${n === 1 ? "" : "s"}`,
  adminNote: "Admin always has full access. This role cannot be changed.",
  deleteRole: "Delete Role",
  saveRole: "Save Role",
  on: "On",
  off: "Off",
  choose: "Choose…",
};

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      }`}
    >
      <span
        className={`absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** Grouped permission toggles — human names only, never codes. */
function PermissionEditor({
  groups,
  value,
  onChange,
  disabled,
}: {
  groups: PermissionGroup[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(groups[0]?.key ?? null);
  return (
    <div className="divide-y divide-border rounded-2xl border border-border">
      {groups.map((group) => {
        const onCount = group.permissions.filter((p) => value.has(p.code)).length;
        const expanded = open === group.key;
        return (
          <div key={group.key}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : group.key)}
              className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-semibold text-foreground">{group.label}</span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {onCount === 0
                  ? t.off
                  : onCount === group.permissions.length
                    ? t.on
                    : `${onCount} of ${group.permissions.length}`}
                <ChevronDown
                  className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </span>
            </button>
            {expanded && (
              <ul className="space-y-1 px-4 pb-3">
                {group.permissions.map((p) => (
                  <li
                    key={p.code}
                    className="flex min-h-[52px] items-center justify-between gap-4 rounded-xl bg-muted/50 px-3 py-2"
                  >
                    <span>
                      <span className="block text-sm font-medium text-foreground">{p.label}</span>
                      <span className="block text-xs text-muted-foreground">{p.hint}</span>
                    </span>
                    <Switch
                      label={p.label}
                      checked={value.has(p.code)}
                      disabled={disabled}
                      onChange={(v) => {
                        const next = new Set(value);
                        if (v) next.add(p.code);
                        else next.delete(p.code);
                        onChange(next);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function RolesTab() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["team", "roles"], queryFn: teamApi.roles });
  const [editing, setEditing] = useState<StaffRole | "new" | null>(null);
  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState<number | "">("");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<StaffRole | null>(null);
  const roles = data.data?.roles ?? [];
  const groups = data.data?.permission_groups ?? [];
  const isNew = editing === "new";
  const role = editing && editing !== "new" ? editing : null;

  function open(target: StaffRole | "new") {
    setError("");
    setEditing(target);
    if (target === "new") {
      const cashier = roles.find((r) => r.name === "Cashier");
      setName("");
      setCloneFrom(cashier?.id ?? "");
      setPerms(new Set(cashier?.permissions ?? []));
    } else {
      setName(target.name);
      setPerms(new Set(target.permissions));
    }
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        await teamApi.createRole({ name: name.trim(), permissions: [...perms] });
        toast.success(`${name.trim()} role created.`);
      } else if (role) {
        await teamApi.updateRole(role.id, {
          name: role.is_system ? undefined : name.trim(),
          permissions: [...perms],
        });
        toast.success(`${role.name} role saved.`);
      }
      setEditing(null);
      // Permissions changed: everything that depends on them is refetched.
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (data.isLoading) return <ListSkeleton rows={4} />;
  if (data.isError)
    return <ErrorBlock message={errorMessage(data.error)} onRetry={() => data.refetch()} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="h-11" onClick={() => open("new")}>
          <Plus className="h-4 w-4" aria-hidden="true" /> {t.createRole}
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => open(r)}
              className="flex min-h-[92px] w-full flex-col items-start justify-center gap-1 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2 text-lg font-semibold text-foreground">
                {r.is_admin && <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />}
                {r.name}
              </span>
              <span className="text-sm text-muted-foreground">
                {r.is_admin
                  ? `${t.fullAccess} · ${t.systemRole}`
                  : `${t.perms(r.permission_count)} · ${t.people(r.employee_count)}`}
              </span>
              {r.description && (
                <span className="text-xs text-muted-foreground">{r.description}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(v) => !busy && !v && setEditing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isNew ? t.createRole : `${t.editRole} · ${role?.name ?? ""}`}
            </DialogTitle>
            {role?.description && <DialogDescription>{role.description}</DialogDescription>}
          </DialogHeader>
          {role?.is_admin ? (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm text-foreground">{t.adminNote}</p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              {(isNew || (role && !role.is_system)) && (
                <Field label={t.roleName} htmlFor="role-name">
                  <input
                    id="role-name"
                    autoFocus={isNew}
                    className={inputCls}
                    maxLength={60}
                    placeholder="e.g. Senior Cashier"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
              )}
              {isNew && (
                <Field label={t.startFrom} htmlFor="role-clone">
                  <select
                    id="role-clone"
                    className={inputCls}
                    value={cloneFrom}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : "";
                      setCloneFrom(id);
                      const source = roles.find((r) => r.id === id);
                      setPerms(new Set(source?.permissions ?? []));
                    }}
                  >
                    <option value="">{t.choose}</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <PermissionEditor groups={groups} value={perms} onChange={setPerms} disabled={busy} />
              {error && <ErrorBlock message={error} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                {role && !role.is_system ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 text-danger"
                    onClick={() => setDeleting(role)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> {t.deleteRole}
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  className="h-11 sm:min-w-32"
                  disabled={busy || (isNew && !name.trim())}
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {isNew ? t.createRole : t.saveRole}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`${t.deleteRole}: ${deleting?.name ?? ""}?`}
        danger
        busy={busy}
        confirmLabel={t.deleteRole}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await teamApi.deleteRole(deleting.id);
            toast.success(`${deleting.name} role deleted.`);
            setEditing(null);
            await qc.invalidateQueries({ queryKey: ["team"] });
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
            setDeleting(null);
          }
        }}
      />
    </div>
  );
}

// ── Employees ─────────────────────────────────────────────────────────────────

function EmployeesTab() {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ["team", "employees"], queryFn: teamApi.employees });
  const rolesQ = useQuery({ queryKey: ["team", "roles"], queryFn: teamApi.roles });
  const areasQ = useQuery({ queryKey: ["tables", "areas"], queryFn: areaApi.list });
  const [editing, setEditing] = useState<Employee | "new" | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [d, setD] = useState({
    name: "",
    staff_code: "",
    phone: "",
    email: "",
    pin: "",
    role: 0,
    areas: new Set<number>(),
    active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roles = rolesQ.data?.roles ?? [];
  const areas = useMemo(() => (areasQ.data?.areas ?? []).filter((a) => a.is_active), [areasQ.data]);
  const areaName = (id: number) => areas.find((a) => a.id === id)?.name ?? "";
  const selectedRole = roles.find((r) => r.id === d.role);
  // Areas matter for people who work the tables, not for kitchen or stock staff,
  // and not for roles that set tables up (they see every area anyway).
  const showAreas =
    Boolean(selectedRole) &&
    !selectedRole!.is_admin &&
    !selectedRole!.permissions.includes("tables.manage") &&
    (selectedRole!.permissions.includes("tables.view") ||
      selectedRole!.permissions.includes("orders.create")) &&
    areas.length > 0;

  useEffect(() => {
    if (!editing) return;
    setError("");
    if (editing === "new") {
      setD({
        name: "",
        staff_code: "",
        phone: "",
        email: "",
        pin: "",
        role:
          roles.find((r) => r.name === "Server" || r.name === "Cashier")?.id ?? roles[0]?.id ?? 0,
        areas: new Set(),
        active: true,
      });
    } else {
      setD({
        name: editing.display_name,
        staff_code: editing.staff_code ?? "",
        phone: editing.phone ?? "",
        email: editing.email ?? "",
        pin: "",
        role: editing.staff_role ?? 0,
        areas: new Set(editing.area_ids),
        active: editing.is_active,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const area_ids = showAreas ? [...d.areas] : [];
      if (editing === "new") {
        await teamApi.createEmployee({
          display_name: d.name.trim(),
          pin: d.pin,
          staff_role: d.role,
          staff_code: d.staff_code.trim() || undefined,
          phone: d.phone.trim() || undefined,
          email: d.email.trim() || undefined,
          area_ids,
        });
        toast.success(`${d.name.trim()} added.`);
      } else if (editing) {
        await teamApi.updateEmployee(editing.id, {
          display_name: d.name.trim(),
          staff_role: d.role,
          staff_code: d.staff_code.trim(),
          phone: d.phone.trim(),
          email: d.email.trim(),
          area_ids,
          is_active: d.active,
          ...(d.pin ? { pin: d.pin } : {}),
        });
        toast.success(`${d.name.trim()} saved.`);
      }
      setEditing(null);
      await qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (employees.isLoading) return <ListSkeleton rows={4} />;
  if (employees.isError)
    return (
      <ErrorBlock message={errorMessage(employees.error)} onRetry={() => employees.refetch()} />
    );
  const list = employees.data ?? [];
  const pinOk =
    editing === "new" ? /^\d{4,8}$/.test(d.pin) : d.pin === "" || /^\d{4,8}$/.test(d.pin);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="h-11" onClick={() => setEditing("new")}>
          <Plus className="h-4 w-4" aria-hidden="true" /> {t.addEmployee}
        </Button>
      </div>
      {list.length === 0 ? (
        <EmptyState icon={UserRound} title={t.noEmployees} body={t.noEmployeesHint} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((e) => (
            <li key={e.id}>
              <div className="flex min-h-[96px] w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/40">
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className={`flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none ${
                    e.is_active ? "" : "opacity-60"
                  }`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
                    {e.display_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold text-foreground">
                        {e.display_name}
                      </span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {e.role_name}
                      </span>
                      {e.is_active ? (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600">
                          {t.active}
                        </span>
                      ) : (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          {t.inactive}
                        </span>
                      )}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">
                        Code: {e.staff_code || "—"}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">
                        PIN: {e.pin || "—"}
                      </span>
                      {e.phone && <span>· {e.phone}</span>}
                      {e.email && <span>· {e.email}</span>}
                    </div>
                    {e.area_ids.length > 0 && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        Areas: {e.area_ids.map(areaName).filter(Boolean).join(", ")}
                      </span>
                    )}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setDeleting(e);
                  }}
                  aria-label={`${t.deleteEmployee} ${e.display_name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(v) => !busy && !v && setEditing(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? t.addEmployee : t.editEmployee}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label={t.name} htmlFor="emp-name">
              <input
                id="emp-name"
                autoFocus
                className={inputCls}
                maxLength={120}
                value={d.name}
                onChange={(e) => setD({ ...d, name: e.target.value })}
              />
            </Field>

            <Field label={t.staffCode} htmlFor="emp-code" hint={t.staffCodeHint}>
              <input
                id="emp-code"
                inputMode="numeric"
                className={inputCls}
                maxLength={10}
                placeholder="e.g. 1001"
                value={d.staff_code}
                onChange={(e) => setD({ ...d, staff_code: e.target.value.replace(/\D/g, "") })}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.phone} htmlFor="emp-phone" hint={t.phoneHint}>
                <input
                  id="emp-phone"
                  type="tel"
                  className={inputCls}
                  maxLength={30}
                  placeholder="e.g. 9800000000"
                  value={d.phone}
                  onChange={(e) => setD({ ...d, phone: e.target.value })}
                />
              </Field>
              <Field label={t.email} htmlFor="emp-email" hint={t.emailHint}>
                <input
                  id="emp-email"
                  type="email"
                  className={inputCls}
                  maxLength={120}
                  placeholder="e.g. staff@zentro.com"
                  value={d.email}
                  onChange={(e) => setD({ ...d, email: e.target.value })}
                />
              </Field>
            </div>

            <Field label={t.pin} htmlFor="emp-pin" hint={editing === "new" ? t.pinHint : t.pinKeep}>
              <input
                id="emp-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                className={inputCls}
                value={d.pin}
                onChange={(e) => setD({ ...d, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })}
              />
            </Field>
            <Field label={t.role} htmlFor="emp-role">
              <select
                id="emp-role"
                className={inputCls}
                value={d.role || ""}
                onChange={(e) => setD({ ...d, role: Number(e.target.value) })}
              >
                <option value="" disabled>
                  {t.choose}
                </option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            {showAreas && (
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-foreground">{t.areas}</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {areas.map((a) => (
                    <label
                      key={a.id}
                      className="flex min-h-[44px] items-center gap-3 rounded-xl border border-border px-3"
                    >
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[var(--primary)]"
                        checked={d.areas.has(a.id)}
                        onChange={(e) => {
                          const next = new Set(d.areas);
                          if (e.target.checked) next.add(a.id);
                          else next.delete(a.id);
                          setD({ ...d, areas: next });
                        }}
                      />
                      <span className="text-sm text-foreground">{a.name}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t.areasHint}</p>
              </fieldset>
            )}
            {editing !== "new" && (
              <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-border px-3">
                <span className="text-sm font-medium text-foreground">{t.active}</span>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--primary)]"
                  checked={d.active}
                  onChange={(e) => setD({ ...d, active: e.target.checked })}
                />
              </label>
            )}
            {error && <ErrorBlock message={error} />}
            <div className="flex gap-2">
              {editing !== "new" && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleting(editing)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="submit"
                className="h-11 flex-1"
                disabled={busy || !d.name.trim() || !d.role || !pinOk}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {t.save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !busy && !v && setDeleting(null)}
        title={`${t.deleteEmployee} · ${deleting?.display_name ?? ""}`}
        body={t.deleteEmployeeConfirm}
        confirmLabel={t.deleteEmployee}
        danger
        busy={busy}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await teamApi.deleteEmployee(deleting.id);
            toast.success(`${deleting.display_name} removed.`);
            setDeleting(null);
            if (editing && editing !== "new" && editing.id === deleting.id) {
              setEditing(null);
            }
            await qc.invalidateQueries({ queryKey: ["team"] });
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function TeamPage() {
  const { can } = useAccess();
  const tabs = [
    ...(can("staff.manage") ? [{ value: "employees" as const, label: t.employees }] : []),
    ...(can("roles.manage") ? [{ value: "roles" as const, label: t.roles }] : []),
  ];
  const [tab, setTab] = useState<"employees" | "roles">("employees");
  const active = tabs.some((x) => x.value === tab) ? tab : tabs[0]?.value;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose what each employee can do and where they work.
        </p>
      </div>
      {tabs.length > 1 && (
        <FilterChips
          label={t.title}
          value={active ?? "employees"}
          options={tabs}
          onChange={setTab}
        />
      )}
      {active === "employees" && <EmployeesTab />}
      {active === "roles" && <RolesTab />}
    </div>
  );
}
