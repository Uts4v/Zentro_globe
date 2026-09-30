// src/features/inventory/components/bits.tsx
// Shared presentational helpers for the Inventory feature.
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  PackageX,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InventoryStatus } from "@/lib/api";
import { copy } from "@/features/inventory/copy";

// ── Formatting ────────────────────────────────────────────────────────────────

export function errorMessage(e: unknown, fallback: string = copy.errors.generic) {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function uid(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prefix ? `${prefix}-${id}` : id;
}

/** Human-friendly quantity: 18, 2.5, 1,200 — never trailing zeros. */
export function formatQty(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

export function formatMoney(v: string | number | null | undefined, sym = "Rs"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
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
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Yesterday" or "Sep 28". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return copy.history.today;
  if (d.toDateString() === yesterday.toDateString()) return copy.history.yesterday;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** Parse a user-typed amount; returns null for empty/invalid. */
export function parseAmount(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<InventoryStatus, string> = {
  HEALTHY: "bg-olive-soft text-olive",
  OVERSTOCK: "bg-periwinkle-soft text-info",
  LOW: "bg-butter-soft text-[#8a5d1f]",
  CRITICAL: "bg-[#f8e6dc] text-[#9a3f22]",
  OUT: "bg-bordeaux-soft text-danger",
};

const STATUS_ICON: Record<InventoryStatus, LucideIcon> = {
  HEALTHY: CheckCircle2,
  OVERSTOCK: Info,
  LOW: AlertTriangle,
  CRITICAL: TriangleAlert,
  OUT: PackageX,
};

export const STATUS_LABEL = copy.status;

/** Icon + label + colour — never colour alone. */
export function StatusBadge({
  status,
  size = "sm",
}: {
  status: InventoryStatus;
  size?: "sm" | "md";
}) {
  const Icon = STATUS_ICON[status] ?? Info;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-semibold",
        size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]",
        STATUS_STYLE[status] ?? "bg-mist text-muted-foreground",
      )}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} aria-hidden="true" />
      {copy.status[status] ?? status}
    </span>
  );
}

export const ITEM_TYPE_LABEL = copy.itemType;

export function friendlyMovementLabel(type: string): string {
  return copy.movementLabel[type] ?? type.replace(/_/g, " ").toLowerCase();
}

// ── Layout ────────────────────────────────────────────────────────────────────

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={copy.common.back}
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

/** Large task card: icon, title and a plain-language hint. 44px+ target. */
export function ActionCard({
  icon: Icon,
  title,
  description,
  onClick,
  tone = "default",
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  tone?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex min-h-[84px] w-full items-center gap-4 rounded-2xl border p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "primary"
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-card hover:border-primary/40 hover:shadow-md",
      )}
    >
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
          tone === "primary" ? "bg-white/15 text-primary-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{title}</span>
        <span
          className={cn(
            "mt-0.5 block text-sm",
            tone === "primary" ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {description}
        </span>
      </span>
      <ChevronRight
        className="h-5 w-5 shrink-0 opacity-50 transition group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Empty / loading / error ───────────────────────────────────────────────────

export function EmptyState({
  icon: Icon = PackageX,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <Icon className="h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
      <p className="mt-3 text-base font-semibold text-foreground">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label={copy.common.loading}>
      <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

/** Lightweight list skeleton (stock rows, count lines, reports). */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label={copy.common.loading}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-6 w-16 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/30 bg-bordeaux-soft px-4 py-3 text-sm text-danger"
    >
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> {copy.common.tryAgain}
        </Button>
      )}
    </div>
  );
}

// ── Forms ─────────────────────────────────────────────────────────────────────

export const inputCls =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm";

/** Label above the field, optional helper text and an error line. */
export function Field({
  label,
  optional = false,
  hint,
  error,
  className,
  htmlFor,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("block", className)}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground"
      >
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground">({copy.common.optional})</span>
        )}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Big numeric field with the unit shown inside; opens the number keypad on phones. */
export function QuantityInput({
  id,
  value,
  onChange,
  unit,
  placeholder = "0",
  autoFocus,
  onBlur,
  ariaLabel,
  large = false,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  ariaLabel?: string;
  large?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={cn(
          inputCls,
          "pr-16 tabular-nums",
          large && "h-14 text-xl font-semibold sm:text-xl",
        )}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ""))}
        onBlur={onBlur}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}

/** Row of large, touch-friendly choices (radio semantics). */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 2,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string; hint?: string; icon?: LucideIcon }[];
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3 | 4;
}) {
  const cols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  }[columns];
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-2", cols)}>
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex min-h-[48px] items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                active ? "border-primary" : "border-muted-foreground/40",
              )}
            >
              {active && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">{opt.label}</span>
              {opt.hint && <span className="block text-xs text-muted-foreground">{opt.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal filter chips (single select). */
export function FilterChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/40",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs",
                  active ? "bg-white/20" : "bg-muted text-muted-foreground",
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Primary action that stays reachable at the bottom on phones. */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
    </div>
  );
}

// ── Dialogs & results ─────────────────────────────────────────────────────────

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy = false,
  danger = false,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {body && (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">{body}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="h-11"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {copy.common.cancel}
          </Button>
          <Button
            className="h-11"
            variant={danger ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SuccessPanel({
  title,
  lines,
  note,
  primary,
  secondary,
  tone = "success",
}: {
  title: string;
  lines: { label: string; value: string; sub?: string }[];
  note?: string;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  tone?: "success" | "info";
}) {
  return (
    <div
      className="mx-auto max-w-lg rounded-3xl border border-border bg-card p-6 text-center shadow-sm"
      role="status"
      aria-live="polite"
    >
      <span
        className={cn(
          "mx-auto flex h-14 w-14 items-center justify-center rounded-full",
          tone === "success" ? "bg-olive-soft text-olive" : "bg-periwinkle-soft text-info",
        )}
      >
        {tone === "success" ? (
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        ) : (
          <Info className="h-7 w-7" aria-hidden="true" />
        )}
      </span>
      <h2 className="mt-4 font-display text-2xl font-semibold text-foreground">{title}</h2>
      <div className="mt-5 space-y-3 text-left">
        {lines.map((line, i) => (
          <div key={i} className="rounded-2xl bg-muted/60 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-foreground">{line.label}</span>
              <span className="font-semibold tabular-nums text-olive">{line.value}</span>
            </div>
            {line.sub && <p className="mt-1 text-sm text-muted-foreground">{line.sub}</p>}
          </div>
        ))}
      </div>
      {note && <p className="mt-4 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button className="h-11 sm:min-w-32" onClick={primary.onClick}>
          {primary.label}
        </Button>
        {secondary && (
          <Button variant="outline" className="h-11" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
      aria-label="Pages"
    >
      <span>{copy.common.pageOf(page, totalPages)}</span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="h-11"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {copy.common.previous}
        </Button>
        <Button
          variant="outline"
          className="h-11"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          {copy.common.next}
        </Button>
      </div>
    </nav>
  );
}
