// src/features/inventory/context.tsx
// Who is acting (owner or staff), what they may do, and screen navigation.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inventoryApi, staffSession, type InventoryRoot } from "@/lib/api";

export const P = {
  VIEW: "inventory.view",
  VIEW_COST: "inventory.view_cost",
  MANAGE_ITEMS: "inventory.manage_items",
  COUNT: "inventory.count",
  SUBMIT_COUNT: "inventory.submit_count",
  APPROVE_COUNT: "inventory.approve_count",
  RECEIVE: "inventory.receive",
  ADJUST: "inventory.adjust",
  APPROVE_ADJUSTMENT: "inventory.approve_adjustment",
  RECORD_WASTE: "inventory.record_waste",
  MANAGE_SUPPLIERS: "inventory.manage_suppliers",
  PURCHASE: "inventory.purchase",
  TRANSFER: "inventory.transfer",
  VIEW_REPORTS: "inventory.view_reports",
  MANAGE_SETTINGS: "inventory.manage_settings",
  IMPORT: "inventory.import",
} as const;

export type View =
  | "home"
  | "stock"
  | "count"
  | "actions"
  | "delivery"
  | "move"
  | "waste"
  | "fix"
  | "suppliers"
  | "reports"
  | "history"
  | "io"
  | "settings";

export interface NavParams {
  item?: number;
  count?: number;
  location?: number;
  report?: string;
  import?: number;
}

export const QK = {
  all: ["inventory"] as const,
  root: (token: string) => ["inventory", "root", token] as const,
  refs: (name: string) => ["inventory", "refs", name] as const,
};

interface InventoryContextValue {
  root: InventoryRoot;
  can: (perm: string) => boolean;
  sym: string;
  view: View;
  params: NavParams;
  go: (view: View, params?: NavParams) => void;
  /** Refetch everything after a stock change. */
  refresh: () => void;
}

const Ctx = createContext<InventoryContextValue | null>(null);

export function useInventory() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useInventory must be used inside <InventoryProvider>");
  return value;
}

export function useStaffToken(): string {
  return useSyncExternalStore(
    (cb) => {
      const unsubscribe = staffSession.subscribe(cb);
      return () => {
        unsubscribe();
      };
    },
    () => staffSession.get()?.token ?? "",
    () => "",
  );
}

export function useRootQuery() {
  const token = useStaffToken();
  return useQuery({ queryKey: QK.root(token), queryFn: inventoryApi.root, staleTime: 60_000 });
}

export function InventoryProvider({
  root,
  sym,
  view,
  params,
  go,
  children,
}: {
  root: InventoryRoot;
  sym: string;
  view: View;
  params: NavParams;
  go: (view: View, params?: NavParams) => void;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const token = useStaffToken();
  // Switching owner ↔ staff must never show data fetched for the other role.
  useEffect(() => {
    qc.removeQueries({ queryKey: QK.all, predicate: (q) => q.queryKey[1] !== "root" });
  }, [token, qc]);

  const can = useCallback((perm: string) => Boolean(root.permissions[perm]), [root]);
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: QK.all });
  }, [qc]);
  return (
    <Ctx.Provider value={{ root, can, sym, view, params, go, refresh }}>{children}</Ctx.Provider>
  );
}

// ── Reference data hooks ──────────────────────────────────────────────────────

export function useLocations() {
  const q = useQuery({
    queryKey: QK.refs("locations"),
    queryFn: inventoryApi.locations,
    staleTime: 300_000,
  });
  return { ...q, active: (q.data ?? []).filter((l) => l.is_active) };
}

export function useCategories() {
  const q = useQuery({
    queryKey: QK.refs("categories"),
    queryFn: inventoryApi.categories,
    staleTime: 300_000,
  });
  return { ...q, active: (q.data ?? []).filter((c) => c.is_active) };
}

export function useUnits() {
  return useQuery({ queryKey: QK.refs("units"), queryFn: inventoryApi.units, staleTime: 600_000 });
}

export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: QK.refs("suppliers"),
    queryFn: () => inventoryApi.suppliers(true),
    staleTime: 120_000,
    enabled,
  });
}
