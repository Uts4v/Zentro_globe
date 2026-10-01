// src/features/team/StaffMode.tsx
// Hand a shared device to an employee. The server then applies that
// employee's role to every request. Leaving needs the owner password or the
// PIN of someone who manages employees.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, UserRound } from "lucide-react";
import { teamApi } from "@/lib/api";
import { staffSession } from "@/lib/staff-session";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBlock, Field, errorMessage, inputCls } from "@/features/inventory/components/bits";

const s = {
  start: "Hand to Staff",
  startHint: "Staff see only what their role allows.",
  who: "Who is using this device?",
  pin: "PIN",
  enter: "Start",
  banner: (name: string, role: string) => `Staff mode · ${name} (${role})`,
  exit: "Exit Staff Mode",
  exitHint: "Enter the owner password, or a manager's PIN.",
  password: "Owner password",
  orManager: "Or a manager",
  managerPin: "Manager PIN",
  choose: "Choose…",
  none: "No employees yet. Add employees under Team.",
};

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

export function StartStaffModeButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const workers = useQuery({
    queryKey: ["staff-picker"],
    queryFn: teamApi.staffWorkers,
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
      const res = await teamApi.startStaffSession(worker, pin);
      staffSession.set({ token: res.token, name: res.worker?.name ?? "", role: res.role.name });
      setPin("");
      setOpen(false);
      qc.clear();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
        <UserRound className="h-4 w-4" aria-hidden="true" /> {s.start}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{s.start}</DialogTitle>
            <DialogDescription>{s.startHint}</DialogDescription>
          </DialogHeader>
          {workers.data && workers.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.none}</p>
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
                    {s.choose}
                  </option>
                  {workers.data?.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} · {w.role_name}
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
                  onChange={(e) => setPin(digits(e.target.value))}
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
    </>
  );
}

export function StaffBanner({ name, role }: { name: string; role: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const managers = useQuery({
    queryKey: ["staff-picker", "unlock"],
    queryFn: teamApi.staffWorkers,
    enabled: open,
  });

  async function exit() {
    setBusy(true);
    setError("");
    try {
      await teamApi.endStaffSession(
        password ? { password } : { worker_id: managerId, pin: managerPin },
      );
      staffSession.set(null);
      setOpen(false);
      setPassword("");
      setManagerPin("");
      qc.clear();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/20 bg-primary/5 px-4 py-2 lg:px-8">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <UserRound className="h-4 w-4 text-primary" aria-hidden="true" /> {s.banner(name, role)}
        </span>
        <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> {s.exit}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{s.exit}</DialogTitle>
            <DialogDescription>{s.exitHint}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              exit();
            }}
          >
            <Field label={s.password} htmlFor="exit-password">
              <input
                id="exit-password"
                type="password"
                autoComplete="current-password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {(managers.data?.filter((w) => w.can_unlock).length ?? 0) > 0 && (
              <div className="grid gap-3">
                <p className="text-sm font-medium text-foreground">{s.orManager}</p>
                <select
                  aria-label={s.orManager}
                  className={inputCls}
                  value={managerId}
                  onChange={(e) => setManagerId(e.target.value)}
                >
                  <option value="">{s.choose}</option>
                  {managers.data
                    ?.filter((w) => w.can_unlock)
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
                  onChange={(e) => setManagerPin(digits(e.target.value))}
                />
              </div>
            )}
            {error && <ErrorBlock message={error} />}
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={busy || (!password && !(managerId && managerPin))}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {s.exit}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
