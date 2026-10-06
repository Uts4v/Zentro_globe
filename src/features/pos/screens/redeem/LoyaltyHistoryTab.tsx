import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { posLoyaltyTransactions, type PosPointTransaction } from "../../api/loyalty";

const LABELS: Record<string, string> = {
  EARNED: "Earned",
  REDEEMED: "Redeemed",
  REDEMPTION_REFUND: "Redeem refunded",
  MISSION_BONUS: "Mission bonus",
  PUNCH_CARD_REWARD: "Punch card",
  EXPIRED: "Expired",
  MANUAL_ADJUSTMENT: "Adjusted",
  TRANSFER_SENT: "Sent",
  TRANSFER_RECEIVED: "Received",
};

/**
 * Recent point activity at this store, so a cashier can answer "what did that
 * customer just spend?" without opening the merchant dashboard.
 */
export default function LoyaltyHistoryTab() {
  const [rows, setRows] = useState<PosPointTransaction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await posLoyaltyTransactions());
    } catch (e: unknown) {
      setRows([]);
      setError((e as Error).message || "Couldn't load point history.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Latest points activity in this store.</p>
        <button
          onClick={load}
          disabled={busy}
          aria-label="Refresh point history"
          className="grid h-8 w-8 place-items-center rounded-lg bg-mist text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {!error && rows === null && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {rows !== null && rows.length === 0 && !error && (
        <p className="py-6 text-center text-xs text-muted-foreground">No points have moved yet.</p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-border/60">
          {rows.map((tx) => (
            <li key={tx.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{tx.customer_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {LABELS[tx.transaction_type] ?? tx.transaction_type}
                  {tx.description ? ` · ${tx.description}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm font-semibold ${
                    tx.points >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {tx.points > 0 ? "+" : ""}
                  {tx.points}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(tx.created_at).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
