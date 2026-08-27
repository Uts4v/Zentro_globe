import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  posListDebitAccounts,
  posListCreditAccounts,
  DebitAccount as DebitAccountType,
  CreditAccount as CreditAccountType,
} from "../api";
import {
  Wallet,
  Search,
  Plus,
  Loader2,
  CreditCard,
  Minus,
  ArrowUpRight,
  ArrowDownLeft,
  UserPlus,
} from "lucide-react";

type Tab = "credit" | "debit";

interface AccountListProps {
  onTopup: (account: DebitAccountType) => void;
  onCreditSale?: (account: CreditAccountType) => void;
  onCreditRepayment?: (account: CreditAccountType) => void;
  onCreateDebit?: () => void;
  onCreateCredit?: () => void;
}

export default function AccountList({
  onTopup,
  onCreditSale,
  onCreditRepayment,
  onCreateDebit,
  onCreateCredit,
}: AccountListProps) {
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";
  const [tab, setTab] = useState<Tab>("debit");
  const [debitAccounts, setDebitAccounts] = useState<DebitAccountType[]>([]);
  const [creditAccounts, setCreditAccounts] = useState<CreditAccountType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        posListDebitAccounts(),
        posListCreditAccounts().catch(() => []),
      ]);
      if (results[0].status === "fulfilled") {
        setDebitAccounts(results[0].value);
      } else {
        const msg = results[0].reason?.message || "";
        if (msg.includes("403") || msg.toLowerCase().includes("not enabled")) {
          setError("Debit accounts are not enabled. Enable them in POS Settings.");
        }
      }
      if (results[1].status === "fulfilled") {
        setCreditAccounts(results[1].value);
      }
    } catch (err: any) {
      setError("Failed to load accounts. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const filteredDebit = debitAccounts.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.contact_name.toLowerCase().includes(q) ||
      a.contact_phone.includes(q)
    );
  });

  const filteredCredit = creditAccounts.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.contact_name.toLowerCase().includes(q) ||
      a.contact_phone.includes(q)
    );
  });

  const creditEnabled = posSettings?.credit_accounts_enabled ?? false;

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Accounts</h1>
          <p className="text-xs text-muted-foreground">
            Manage customer credit and debit (wallet) accounts
          </p>
        </div>
        <button
          onClick={tab === "debit" ? onCreateDebit : onCreateCredit}
          className="flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-xs font-medium text-white hover:opacity-90"
        >
          <UserPlus className="h-3.5 w-3.5" />
          New Account
        </button>
      </div>

      {/* Tab toggle */}
      <div className="mb-4 flex gap-2">
        {(["debit", "credit"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "bg-ink text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t === "debit" ? "Debit (Wallet)" : "Credit"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-muted/50 py-2.5 pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
      </div>

      {/* Account list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <Wallet className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm text-red-500">{error}</p>
          <button
            onClick={loadAccounts}
            className="mt-3 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Retry
          </button>
        </div>
      ) : tab === "debit" ? (
        filteredDebit.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <Wallet className="mb-3 h-10 w-10 opacity-30" />
            <p className="text-sm">No debit accounts found</p>
            {onCreateDebit && (
              <button
                onClick={onCreateDebit}
                className="mt-3 flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                <UserPlus className="h-4 w-4" />
                Create Debit Account
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDebit.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-ink text-lg font-bold text-white">
                  {(account.contact_name || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">
                    {account.contact_name || "Walk-in"}
                  </p>
                  {account.contact_phone && (
                    <p className="text-xs text-muted-foreground">
                      {account.contact_phone}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-ink">
                    {formatCurrency(account.balance, currencySymbol)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">balance</p>
                </div>
                <button
                  onClick={() => onTopup(account)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-50 text-green-600 hover:bg-green-100"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : !creditEnabled ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <CreditCard className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">Credit accounts are not enabled</p>
          <p className="text-xs text-muted-foreground">
            Enable them in POS Settings to use credit accounts
          </p>
        </div>
      ) : filteredCredit.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <CreditCard className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No credit accounts found</p>
          {onCreateCredit && (
            <button
              onClick={onCreateCredit}
              className="mt-3 flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <UserPlus className="h-4 w-4" />
              Create Credit Account
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCredit.map((account) => {
            const utilizationPct =
              Number(account.credit_limit) > 0
                ? (Number(account.current_balance) /
                    Number(account.credit_limit)) *
                  100
                : 0;
            return (
              <div
                key={account.id}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="mb-3 flex items-center gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-amber-500 text-lg font-bold text-white">
                    {(account.contact_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">
                      {account.contact_name || "Walk-in"}
                    </p>
                    {account.contact_phone && (
                      <p className="text-xs text-muted-foreground">
                        {account.contact_phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* Credit info */}
                <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-muted-foreground">Limit</p>
                    <p className="font-bold text-foreground">
                      {formatCurrency(account.credit_limit, currencySymbol)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2">
                    <p className="text-red-600">Owed</p>
                    <p className="font-bold text-red-700">
                      {formatCurrency(account.current_balance, currencySymbol)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-green-50 p-2">
                    <p className="text-green-600">Available</p>
                    <p className="font-bold text-green-700">
                      {formatCurrency(account.available_credit, currencySymbol)}
                    </p>
                  </div>
                </div>

                {/* Utilization bar */}
                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-muted-foreground">
                      Utilization
                    </span>
                    <span className="font-medium">
                      {utilizationPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${
                        utilizationPct > 80 ? "bg-red-500" : utilizationPct > 50 ? "bg-amber-500" : "bg-green-500"
                      }`}
                      style={{ width: `${Math.min(utilizationPct, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  {onCreditSale && (
                    <button
                      onClick={() => onCreditSale(account)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      New Sale
                    </button>
                  )}
                  {onCreditRepayment && (
                    <button
                      onClick={() => onCreditRepayment(account)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-50 px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-100"
                    >
                      <Minus className="h-3.5 w-3.5" />
                      Record Payment
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
