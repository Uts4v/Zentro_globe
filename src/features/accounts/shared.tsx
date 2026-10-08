// src/features/accounts/shared.tsx
// Small pieces shared by the Accounts tabs: period handling, money and date
// formatting, the "record money" form and the cancel-a-record form.
import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, errorMessage, inputCls } from "@/features/inventory/components/bits";
import { safeUuid } from "@/lib/utils";
import {
  financeApi,
  type EntryKind,
  type EntryMethod,
  type FinanceSettings,
  type Period,
} from "@/lib/api/finance";

export const QK = "accounts";

// ── Dates ────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDay(new Date());

/** "2026-10-08" as a local date (never shifted by the timezone). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export type PresetKey = "today" | "week" | "month" | "last30" | "custom";

export const PRESETS: { value: PresetKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Choose dates" },
];

export function presetPeriod(key: Exclude<PresetKey, "custom">): Period {
  const now = new Date();
  const to = isoDay(now);
  if (key === "today") return { from: to, to };
  if (key === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    return { from: isoDay(start), to };
  }
  if (key === "month") return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  const start = new Date(now);
  start.setDate(now.getDate() - 29);
  return { from: isoDay(start), to };
}

// ── Money ────────────────────────────────────────────────────────────────────

export function money(value: string | number | null | undefined, symbol: string): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(Number.isFinite(n) ? n : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}${symbol} ${abs}`;
}

/** A figure with its label; `tone` colours money in / out without relying on colour alone. */
export function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "in" | "out";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`numeric mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl ${
          tone === "in" ? "text-success" : tone === "out" ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Record money ─────────────────────────────────────────────────────────────

const KIND_TEXT: Record<EntryKind, { title: string; hint: string; save: string }> = {
  expense: {
    title: "Add an expense",
    hint: "Money the business spent, like rent, electricity or supplies.",
    save: "Save expense",
  },
  supplier_payment: {
    title: "Pay a supplier",
    hint: "Record money paid to a supplier for goods received.",
    save: "Save payment",
  },
  salary_payment: {
    title: "Pay salary",
    hint: "Record a salary payment to an employee.",
    save: "Save payment",
  },
  other_income: {
    title: "Add other income",
    hint: "Money that came in but was not a sale at the POS.",
    save: "Save income",
  },
  bank_deposit: {
    title: "Put cash in the bank",
    hint: "Cash leaves the drawer and is added to the bank balance.",
    save: "Save",
  },
  bank_withdrawal: {
    title: "Take cash from the bank",
    hint: "Money leaves the bank and is added to the cash drawer.",
    save: "Save",
  },
};

export interface EntryPreset {
  kind: EntryKind;
  /** Fixed context shown at the top, e.g. the supplier or employee being paid. */
  subject?: string;
  supplierId?: number;
  receivingId?: number;
  salaryId?: number;
  /** Suggested amount (what is still owed). */
  amount?: string;
  /** Deliveries of this supplier the payment can be linked to. */
  receivings?: { id: number; label: string; outstanding: string }[];
  /** Suppliers to choose from when none is fixed. */
  suppliers?: { id: number; name: string }[];
}

export function EntryDialog({
  preset,
  settings,
  symbol,
  onClose,
}: {
  preset: EntryPreset;
  settings: FinanceSettings | undefined;
  symbol: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const text = KIND_TEXT[preset.kind];
  const isTransfer = preset.kind === "bank_deposit" || preset.kind === "bank_withdrawal";
  const [amount, setAmount] = useState(preset.amount ?? "");
  const [date, setDate] = useState(todayIso());
  const [method, setMethod] = useState<EntryMethod>("cash");
  const [category, setCategory] = useState("other");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [supplierId, setSupplierId] = useState<number | "">(preset.supplierId ?? "");
  const [receivingId, setReceivingId] = useState<number | "">(preset.receivingId ?? "");
  const [clientKey] = useState(() => safeUuid());
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      financeApi.createEntry({
        kind: preset.kind,
        amount,
        date,
        payment_method: isTransfer ? undefined : method,
        category: preset.kind === "expense" ? category : undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        supplier_id: preset.kind === "supplier_payment" && supplierId ? supplierId : undefined,
        receiving_id: preset.kind === "supplier_payment" && receivingId ? receivingId : undefined,
        salary_id: preset.salaryId,
        client_key: clientKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success("Saved");
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Could not save. Try again.")),
  });

  const amountOk = Number(amount) > 0;
  const supplierOk = preset.kind !== "supplier_payment" || Boolean(supplierId);

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>{preset.subject ?? text.hint}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (amountOk && supplierOk && !save.isPending) save.mutate();
          }}
        >
          {preset.kind === "supplier_payment" && !preset.supplierId && (
            <Field label="Supplier" htmlFor="acc-supplier">
              <select
                id="acc-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : "")}
                className={inputCls}
              >
                <option value="">Choose a supplier</option>
                {(preset.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {preset.kind === "supplier_payment" && (preset.receivings?.length ?? 0) > 0 && (
            <Field label="For which delivery" optional htmlFor="acc-receiving">
              <select
                id="acc-receiving"
                value={receivingId}
                onChange={(e) => setReceivingId(e.target.value ? Number(e.target.value) : "")}
                className={inputCls}
              >
                <option value="">Not for one delivery</option>
                {(preset.receivings ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {money(r.outstanding, symbol)} unpaid
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={`Amount (${symbol})`} htmlFor="acc-amount">
            <input
              id="acc-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls}
            />
          </Field>
          {preset.kind === "expense" && (
            <Field label="What was it for" htmlFor="acc-category">
              <select
                id="acc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className={inputCls}
              >
                {(settings?.expense_categories ?? [{ key: "other", label: "Other" }]).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {!isTransfer && (
            <Field
              label={preset.kind === "other_income" ? "How it was received" : "How it was paid"}
              htmlFor="acc-method"
              hint={
                method === "cash"
                  ? "Counted in the cash drawer."
                  : "Counted in the bank balance."
              }
            >
              <select
                id="acc-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as EntryMethod)}
                className={inputCls}
              >
                {(settings?.payment_methods ?? [{ key: "cash" as EntryMethod, label: "Cash" }]).map(
                  (m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ),
                )}
              </select>
            </Field>
          )}
          <Field label="Date" htmlFor="acc-date">
            <input
              id="acc-date"
              type="date"
              max={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Reference" optional htmlFor="acc-ref" hint="Bill, cheque or transfer number.">
            <input
              id="acc-ref"
              value={reference}
              maxLength={120}
              onChange={(e) => setReference(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Note" optional htmlFor="acc-note">
            <input
              id="acc-note"
              value={note}
              maxLength={255}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
            />
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
            <Button
              type="submit"
              className="h-11 flex-1"
              disabled={!amountOk || !supplierOk || save.isPending}
            >
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {text.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Money records are never deleted: a mistake is cancelled with a reason. */
export function VoidDialog({
  entryId,
  label,
  onClose,
}: {
  entryId: number;
  label: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const cancel = useMutation({
    mutationFn: () => financeApi.voidEntry(entryId, reason.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success("Record cancelled");
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Could not cancel this record.")),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !cancel.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this record?</DialogTitle>
          <DialogDescription>
            {label}. It stops counting in the balances but stays in the history with your reason.
          </DialogDescription>
        </DialogHeader>
        <Field label="Why is it being cancelled" htmlFor="acc-void-reason">
          <input
            id="acc-void-reason"
            autoFocus
            value={reason}
            maxLength={255}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered twice"
            className={inputCls}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClose}>
            Keep it
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 flex-1"
            disabled={!reason.trim() || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel record
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
