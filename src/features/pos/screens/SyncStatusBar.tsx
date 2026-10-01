import { useSyncStatus, useOnlineStatus } from "../offline/hooks";
import { processSyncQueue } from "../offline/sync";
import { checkConnectivity } from "@/lib/connectivity";
import { Wifi, WifiOff, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

export default function SyncStatusBar() {
  const isOnline = useOnlineStatus();
  const { pending, failed, isSyncing, needsSignIn, refresh } = useSyncStatus();
  const [syncing, setSyncing] = useState(false);

  const waiting = pending + failed;
  const hasIssues = waiting > 0;

  async function handleSync() {
    setSyncing(true);
    try {
      // Offline, "Sync now" doubles as "check the connection again".
      await checkConnectivity();
      await processSyncQueue({ force: true });
    } catch {
      // storage unavailable: nothing was sent, the count below stays as it is
    } finally {
      refresh();
      setSyncing(false);
    }
  }

  // Don't show if everything is clean and online
  if (!hasIssues && isOnline) return null;

  const busy = isSyncing || syncing;
  const tone = !isOnline
    ? "bg-warning/10 text-warning"
    : failed > 0 || needsSignIn
      ? "bg-destructive/10 text-destructive"
      : "bg-info/10 text-info";
  const buttonTone = !isOnline
    ? "bg-warning/15 text-warning hover:bg-warning/25"
    : failed > 0 || needsSignIn
      ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
      : "bg-info/15 text-info hover:bg-info/25";

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${tone}`}
    >
      {busy ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Syncing...</span>
        </>
      ) : !isOnline ? (
        <>
          <WifiOff className="h-3.5 w-3.5" />
          <span>
            Offline — {waiting === 0 ? "nothing to sync" : `${waiting} waiting to sync`}
          </span>
        </>
      ) : needsSignIn ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Sign in again to sync {waiting} saved change(s)</span>
        </>
      ) : failed > 0 ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          <span>
            {failed} failed, {pending} pending
          </span>
        </>
      ) : (
        <>
          <Wifi className="h-3.5 w-3.5" />
          <span>{pending} pending sync</span>
        </>
      )}
      {!busy && (
        <button
          onClick={handleSync}
          className={`ml-auto min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold ${buttonTone}`}
        >
          {!isOnline ? "Try again" : failed > 0 ? "Retry" : "Sync now"}
        </button>
      )}
    </div>
  );
}
