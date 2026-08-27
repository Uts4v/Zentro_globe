import { useEffect, useState } from "react";
import { usePosStore } from "../store";
import { formatCurrency } from "@/lib/currency";
import {
  posListConflicts,
  posResolveConflict,
  posClearMutations,
  PosConflicts,
} from "../api";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  Server,
  Smartphone,
  CheckCircle,
  Trash2,
  X,
} from "lucide-react";
import { syncQueue } from "../offline/db";

export default function ConflictResolver() {
  const [data, setData] = useState<PosConflicts | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [localQueueCount, setLocalQueueCount] = useState(0);
  const [clearingLocal, setClearingLocal] = useState(false);
  const posSettings = usePosStore((s) => s.posSettings);
  const currencySymbol = posSettings?.currency_symbol || "Rs";

  useEffect(() => {
    loadConflicts();
    loadLocalQueueCount();
  }, []);

  async function loadConflicts() {
    setLoading(true);
    try {
      const result = await posListConflicts();
      setData(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function loadLocalQueueCount() {
    try {
      const pending = await syncQueue.getPending();
      setLocalQueueCount(pending.length);
    } catch {
      // ignore
    }
  }

  async function clearAllMutations() {
    if (!data || data.mutations.length === 0) return;
    setClearing(true);
    try {
      await posClearMutations();
      await loadConflicts();
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }

  async function dismissMutation(mutationId: number) {
    setClearing(true);
    try {
      await posClearMutations([mutationId]);
      await loadConflicts();
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  }

  async function clearLocalQueue() {
    setClearingLocal(true);
    try {
      await syncQueue.clear();
      setLocalQueueCount(0);
    } catch {
      // ignore
    } finally {
      setClearingLocal(false);
    }
  }

  async function resolve(
    entityType: "order" | "payment",
    entityId: string,
    resolution: "keep_server" | "keep_client"
  ) {
    setResolving(entityId);
    try {
      await posResolveConflict({
        entity_type: entityType,
        entity_id: entityId,
        resolution,
      });
      await loadConflicts();
    } catch {
      // ignore
    } finally {
      setResolving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const totalConflicts =
    data.orders.length + data.payments.length + localQueueCount;

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Sync Conflicts</h1>
            <p className="text-xs text-muted-foreground">
              {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""} to resolve
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            loadConflicts();
            loadLocalQueueCount();
          }}
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {totalConflicts === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle className="mb-4 h-12 w-12 text-green-500" />
          <p className="text-lg font-bold text-foreground">All Clear</p>
          <p className="text-sm text-muted-foreground">No sync conflicts to resolve</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Order Conflicts */}
          {data.orders.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase text-muted-foreground">
                Order Conflicts
              </h2>
              <div className="space-y-3">
                {data.orders.map((order) => (
                  <div
                    key={order.uuid}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          Order #{order.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {order.status} &middot; {formatCurrency(Number(order.total_amount), currencySymbol)} &middot; v{order.version}
                        </p>
                      </div>
                      {resolving === order.uuid && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resolve("order", String(order.id), "keep_server")}
                        disabled={resolving === order.uuid}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                      >
                        <Server className="h-3.5 w-3.5" />
                        Keep Server
                      </button>
                      <button
                        onClick={() => resolve("order", String(order.id), "keep_client")}
                        disabled={resolving === order.uuid}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        Keep Offline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Payment Conflicts */}
          {data.payments.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-bold uppercase text-muted-foreground">
                Payment Conflicts
              </h2>
              <div className="space-y-3">
                {data.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          Payment {payment.payment_method}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(Number(payment.amount), currencySymbol)} &middot;{" "}
                          {payment.status}
                        </p>
                      </div>
                      {resolving === payment.id && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          resolve("payment", payment.id, "keep_server")
                        }
                        disabled={resolving === payment.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                      >
                        <Server className="h-3.5 w-3.5" />
                        Keep Server
                      </button>
                      <button
                        onClick={() =>
                          resolve("payment", payment.id, "keep_client")
                        }
                        disabled={resolving === payment.id}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        Keep Offline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Failed Mutations */}
          {data.mutations.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase text-muted-foreground">
                  Recent Activity ({data.mutations.length})
                </h2>
                <button
                  onClick={clearAllMutations}
                  disabled={clearing}
                  className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-40"
                >
                  {clearing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Clear All
                </button>
              </div>
              <div className="space-y-2">
                {data.mutations.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-xl bg-muted/50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {m.entity_type} — {m.operation}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {m.client_mutation_id.slice(0, 8)}... &middot;{" "}
                        {m.processed_at
                          ? new Date(m.processed_at).toLocaleString()
                          : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => dismissMutation(m.id)}
                      disabled={clearing}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      title="Dismiss"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Local Sync Queue */}
          {localQueueCount > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase text-muted-foreground">
                  Local Sync Queue ({localQueueCount} items)
                </h2>
                <button
                  onClick={clearLocalQueue}
                  disabled={clearingLocal}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-100 disabled:opacity-40"
                >
                  {clearingLocal ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Clear Local Queue
                </button>
              </div>
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700">
                These are offline mutations stored in your browser that failed to sync. They
                are stale and can be safely cleared.
              </p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
