// src/routes/offline.tsx
import { createFileRoute } from "@tanstack/react-router";
import { WifiOff, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/offline")({
  head: () => ({ meta: [{ title: "Offline · Zentro" }] }),
  component: OfflinePage,
});

function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-muted">
        <WifiOff className="h-7 w-7 text-muted-foreground" />
      </div>
      <h1 className="mt-5 font-display text-3xl text-foreground">You're offline</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
        Your saved app shell is available, but live points, orders and rewards need an internet
        connection.
      </p>
      <div className="mt-6 space-y-2 text-xs text-muted-foreground">
        <p>• Points unavailable offline</p>
        <p>• Order status requires connection</p>
        <p>• Rewards may have changed</p>
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-sm font-medium text-primary-foreground shadow-ember transition-all active:scale-[0.98]"
      >
        <RefreshCw className="h-4 w-4" />
        Try again
      </button>
    </div>
  );
}
