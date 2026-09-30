// src/features/inventory/components/StaffMode.tsx
// Hand a shared device to a staff member. The backend then enforces that
// worker's role on every inventory request. Leaving needs the owner
// password or a manager PIN.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, LogOut, UserRound } from "lucide-react";
import { inventoryApi, staffSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBlock, Field, errorMessage, inputCls } from "@/features/inventory/components/bits";
import { copy } from "@/features/inventory/copy";
import { QK } from "@/features/inventory/context";

const s = copy.staff;

export function StartStaffModeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const workers = useQuery({
    queryKey: ["inventory", "staff-workers"],
    queryFn: inventoryApi.staffWorkers,
    enabled: open,
  });
  const [worker, setWorker] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.startStaffSession(worker, pin);
      staffSession.set({ token: res.token, name: res.staff.name, role: res.role });
      qc.invalidateQueries({ queryKey: QK.all });
      setPin("");
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s.start}</DialogTitle>
          <DialogDescription>{s.startHint}</DialogDescription>
        </DialogHeader>
        {workers.data && workers.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noWorkers}</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (worker && pin) start();
            }}
          >
            <Field label={s.who} htmlFor="staff-worker">
              <select
                id="staff-worker"
                className={inputCls}
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
              >
                <option value="" disabled>
                  {copy.itemForm.choose}
                </option>
                {workers.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={s.pin} htmlFor="staff-pin">
              <input
                id="staff-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className={inputCls}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </Field>
            {error && <ErrorBlock message={error} />}
            <Button type="submit" className="h-11 w-full" disabled={busy || !worker || !pin}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {s.enter}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffBanner({ name }: { name: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [managerId, setManagerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // In staff mode the backend lists only managers/admins.
  const workers = useQuery({
    queryKey: ["inventory", "staff-workers-exit"],
    queryFn: inventoryApi.staffWorkers,
    enabled: false,
  });

  async function exit() {
    setBusy(true);
    setError("");
    try {
      await inventoryApi.endStaffSession(
        password ? { password } : { worker_id: managerId, pin: managerPin },
      );
      staffSession.set(null);
      qc.invalidateQueries({ queryKey: QK.all });
      setOpen(false);
      setPassword("");
      setManagerPin("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <UserRound className="h-4 w-4 text-primary" aria-hidden="true" /> {s.banner(name)}
        </span>
        <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> {s.exit}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{s.exitTitle}</DialogTitle>
            <DialogDescription>{s.exitHint}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              exit();
            }}
          >
            <Field label={s.ownerPassword} htmlFor="exit-password">
              <input
                id="exit-password"
                type="password"
                autoComplete="current-password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <details
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open && !workers.data) workers.refetch();
              }}
            >
              <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-medium text-foreground">
                {s.orManager}
              </summary>
              <div className="mt-2 grid gap-3">
                <select
                  aria-label={s.orManager}
                  className={inputCls}
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                >
                  <option value="">{copy.itemForm.choose}</option>
                  {workers.data
                    ?.filter((w) => w.role === "manager" || w.role === "admin")
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
                <input
                  aria-label={s.managerPin}
                  placeholder={s.managerPin}
                  type="password"
                  inputMode="numeric"
                  className={inputCls}
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                />
              </div>
            </details>
            {error && <ErrorBlock message={error} />}
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={busy || (!password && !(managerId && managerPin))}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {s.exitButton}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function notifyStaffEnded() {
  toast.error(s.ended);
}
