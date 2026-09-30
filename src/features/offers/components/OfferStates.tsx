import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div className={cn("rounded-lg bg-muted motion-safe:animate-pulse", className)} />;
}

/** Matches OfferCard: image, merchant line, badge, title, text, footer + button. */
export function OfferCardSkeleton() {
  return (
    <div
      className="flex overflow-hidden rounded-[22px] border border-border bg-card md:flex-col"
      aria-hidden="true"
    >
      <Bone className="min-h-[190px] w-[38%] rounded-none md:aspect-[16/10] md:min-h-0 md:w-full" />
      <div className="flex flex-1 flex-col gap-2.5 p-4 md:p-5">
        <div className="flex items-center gap-2">
          <Bone className="h-7 w-7 rounded-full" />
          <Bone className="h-3 w-24" />
        </div>
        <Bone className="h-5 w-24 rounded-full" />
        <Bone className="h-5 w-4/5" />
        <Bone className="h-3 w-full" />
        <div className="mt-2 flex items-end justify-between">
          <Bone className="h-3 w-16" />
          <Bone className="h-10 w-24 rounded-[14px]" />
        </div>
      </div>
    </div>
  );
}

export function WalletCardSkeleton() {
  return (
    <div
      className="flex gap-4 rounded-[22px] border border-border bg-card p-4 sm:p-5"
      aria-hidden="true"
    >
      <div className="flex flex-1 flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <Bone className="h-8 w-8 rounded-full" />
          <Bone className="h-3 w-28" />
        </div>
        <Bone className="h-5 w-28 rounded-full" />
        <Bone className="h-5 w-3/4" />
        <Bone className="h-3 w-1/2" />
      </div>
      <Bone className="h-16 w-16 rounded-xl" />
    </div>
  );
}

export function OfferDetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:gap-12" aria-hidden="true">
      <Bone className="aspect-[4/3] w-full rounded-[24px]" />
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Bone className="h-11 w-11 rounded-full" />
          <Bone className="h-4 w-40" />
        </div>
        <Bone className="mt-2 h-6 w-32 rounded-full" />
        <Bone className="h-10 w-4/5" />
        <Bone className="h-4 w-full" />
        <Bone className="mt-4 h-24 w-full rounded-2xl" />
        <Bone className="mt-4 h-14 w-full rounded-2xl" />
      </div>
    </div>
  );
}

export function OfferEmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-[24px] border border-dashed border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-oat text-primary">
        <Icon className="h-6 w-6" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <p className="mt-4 text-base font-bold text-foreground">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
