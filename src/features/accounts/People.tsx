// src/features/accounts/People.tsx
// Accounts → Suppliers (what is owed for deliveries) and Salaries.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Plus, Truck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorBlock,
  Field,
  ListSkeleton,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import {
  financeApi,
  type FinanceSettings,
  type MoneyEntry,
  type Salary,
  type SupplierRow,
} from "@/lib/api/finance";
import {
  EntryDialog,
  Figure,
  Panel,
  QK,
  VoidDialog,
  fmtDay,
  money,
  todayIso,
  type EntryPreset,
} from "./shared";

interface TabProps {
  symbol: string;
  settings: FinanceSettings | undefined;
  canManage: boolean;
}

function PaymentList({
  payments,
  symbol,
  canManage,
  onVoid,
}: {
  payments: MoneyEntry[];
  symbol: string;
  canManage: boolean;
  onVoid: (entry: MoneyEntry) => void;
}) {
  if (payments.length === 0) {
    return <p className="px-4 py-4 text-sm text-muted-foreground">No payments recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className={`text-sm font-medium ${p.is_void ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {fmtDay(p.date)} · {p.payment_method_label}
            </p>
            <p className="text-xs text-muted-foreground">
              {[p.reference, p.note, p.created_by && `by ${p.created_by}`].filter(Boolean).join(" · ")}
              {p.is_void && ` · Cancelled by ${p.voided_by}: ${p.void_reason}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`numeric text-sm font-semibold ${p.is_void ? "text-muted-foreground line-through" : "text-foreground"}`}>
              {money(p.amount, symbol)}
            </span>
            {canManage && !p.is_void && (
              <button
                type="button"
                onClick={() => onVoid(p)}
                className="min-h-[40px] rounded-lg px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Cancel
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Suppliers ────────────────────────────────────────────────────────────────

export function SuppliersTab({ symbol, settings, canManage }: TabProps) {
  const list = useQuery({ queryKey: [QK, "suppliers"], queryFn: financeApi.suppliers });
  const [openId, setOpenId] = useState<number | null>(null);
  const [paying, setPaying] = useState<EntryPreset | null>(null);

  if (list.isLoading) return <ListSkeleton rows={4} />;
  if (list.isError || !list.data) {
    return <ErrorBlock message={errorMessage(list.error, "Could not load suppliers.")} onRetry={() => list.refetch()} />;
  }
  const { rows } = list.data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure label="Bought from suppliers" value={money(list.data.purchase_amount, symbol)} hint="All deliveries recorded in Inventory" />
        <Figure label="Paid to suppliers" value={money(list.data.amount_paid, symbol)} />
        <Figure label="Still to pay" value={money(list.data.outstanding, symbol)} tone={Number(list.data.outstanding) > 0 ? "out" : undefined} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No suppliers yet"
          body="Add suppliers and record deliveries in Inventory. What you owe each supplier shows here."
        />
      ) : (
        <Panel
          title="Suppliers"
          action={
            canManage && (
              <Button
                size="sm"
                className="h-10"
                onClick={() =>
                  setPaying({
                    kind: "supplier_payment",
                    suppliers: rows.map((r) => ({ id: r.id, name: r.name })),
                  })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Pay a supplier
              </Button>
            )
          }
        >
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <SupplierLine key={s.id} supplier={s} symbol={symbol} onOpen={() => setOpenId(s.id)} />
            ))}
          </ul>
        </Panel>
      )}

      {openId !== null && (
        <SupplierDialog
          id={openId}
          symbol={symbol}
          canManage={canManage}
          onClose={() => setOpenId(null)}
          onPay={setPaying}
        />
      )}
      {paying && (
        <EntryDialog preset={paying} settings={settings} symbol={symbol} onClose={() => setPaying(null)} />
      )}
    </div>
  );
}

function SupplierLine({ supplier: s, symbol, onOpen }: { supplier: SupplierRow; symbol: string; onOpen: () => void }) {
  const owed = Number(s.outstanding);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
          <p className="text-xs text-muted-foreground">
            Bought {money(s.purchase_amount, symbol)} · Paid {money(s.amount_paid, symbol)}
            {s.last_payment ? ` · Last paid ${fmtDay(s.last_payment)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p className={`numeric text-sm font-semibold ${owed > 0 ? "text-destructive" : "text-foreground"}`}>
              {money(Math.abs(owed), symbol)}
            </p>
            <p className="text-xs text-muted-foreground">
              {owed > 0 ? "to pay" : owed < 0 ? "paid in advance" : "all paid"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </button>
    </li>
  );
}

function SupplierDialog({
  id,
  symbol,
  canManage,
  onClose,
  onPay,
}: {
  id: number;
  symbol: string;
  canManage: boolean;
  onClose: () => void;
  onPay: (preset: EntryPreset) => void;
}) {
  const detail = useQuery({ queryKey: [QK, "supplier", id], queryFn: () => financeApi.supplier(id) });
  const [voiding, setVoiding] = useState<MoneyEntry | null>(null);
  const d = detail.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{d?.name ?? "Supplier"}</DialogTitle>
          <DialogDescription>
            {d?.payment_terms ? `Payment terms: ${d.payment_terms}` : "Deliveries and payments for this supplier."}
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading && <ListSkeleton rows={3} />}
        {detail.isError && (
          <ErrorBlock message={errorMessage(detail.error, "Could not load this supplier.")} onRetry={() => detail.refetch()} />
        )}
        {d && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Figure label="Bought" value={money(d.purchase_amount, symbol)} />
              <Figure label="Paid" value={money(d.amount_paid, symbol)} />
              <Figure label="To pay" value={money(d.outstanding, symbol)} tone={Number(d.outstanding) > 0 ? "out" : undefined} />
            </div>
            {canManage && (
              <Button
                className="h-11 w-full"
                onClick={() =>
                  onPay({
                    kind: "supplier_payment",
                    subject: `Paying ${d.name}`,
                    supplierId: d.id,
                    amount: Number(d.outstanding) > 0 ? d.outstanding : "",
                    receivings: d.purchases
                      .filter((p) => Number(p.outstanding) > 0)
                      .map((p) => ({
                        id: p.id,
                        label: `${p.receipt_number} · ${fmtDay(p.date)}`,
                        outstanding: p.outstanding,
                      })),
                  })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" /> Record a payment
              </Button>
            )}
            <Panel title="Deliveries (purchases)">
              {d.purchases.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">No deliveries from this supplier yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.purchases.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {p.receipt_number} · {fmtDay(p.date)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p.reference ? `${p.reference} · ` : ""}Paid {money(p.paid, symbol)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="numeric text-sm font-semibold text-foreground">{money(p.amount, symbol)}</p>
                        <p className={`text-xs ${Number(p.outstanding) > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {Number(p.outstanding) > 0 ? `${money(p.outstanding, symbol)} unpaid` : "Paid"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Payment history">
              <PaymentList payments={d.payments} symbol={symbol} canManage={canManage} onVoid={setVoiding} />
            </Panel>
          </div>
        )}
        {voiding && (
          <VoidDialog
            entryId={voiding.id}
            label={`Payment of ${money(voiding.amount, symbol)} on ${fmtDay(voiding.date)}`}
            onClose={() => setVoiding(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Salaries ─────────────────────────────────────────────────────────────────

const STATUS_TEXT: Record<Salary["status"], { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-success/10 text-success" },
  partial: { label: "Part paid", cls: "bg-amber-100 text-amber-800" },
  unpaid: { label: "Not paid", cls: "bg-destructive/10 text-destructive" },
};

const thisMonth = () => todayIso().slice(0, 7);

export function SalariesTab({ symbol, settings, canManage }: TabProps) {
  const [month, setMonth] = useState("");
  const list = useQuery({ queryKey: [QK, "salaries", month], queryFn: () => financeApi.salaries(month || undefined) });
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<EntryPreset | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<MoneyEntry | null>(null);
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => financeApi.deleteSalary(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success("Salary removed");
    },
    onError: (e) => toast.error(errorMessage(e, "Could not remove this salary.")),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Month" htmlFor="acc-salary-month" className="w-44">
          <input
            id="acc-salary-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputCls}
          />
        </Field>
        <div className="flex gap-2">
          {month && (
            <Button variant="outline" className="h-11" onClick={() => setMonth("")}>
              All months
            </Button>
          )}
          {canManage && (
            <Button className="h-11" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add salary
            </Button>
          )}
        </div>
      </div>

      {list.isLoading && <ListSkeleton rows={4} />}
      {list.isError && (
        <ErrorBlock message={errorMessage(list.error, "Could not load salaries.")} onRetry={() => list.refetch()} />
      )}
      {list.data && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Figure label="Salaries" value={money(list.data.amount, symbol)} />
            <Figure label="Paid" value={money(list.data.paid, symbol)} />
            <Figure label="Still to pay" value={money(list.data.outstanding, symbol)} tone={Number(list.data.outstanding) > 0 ? "out" : undefined} />
          </div>
          {list.data.rows.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title="No salaries recorded"
              body="Add what each employee is owed for a month, then record payments as you make them."
            />
          ) : (
            <Panel title="Salary records">
              <ul className="divide-y divide-border">
                {list.data.rows.map((s) => {
                  const open = openId === s.id;
                  const status = STATUS_TEXT[s.status];
                  return (
                    <li key={s.id}>
                      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : s.id)}
                          aria-expanded={open}
                          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                            {s.worker_name}
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${status.cls}`}>{status.label}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.period_label} · Salary {money(s.amount, symbol)} · Paid {money(s.paid, symbol)}
                            {s.last_payment_date ? ` · Last paid ${fmtDay(s.last_payment_date)} (${s.last_payment_method})` : ""}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          {Number(s.outstanding) > 0 && (
                            <span className="numeric text-sm font-semibold text-destructive">
                              {money(s.outstanding, symbol)} to pay
                            </span>
                          )}
                          {canManage && Number(s.outstanding) > 0 && (
                            <Button
                              size="sm"
                              className="h-10"
                              onClick={() =>
                                setPaying({
                                  kind: "salary_payment",
                                  subject: `${s.worker_name} · ${s.period_label}`,
                                  salaryId: s.id,
                                  amount: s.outstanding,
                                })
                              }
                            >
                              Pay
                            </Button>
                          )}
                        </div>
                      </div>
                      {open && (
                        <div className="border-t border-border bg-muted/30">
                          <PaymentList payments={s.payments ?? []} symbol={symbol} canManage={canManage} onVoid={setVoiding} />
                          {canManage && (s.payments ?? []).length === 0 && (
                            <div className="px-4 pb-3">
                              <button
                                type="button"
                                onClick={() => {
                                  if (window.confirm(`Remove the ${s.period_label} salary for ${s.worker_name}?`)) remove.mutate(s.id);
                                }}
                                className="min-h-[40px] rounded-lg px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                              >
                                Remove this salary record
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </>
      )}

      {adding && <SalaryDialog symbol={symbol} defaultMonth={month || thisMonth()} onClose={() => setAdding(false)} />}
      {paying && <EntryDialog preset={paying} settings={settings} symbol={symbol} onClose={() => setPaying(null)} />}
      {voiding && (
        <VoidDialog
          entryId={voiding.id}
          label={`Salary payment of ${money(voiding.amount, symbol)} on ${fmtDay(voiding.date)}`}
          onClose={() => setVoiding(null)}
        />
      )}
    </div>
  );
}

function SalaryDialog({ symbol, defaultMonth, onClose }: { symbol: string; defaultMonth: string; onClose: () => void }) {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: [QK, "salary-staff"], queryFn: financeApi.salaryStaff });
  const [workerId, setWorkerId] = useState("");
  const [period, setPeriod] = useState(defaultMonth);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => financeApi.createSalary({ worker_id: workerId, period, amount, note: note.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success("Salary added");
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Could not save the salary.")),
  });
  const ready = Boolean(workerId) && Boolean(period) && Number(amount) > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add salary</DialogTitle>
          <DialogDescription>What an employee is owed for one month. Record payments against it afterwards.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (ready && !save.isPending) save.mutate();
          }}
        >
          <Field label="Employee" htmlFor="acc-sal-worker">
            <select
              id="acc-sal-worker"
              value={workerId}
              onChange={(e) => {
                setWorkerId(e.target.value);
                const last = staff.data?.find((w) => w.id === e.target.value)?.last_salary;
                if (last && !amount) setAmount(last);
              }}
              className={inputCls}
            >
              <option value="">{staff.isLoading ? "Loading…" : "Choose an employee"}</option>
              {(staff.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.is_active ? "" : " (not active)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Month" htmlFor="acc-sal-period">
            <input id="acc-sal-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className={inputCls} />
          </Field>
          <Field label={`Salary amount (${symbol})`} htmlFor="acc-sal-amount">
            <input
              id="acc-sal-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Note" optional htmlFor="acc-sal-note">
            <input id="acc-sal-note" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 flex-1" disabled={!ready || save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save salary
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
