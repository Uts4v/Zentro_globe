import { useSyncStatus, useOnlineStatus } from "../offline/hooks";
import { processSyncQueue, retryDead } from "../offline/sync";
import { checkConnectivity } from "@/lib/connectivity";
import { staffSession } from "@/lib/staff-session";
import { usePosStore } from "../store";
import { Wifi, WifiOff, AlertCircle, Loader2 } from "lucide-react";
import { useState } from "react";

export default function SyncStatusBar() {
  const isOnline = useOnlineStatus();
  const { pending, failed, dead = 0, isSyncing, needsSignIn, refresh } = useSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const setCurrentWorker = usePosStore((s) => s.setCurrentWorker);

  const waiting = pending + failed + dead;
  const hasIssues = waiting > 0;

  /**
   * The bar says "sign in with your PIN", so it had better offer that. Retrying
   * the sync cannot work — the token was refused — and sending the employee to
   * a merchant login page is a dead end they have no credentials for. Clearing
   * the staff session puts `PosLayout` back on the PIN pad, and the queue is
   * untouched, so signing in again uploads it.
   */
  function handleReauthenticate() {
    staffSession.set(null);
    setCurrentWorker(null);
  }

  async function handleSync() {
    setSyncing(true);
    try {
      // Requeue anything the automatic retries gave up on before this pass
      await retryDead().catch(() => {});
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
    : failed > 0 || dead > 0 || needsSignIn
      ? "bg-destructive/10 text-destructive"
      : "bg-info/10 text-info";
  const buttonTone = !isOnline
    ? "bg-warning/15 text-warning hover:bg-warning/25"
    : failed > 0 || dead > 0 || needsSignIn
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
          <span>Offline — {waiting === 0 ? "nothing to sync" : `${waiting} waiting to sync`}</span>
        </>
      ) : needsSignIn ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          {/* The staff session was refused, so the fix is a fresh PIN rather
              than a merchant login — an employee cannot do the latter. */}
          <span>
            Session expired — sign in with your PIN to send {waiting} saved change
            {waiting === 1 ? "" : "s"}
          </span>
        </>
      ) : failed > 0 || dead > 0 ? (
        <>
          <AlertCircle className="h-3.5 w-3.5" />
          <span>
            {dead > 0 ? `${dead} could not sync` : `${failed} failed`}
            {pending > 0 ? `, ${pending} pending` : ""}
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
          onClick={needsSignIn && isOnline ? handleReauthenticate : handleSync}
          className={`ml-auto min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold ${buttonTone}`}
        >
          {needsSignIn && isOnline
            ? "Sign in with PIN"
            : !isOnline
              ? "Try again"
              : failed > 0 || dead > 0
                ? "Retry"
                : "Sync now"}
        </button>
      )}
    </div>
  );
}
