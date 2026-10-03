import { useAuth } from "@/lib/auth";
import { QRCodeCanvas } from "qrcode.react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface PersonalQRProps {
  compact?: boolean;
}

export function PersonalQR({ compact }: PersonalQRProps) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const transferCode = user?.customer_profile?.transfer_code;
  const customerName = user?.customer_profile?.full_name || user?.first_name || "Customer";

  const copyCode = async () => {
    if (!transferCode) return;
    try {
      await navigator.clipboard.writeText(transferCode);
      setCopied(true);
      toast.success("Transfer code copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  };

  if (!transferCode) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="rounded-2xl bg-mist p-6">
          <p className="text-sm text-muted-foreground">
            No transfer code available. Please refresh or contact support.
          </p>
        </div>
      </div>
    );
  }

  const qrValue = `zentro-transfer:${transferCode}`;

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-3 overflow-hidden">
      <p className="text-xs text-muted-foreground">Show this QR to receive points</p>
      <div className={`rounded-2xl bg-white ${compact ? "p-2" : "p-4"} shadow-soft`}>
        <QRCodeCanvas value={qrValue} size={compact ? 140 : 180} level="M" />
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">Code:</span>
        <span className="min-w-0 truncate font-mono text-lg font-bold text-ink tracking-[0.15em] select-all">
          {transferCode}
        </span>
        <button
          onClick={copyCode}
          className="grid h-8 w-8 place-items-center rounded-full bg-mist text-muted-foreground hover:text-ink transition-colors"
          aria-label="Copy transfer code"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{customerName}</p>
    </div>
  );
}
