// src/features/accounts/AccountsPage.tsx
// Merchant → Accounts: one place to see money in, money out and what is owed.
//   Overview · Cash · Online payments · Bank · Suppliers · Salaries · Expenses
// Sales come from the POS payment records; this page only adds what the POS
// does not know (expenses, supplier and salary payments, bank transfers).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Loader2, Plus, ReceiptText, Settings2 } from "lucide-react";
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
  FilterChips,
  ListSkeleton,
  ScreenHeader,
  errorMessage,
  inputCls,
} from "@/features/inventory/components/bits";
import {
  financeApi,
  type Book,
  type EntryKind,
  type FinanceSettings,
  type FinanceSummary,
  type Period,
} from "@/lib/api/finance";
import { SalariesTab, SuppliersTab } from "./People";
import {
  EntryDialog,
  Figure,
  PRESETS,
  Panel,
  QK,
  VoidDialog,
  fmtDay,
  money,
  presetPeriod,
  todayIso,
  type EntryPreset,
  type PresetKey,
} from "./shared";

type Tab = "overview" | "cash" | "online" | "bank" | "suppliers" | "salaries" | "expenses";

const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "cash", label: "Cash" },
  { value: "online", label: "Online payments" },
  { value: "bank", label: "Bank" },
  { value: "suppliers", label: "Suppliers" },
  { value: "salaries", label: "Salaries" },
  { value: "expenses", label: "Expenses" },
];

export function AccountsPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<PresetKey>("month");
  const [custom, setCustom] = useState<Period>(() => presetPeriod("month"));
  const period = preset === "custom" ? custom : presetPeriod(preset);
  const settings = useQuery({ queryKey: [QK, "settings"], queryFn: financeApi.settings });
  const summary = useQuery({
    queryKey: [QK, "summary", period.from, period.to],
    queryFn: () => financeApi.summary(period),
  });
  const symbol = summary.data?.currency_symbol ?? "Rs";
  const canManage = settings.data?.can_manage ?? false;
  const [entry, setEntry] = useState<EntryPreset | null>(null);
  const [showOpening, setShowOpening] = useState(false);
  const usesPeriod = tab !== "suppliers" && tab !== "salaries";
  const record = (kind: EntryKind) => setEntry({ kind });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <ScreenHeader
        title="Accounts"
        subtitle="Money in, money out and what you still owe."
        action={
          canManage && (
            <Button variant="outline" className="h-11" onClick={() => setShowOpening(true)}>
              <Settings2 className="mr-1.5 h-4 w-4" /> Opening balances
            </Button>
          )
        }
      />

      <FilterChips label="Section" value={tab} options={TABS} onChange={setTab} />

      {usesPeriod && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
          <FilterChips label="Period" value={preset} options={PRESETS} onChange={setPreset} />
          {preset === "custom" && (
            <div className="flex flex-wrap gap-3">
              <Field label="From" htmlFor="acc-from" className="w-44">
                <input
                  id="acc-from"
                  type="date"
                  max={custom.to}
                  value={custom.from}
                  onChange={(e) => e.target.value && setCustom((p) => ({ ...p, from: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="To" htmlFor="acc-to" className="w-44">
                <input
                  id="acc-to"
                  type="date"
                  min={custom.from}
                  max={todayIso()}
                  value={custom.to}
                  onChange={(e) => e.target.value && setCustom((p) => ({ ...p, to: e.target.value }))}
                  className={inputCls}
                />
              </Field>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Showing {fmtDay(period.from)} to {fmtDay(period.to)}
          </p>
        </div>
      )}

      {tab === "overview" &&
        (summary.isLoading ? (
          <ListSkeleton rows={5} />
        ) : summary.isError || !summary.data ? (
          <ErrorBlock
            message={errorMessage(summary.error, "Could not load the accounts.")}
            onRetry={() => summary.refetch()}
          />
        ) : (
          <Overview data={summary.data} symbol={symbol} canManage={canManage} onRecord={record} />
        ))}
      {tab === "cash" && (
        <BookTab account="cash" period={period} symbol={symbol} canManage={canManage} onRecord={record} />
      )}
      {tab === "bank" && (
        <BookTab account="bank" period={period} symbol={symbol} canManage={canManage} onRecord={record} />
      )}
      {tab === "online" && <OnlineTab period={period} symbol={symbol} />}
      {tab === "suppliers" && (
        <SuppliersTab symbol={symbol} settings={settings.data} canManage={canManage} />
      )}
      {tab === "salaries" && (
        <SalariesTab symbol={symbol} settings={settings.data} canManage={canManage} />
      )}
      {tab === "expenses" && (
        <ExpensesTab period={period} symbol={symbol} canManage={canManage} onRecord={record} />
      )}

      {entry && (
        <EntryDialog preset={entry} settings={settings.data} symbol={symbol} onClose={() => setEntry(null)} />
      )}
      {showOpening && settings.data && (
        <OpeningDialog settings={settings.data} symbol={symbol} onClose={() => setShowOpening(false)} />
      )}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p className="numeric shrink-0 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function Overview({
  data,
  symbol,
  canManage,
  onRecord,
}: {
  data: FinanceSummary;
  symbol: string;
  canManage: boolean;
  onRecord: (kind: EntryKind) => void;
}) {
  const m = (v: string | number) => money(v, symbol);
  const days = data.daily.filter((d) => d.sales !== 0 || d.out !== 0).reverse();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Total sales" value={m(data.sales.total)} hint={`${data.sales.orders} orders`} />
        <Figure label="Cash sales" value={m(data.sales.cash)} />
        <Figure label="Online sales" value={m(data.sales.online)} hint="Card, QR and wallet" />
        <Figure
          label="Left after costs"
          value={m(data.net)}
          tone={Number(data.net) >= 0 ? "in" : "out"}
          hint="Sales and other income, less refunds and everything paid out"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="Cash in the drawer now" value={m(data.balances.cash)} />
        <Figure label="In the bank now" value={m(data.balances.bank)} />
        <Figure
          label="Owed to suppliers"
          value={m(data.owed.suppliers)}
          tone={Number(data.owed.suppliers) > 0 ? "out" : undefined}
        />
        <Figure
          label="Salaries still to pay"
          value={m(data.owed.salaries)}
          tone={Number(data.owed.salaries) > 0 ? "out" : undefined}
        />
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11" onClick={() => onRecord("expense")}>
            <Plus className="mr-1.5 h-4 w-4" /> Add expense
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onRecord("bank_deposit")}>
            Put cash in the bank
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onRecord("other_income")}>
            Add other income
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Money in">
          <div className="divide-y divide-border">
            {data.sales.by_method.map((row) => (
              <Line key={row.key} label={`${row.label} sales`} value={m(row.amount)} />
            ))}
            {data.sales.by_method.length === 0 && (
              <p className="px-4 py-3 text-sm text-muted-foreground">No sales in this period.</p>
            )}
            {Number(data.sales.on_account) > 0 && (
              <Line
                label="Of which on credit or prepaid"
                value={m(data.sales.on_account)}
                hint="Counted as sales, but no money was taken at the till"
              />
            )}
            <Line label="Other income" value={m(data.other_income)} />
          </div>
        </Panel>
        <Panel title="Money out">
          <div className="divide-y divide-border">
            <Line label="Expenses" value={m(data.money_out.expenses)} />
            <Line label="Supplier payments" value={m(data.money_out.supplier_payments)} />
            <Line label="Staff salaries" value={m(data.money_out.salaries)} />
            <Line label="Refunds" value={m(data.money_out.refunds)} />
            <Line label="Cash paid out at the POS" value={m(data.money_out.pos_payouts)} />
            <Line label="Total money out" value={m(data.money_out.total)} />
          </div>
        </Panel>
        <Panel title="Given away and collected for tax">
          <div className="divide-y divide-border">
            <Line label="Discounts given" value={m(data.discounts)} />
            <Line
              label="Free items given"
              value={m(data.free_items_value)}
              hint={`${data.free_items_count} item${data.free_items_count === 1 ? "" : "s"}`}
            />
            <Line label="Tax collected on sales" value={m(data.tax_collected)} hint="Included in total sales" />
          </div>
        </Panel>
        <Panel title="Bank transfers">
          <div className="divide-y divide-border">
            <Line label="Cash put in the bank" value={m(data.bank_deposits)} />
            <Line label="Cash taken from the bank" value={m(data.bank_withdrawals)} />
          </div>
        </Panel>
      </div>

      <Panel title="Day by day">
        {days.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nothing recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[26rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">Day</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Sales</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Money out</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {days.map((d) => (
                  <tr key={d.date}>
                    <td className="px-4 py-2.5 text-foreground">{fmtDay(d.date)}</td>
                    <td className="numeric px-4 py-2.5 text-right">{m(d.sales)}</td>
                    <td className="numeric px-4 py-2.5 text-right">{m(d.out)}</td>
                    <td className={`numeric px-4 py-2.5 text-right font-semibold ${d.sales - d.out < 0 ? "text-destructive" : "text-foreground"}`}>
                      {m(d.sales - d.out)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        “Left after costs” is money in less money out for the period. It is not a full profit
        figure: the cost of stock used is counted when you pay the supplier, not when the item
        is sold.
      </p>
    </div>
  );
}

// ── Cash book / Bank book ────────────────────────────────────────────────────

function BookTab({
  account,
  period,
  symbol,
  canManage,
  onRecord,
}: {
  account: "cash" | "bank";
  period: Period;
  symbol: string;
  canManage: boolean;
  onRecord: (kind: EntryKind) => void;
}) {
  const book = useQuery<Book>({
    queryKey: [QK, account, period.from, period.to],
    queryFn: () => (account === "cash" ? financeApi.cash(period) : financeApi.bank(period)),
  });
  const [voiding, setVoiding] = useState<{ id: number; label: string } | null>(null);
  const m = (v: string | number) => money(v, symbol);

  if (book.isLoading) return <ListSkeleton rows={5} />;
  if (book.isError || !book.data) {
    return <ErrorBlock message={errorMessage(book.error, "Could not load this.")} onRetry={() => book.refetch()} />;
  }
  const b = book.data;
  const isCash = account === "cash";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure label="At the start" value={m(b.opening_balance)} hint={`Before ${fmtDay(b.date_from)}`} />
        <Figure label="Money in" value={m(b.money_in)} tone="in" />
        <Figure label="Money out" value={m(b.money_out)} tone="out" />
        <Figure
          label={isCash ? "Cash balance" : "Bank balance"}
          value={m(b.closing_balance)}
          hint={`At the end of ${fmtDay(b.date_to)}`}
        />
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button className="h-11" onClick={() => onRecord(isCash ? "bank_deposit" : "bank_withdrawal")}>
            {isCash ? "Put cash in the bank" : "Take cash from the bank"}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onRecord(isCash ? "bank_withdrawal" : "bank_deposit")}>
            {isCash ? "Take cash from the bank" : "Put cash in the bank"}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onRecord("expense")}>
            Add expense
          </Button>
          <Button variant="outline" className="h-11" onClick={() => onRecord("other_income")}>
            Add other income
          </Button>
        </div>
      )}

      <Panel title={isCash ? "Cash received and paid" : "Bank transactions"}>
        {b.rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          <ul className="divide-y divide-border">
            {b.rows.map((row, i) => {
              const incoming = Number(row.money_in) > 0;
              return (
                <li key={`${row.date}-${row.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${incoming ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}
                      aria-hidden="true"
                    >
                      {incoming ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{row.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDay(row.date)}
                        {row.detail ? ` · ${row.detail}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`numeric text-sm font-semibold ${incoming ? "text-success" : "text-destructive"}`}>
                      {incoming ? `+ ${m(row.money_in)}` : `- ${m(row.money_out)}`}
                    </span>
                    {canManage && row.entry_id !== null && (
                      <button
                        type="button"
                        onClick={() => setVoiding({ id: row.entry_id as number, label: `${row.label} on ${fmtDay(row.date)}` })}
                        className="min-h-[40px] rounded-lg px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        {isCash
          ? "Cash sales come from POS payments (less change given). POS pay-ins, pay-outs and cash drops are included."
          : "Card, QR and wallet payments are counted as money in the bank. Cash drops at the POS and cash you put in the bank are added."}
      </p>
      {voiding && <VoidDialog entryId={voiding.id} label={voiding.label} onClose={() => setVoiding(null)} />}
    </div>
  );
}

// ── Online payments ──────────────────────────────────────────────────────────

function OnlineTab({ period, symbol }: { period: Period; symbol: string }) {
  const q = useQuery({ queryKey: [QK, "online", period.from, period.to], queryFn: () => financeApi.online(period) });
  const m = (v: string | number) => money(v, symbol);
  if (q.isLoading) return <ListSkeleton rows={5} />;
  if (q.isError || !q.data) {
    return <ErrorBlock message={errorMessage(q.error, "Could not load online payments.")} onRetry={() => q.refetch()} />;
  }
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Figure label="Received online" value={m(d.received)} tone="in" />
        <Figure label="Refunded" value={m(d.refunded)} />
        <Figure label="Online total" value={m(d.net)} />
      </div>
      {d.by_method.length > 0 && (
        <Panel title="By payment method">
          <div className="divide-y divide-border">
            {d.by_method.map((row) => (
              <Line key={row.key} label={row.label} value={m(row.received)} hint={`${row.count} payment${row.count === 1 ? "" : "s"}`} />
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Online transactions">
        {d.rows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No online payments in this period.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {row.method_label}
                    {row.is_refund ? " · Refund" : ""}
                    {row.order_id ? ` · Order #${row.order_id}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(row.datetime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {row.reference ? ` · Ref ${row.reference}` : ""}
                    {row.worker ? ` · ${row.worker}` : ""}
                  </p>
                </div>
                <span className={`numeric text-sm font-semibold ${row.is_refund ? "text-destructive" : "text-foreground"}`}>
                  {m(row.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {d.truncated && (
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Showing the newest {d.rows.length} of {d.total_rows}. Choose a shorter period to see the rest.
          </p>
        )}
      </Panel>
    </div>
  );
}

// ── Expenses and other income ────────────────────────────────────────────────

function ExpensesTab({
  period,
  symbol,
  canManage,
  onRecord,
}: {
  period: Period;
  symbol: string;
  canManage: boolean;
  onRecord: (kind: EntryKind) => void;
}) {
  const [showCancelled, setShowCancelled] = useState(false);
  const q = useQuery({
    queryKey: [QK, "expenses", period.from, period.to, showCancelled],
    queryFn: () => financeApi.entries(period, "expense,other_income", showCancelled),
  });
  const [voiding, setVoiding] = useState<{ id: number; label: string } | null>(null);
  const m = (v: string | number) => money(v, symbol);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-ink"
          />
          Show cancelled records
        </label>
        {canManage && (
          <div className="flex gap-2">
            <Button className="h-11" onClick={() => onRecord("expense")}>
              <Plus className="mr-1.5 h-4 w-4" /> Add expense
            </Button>
            <Button variant="outline" className="h-11" onClick={() => onRecord("other_income")}>
              Add other income
            </Button>
          </div>
        )}
      </div>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <ErrorBlock message={errorMessage(q.error, "Could not load expenses.")} onRetry={() => q.refetch()} />}
      {q.data &&
        (q.data.rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No expenses in this period" body="Add rent, bills and other spending so your accounts show the full picture." />
        ) : (
          <Panel title="Expenses and other income">
            <ul className="divide-y divide-border">
              {q.data.rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${e.is_void ? "text-muted-foreground line-through" : "text-foreground"}`}>{e.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {[fmtDay(e.date), e.payment_method_label, e.reference, e.note, e.created_by && `by ${e.created_by}`]
                        .filter(Boolean)
                        .join(" · ")}
                      {e.is_void && ` · Cancelled by ${e.voided_by}: ${e.void_reason}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`numeric text-sm font-semibold ${e.is_void ? "text-muted-foreground line-through" : e.kind === "other_income" ? "text-success" : "text-foreground"}`}>
                      {e.kind === "other_income" ? "+ " : ""}
                      {m(e.amount)}
                    </span>
                    {canManage && !e.is_void && (
                      <button
                        type="button"
                        onClick={() => setVoiding({ id: e.id, label: `${e.label} of ${m(e.amount)}` })}
                        className="min-h-[40px] rounded-lg px-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      {voiding && <VoidDialog entryId={voiding.id} label={voiding.label} onClose={() => setVoiding(null)} />}
    </div>
  );
}

// ── Opening balances ─────────────────────────────────────────────────────────

function OpeningDialog({ settings, symbol, onClose }: { settings: FinanceSettings; symbol: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [cash, setCash] = useState(settings.opening_cash);
  const [bank, setBank] = useState(settings.opening_bank);
  const [date, setDate] = useState(settings.opening_date ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => financeApi.saveSettings({ opening_cash: cash || "0", opening_bank: bank || "0", opening_date: date || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QK] });
      toast.success("Opening balances saved");
      onClose();
    },
    onError: (e) => setError(errorMessage(e, "Could not save.")),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Opening balances</DialogTitle>
          <DialogDescription>
            What you had when you started using Accounts. Balances are worked out from these.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            if (!save.isPending) save.mutate();
          }}
        >
          <Field label={`Cash in the drawer (${symbol})`} htmlFor="acc-open-cash">
            <input id="acc-open-cash" type="number" inputMode="decimal" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} className={inputCls} />
          </Field>
          <Field label={`Money in the bank (${symbol})`} htmlFor="acc-open-bank">
            <input id="acc-open-bank" type="number" inputMode="decimal" step="0.01" value={bank} onChange={(e) => setBank(e.target.value)} className={inputCls} />
          </Field>
          <Field
            label="Count from this day"
            optional
            htmlFor="acc-open-date"
            hint="Sales and payments before this day are left out of the balances. Leave empty to count everything."
          >
            <input id="acc-open-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="h-11 flex-1" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
