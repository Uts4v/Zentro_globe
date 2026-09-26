import { useSyncStatus, useOnlineStatus } from "../offline/hooks";
import { processSyncQueue } from "../offline/sync";
import { Wifi, WifiOff, RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

export default function SyncStatusBar() {
  const isOnline = useOnlineStatus();
  const { pending, failed, isSyncing, refresh } = useSyncStatus();
  const [syncing, setSyncing] = useState(false);

  const hasIssues = pending > 0 || failed > 0;

  async function handleSync() {
    setSyncing(true);
    await processSyncQueue();
    refresh();
    setSyncing(false);
  }

  // Don't show if everything is clean and online
  if (!hasIssues && isOnline) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
        !isOnline
          ? "bg-warning/10 text-warning"
          : failed > 0
          ? "bg-destructive/10 text-destructive"
          : "bg-info/10 text-info"
      }`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="h-3.5 w-3.5" />
          <span>Offline — {pending} mutation(s) queued</span>
        </>
      ) : isSyncing || syncing ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Syncing...</span>
        </>
      ) : failed > 0 ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          <span>
            {failed} failed, {pending} pending
          </span>
          <button
            onClick={handleSync}
            className="ml-auto min-h-[36px] rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25"
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <Wifi className="h-3.5 w-3.5" />
          <span>{pending} pending sync</span>
          <button
            onClick={handleSync}
            className="ml-auto min-h-[36px] rounded-lg bg-info/15 px-3 py-1.5 text-xs font-semibold text-info hover:bg-info/25"
          >
            Sync now
          </button>
        </>
      )}
    </div>
  );
}
