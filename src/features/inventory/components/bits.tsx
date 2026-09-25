// src/features/inventory/components/bits.tsx
// Shared presentational helpers for the Inventory feature.
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  PackageX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventoryStatus } from "@/lib/api";

export function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export function uid(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${id}` : id;
}

export function formatQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  const trimmed = n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return trimmed.replace(/\.?0+$/, "");
}

export function formatMoney(v: string | number | null | undefined, sym = "Rs"): string {
  const n = Number(v ?? 0);
  if (Number.isNaN(n)) return `${sym} 0`;
  return `${sym} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<InventoryStatus, string> = {
  HEALTHY: "bg-emerald-100 text-emerald-700",
  OVERSTOCK: "bg-sky-100 text-sky-700",
  LOW: "bg-amber-100 text-amber-700",
  CRITICAL: "bg-orange-100 text-orange-700",
  OUT: "bg-rose-100 text-rose-600",
};

export const STATUS_LABEL: Record<InventoryStatus, string> = {
  HEALTHY: "Good",
  OVERSTOCK: "More Than Usual",
  LOW: "Low",
  CRITICAL: "Very Low",
  OUT: "Out",
};

export function StatusBadge({ status }: { status: InventoryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STATUS_STYLE[status] ?? "bg-mist text-muted-foreground",
      )}
    >
      {status === "OUT" && <PackageX className="h-3 w-3" aria-hidden="true" />}
      {status === "CRITICAL" && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {status === "LOW" && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
      {status === "OVERSTOCK" && <Info className="h-3 w-3" aria-hidden="true" />}
      {status === "HEALTHY" && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const ITEM_TYPE_LABEL: Record<string, string> = {
  INGREDIENT: "Food / Ingredient",
  PREPARED: "Prepared Here",
  DIRECT_SALE: "Drink / Sold As-Is",
  SUPPLY: "Packaging / Supply",
};

export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING_BALANCE: "Starting Stock",
  RECEIVE: "Delivery",
  RECEIVING: "Delivery",
  TRANSFER_IN: "Moved In",
  TRANSFER_OUT: "Moved Out",
  COUNT_RECONCILIATION: "Stock Count",
  EXPLICIT_WASTE: "Waste",
  WASTE: "Waste",
  MANUAL_ADJUSTMENT: "Stock Correction",
  REVERSAL: "Undo",
  SALE: "Sold",
};

export function friendlyMovementLabel(type: string): string {
  return MOVEMENT_LABEL[type] ?? type.replace(/_/g, " ").toLowerCase();
}

export function ActionCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[92px] items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-base font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  tone?: "default" | "danger" | "warn" | "ok";
  loading?: boolean;
}) {
  const tones: Record<string, string> = {
    default: "text-foreground",
    danger: "text-rose-600",
    warn: "text-amber-600",
    ok: "text-emerald-600",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight", tones[tone])}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Empty / loading / error blocks ────────────────────────────────────────────

export function EmptyState({
  icon: Icon = PackageX,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <Icon className="h-8 w-8 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {body && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-xl text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

// ── Form field label ──────────────────────────────────────────────────────────

export function Field({
  label,
  optional = false,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-foreground">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </span>
      {children}
    </label>
  );
}

export const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
