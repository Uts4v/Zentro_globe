import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore } from "../store";
import { posWorkerLogin, ShiftWorker } from "../api";
import { Lock, User, Delete, Loader2, UserPlus } from "lucide-react";

interface WorkerPinPadProps {
  onLoggedIn: (worker: ShiftWorker) => void;
}

export default function WorkerPinPad({ onLoggedIn }: WorkerPinPadProps) {
  const workers = usePosStore((s) => s.workers);
  const [selectedWorker, setSelectedWorker] = useState<ShiftWorker | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const maxPin = 4;

  async function handlePinComplete() {
    if (!selectedWorker || pin.length < maxPin) return;
    setLoading(true);
    setError(null);

    try {
      const result = await posWorkerLogin(selectedWorker.id, pin);
      onLoggedIn(result.worker);
    } catch (err: any) {
      setError(err?.message || "Invalid PIN. Please try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function handleDigit(d: string) {
    if (pin.length >= maxPin || loading) return;
    const newPin = pin + d;
    setPin(newPin);

    if (newPin.length === maxPin) {
      // Auto-submit after short delay
      setTimeout(() => {
        // Use functional update to get latest pin
        setPin((current) => {
          if (current.length === maxPin) {
            // We'll handle submission via the effect below
          }
          return current;
        });
      }, 150);
    }
  }

  // Auto-submit when pin reaches 4 digits
  if (pin.length === maxPin && !loading && !error) {
    // Can't call async in render — use setTimeout
    setTimeout(() => handlePinComplete(), 0);
  }

  function handleDelete() {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }

  function handleClear() {
    setPin("");
    setError(null);
  }

  // ── Worker selection ──
  if (!selectedWorker) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-ink/10">
              <User className="h-8 w-8 text-ink" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Who&apos;s working?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Select your name to start
            </p>
          </div>

          <div className="space-y-2">
            {workers.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelectedWorker(w)}
                className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:border-ink/20 hover:shadow-md active:scale-[0.98]"
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-ink text-lg font-bold text-white">
                  {w.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">
                    {w.display_name}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {w.role}
                  </p>
                </div>
                <Lock className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            {workers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No staff added yet.
                </p>
                <Link
                  to="/pos/staff"
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  <UserPlus className="h-4 w-4" />
                  Add your first staff member
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── PIN entry ──
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-xs">
        {/* Worker info */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-ink text-xl font-bold text-white">
            {selectedWorker.display_name.charAt(0).toUpperCase()}
          </div>
          <h2 className="text-lg font-bold text-foreground">
            {selectedWorker.display_name}
          </h2>
          <button
            onClick={() => {
              setSelectedWorker(null);
              setPin("");
              setError(null);
            }}
            className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Not you? Switch
          </button>
        </div>

        {/* PIN dots */}
        <div className="mb-6 flex justify-center gap-3">
          {Array.from({ length: maxPin }).map((_, i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full transition-all ${
                i < pin.length
                  ? "bg-ink scale-110"
                  : "border-2 border-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="mb-4 text-center text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              disabled={loading || pin.length >= maxPin}
              className="flex h-16 items-center justify-center rounded-2xl border border-border bg-card text-xl font-bold text-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-40"
            >
              {d}
            </button>
          ))}
          <button
            onClick={handleClear}
            disabled={loading || pin.length === 0}
            className="flex h-16 items-center justify-center rounded-2xl text-sm font-medium text-muted-foreground hover:bg-muted active:scale-95 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            onClick={() => handleDigit("0")}
            disabled={loading || pin.length >= maxPin}
            className="flex h-16 items-center justify-center rounded-2xl border border-border bg-card text-xl font-bold text-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-40"
          >
            0
          </button>
          <button
            onClick={handleDelete}
            disabled={loading || pin.length === 0}
            className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground hover:bg-muted active:scale-95 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Delete className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
