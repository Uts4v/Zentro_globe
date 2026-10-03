import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, Send, Camera } from "lucide-react";
import { customerApi, transferApi, type CustomerMerchantWallet } from "@/lib/api";
import { toast } from "sonner";

const QRScanner = lazy(() => import("./QRScanner").then((m) => ({ default: m.QRScanner })));

interface TransferFormProps {
  preselectedMerchantId?: string;
  scannedTransferCode?: string | null;
  onSuccess?: () => void;
  compact?: boolean;
}

export function TransferForm({
  preselectedMerchantId,
  scannedTransferCode,
  onSuccess,
  compact,
}: TransferFormProps) {
  const [wallets, setWallets] = useState<CustomerMerchantWallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [receiverCode, setReceiverCode] = useState<string>(scannedTransferCode ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showScanner, setShowScanner] = useState(false);

  useEffect(() => {
    customerApi
      .listWallets()
      .then((w) => {
        setWallets(w.filter((x) => x.points_balance > 0));
        if (preselectedMerchantId) setSelectedWalletId(preselectedMerchantId);
        else if (w.length === 1) setSelectedWalletId(String(w[0].merchant_id));
      })
      .catch(() => toast.error("Failed to load wallets"))
      .finally(() => setLoading(false));
  }, [preselectedMerchantId]);

  useEffect(() => {
    if (scannedTransferCode) setReceiverCode(scannedTransferCode.toUpperCase());
  }, [scannedTransferCode]);

  const selectedWallet = wallets.find((w) => String(w.merchant_id) === selectedWalletId);

  const handleSubmit = async () => {
    const merchantId = Number(selectedWalletId);
    const code = receiverCode.trim().toUpperCase();
    const pts = Number(amount);

    if (!merchantId || !code || !pts) {
      toast.error("Please fill in all required fields.");
      return;
    }

    if (pts <= 0) {
      toast.error("Amount must be positive.");
      return;
    }

    if (selectedWallet && pts > selectedWallet.points_balance) {
      toast.error(`Insufficient points. You have ${selectedWallet.points_balance} points.`);
      return;
    }

    setSending(true);
    try {
      await transferApi.create({
        receiver_transfer_code: code,
        merchant_id: merchantId,
        amount: pts,
        description: description || undefined,
      });
      toast.success(`Sent ${pts} points successfully!`);
      setAmount("");
      setDescription("");
      onSuccess?.();
    } catch (e: any) {
      toast.error(
        e.message || "Transfer failed. Check that both users belong to the same merchant.",
      );
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showWalletSelector = !preselectedMerchantId || wallets.length === 0;
  const filteredWallets = preselectedMerchantId
    ? wallets.filter((w) => String(w.merchant_id) === preselectedMerchantId)
    : wallets;

  const activeWallet = preselectedMerchantId ? filteredWallets[0] : selectedWallet;

  if (wallets.length === 0) {
    return (
      <p className="text-center text-xs text-muted-foreground py-4">
        Join a café and earn points first.
      </p>
    );
  }

  return (
    <div className={`w-full max-w-full space-y-4 ${compact ? "" : "p-6"}`}>
      {showWalletSelector ? (
        <div className="max-w-full">
          <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-muted-foreground">
            From (merchant)
          </label>
          <select
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            className="w-full truncate rounded-xl border border-border bg-transparent px-4 py-3 text-sm text-ink outline-none focus:border-ink/30"
          >
            <option value="">Select a merchant…</option>
            {wallets.map((w) => (
              <option key={w.merchant_id} value={w.merchant_id}>
                {w.merchant_name} — {w.points_balance.toLocaleString()} pts
              </option>
            ))}
          </select>
        </div>
      ) : (
        activeWallet && (
          <div className="flex min-w-0 items-center justify-between overflow-hidden rounded-xl bg-mist px-4 py-2.5">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              From <span className="font-medium text-ink">{activeWallet.merchant_name}</span>
            </span>
            <span className="shrink-0 text-xs font-medium text-ink">
              {activeWallet.points_balance.toLocaleString()} pts
            </span>
          </div>
        )
      )}

      <div>
        <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Recipient transfer code
        </label>
        <div className="relative">
          <input
            value={receiverCode}
            onChange={(e) => setReceiverCode(e.target.value.toUpperCase())}
            placeholder="e.g. A7K2X9"
            maxLength={8}
            className="w-full rounded-xl border border-border bg-transparent px-4 py-3 pr-12 text-sm text-ink outline-none placeholder:text-muted-foreground/50 focus:border-ink/30 font-mono tracking-wider uppercase"
          />
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-lg bg-mist text-muted-foreground hover:text-ink transition-colors"
            aria-label="Scan QR code"
          >
            <Camera className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showScanner && (
        <Suspense
          fallback={
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <QRScanner
            onScan={(code) => setReceiverCode(code)}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      <div className="max-w-full">
        <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Amount (points)
        </label>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter points to send"
          className="w-full rounded-xl border border-border bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted-foreground/50 focus:border-ink/30"
        />
        {activeWallet && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Balance: {activeWallet.points_balance.toLocaleString()} pts
          </p>
        )}
      </div>

      <div className="max-w-full">
        <label className="mb-1.5 block text-xs uppercase tracking-[0.15em] text-muted-foreground">
          Note (optional)
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this for?"
          className="w-full rounded-xl border border-border bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted-foreground/50 focus:border-ink/30"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={sending || !selectedWalletId || !receiverCode.trim() || !amount}
        className="inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden truncate rounded-full gradient-ember text-sm font-medium text-white shadow-ember transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {sending ? "Sending…" : `Send ${amount || "0"} points`}
      </button>
    </div>
  );
}
