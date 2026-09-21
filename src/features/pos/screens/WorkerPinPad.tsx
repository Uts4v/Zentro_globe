import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore } from "../store";
import { posWorkerLogin, ShiftWorker } from "../api";
import { Lock, User, Delete, Loader2, UserPlus, Keyboard } from "lucide-react";

interface WorkerPinPadProps {
  onLoggedIn: (worker: ShiftWorker) => void;
}

export default function WorkerPinPad({ onLoggedIn }: WorkerPinPadProps) {
  const workers = usePosStore((s) => s.workers);
  const [selectedWorker, setSelectedWorker] = useState<ShiftWorker | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const maxPin = 4;

  const handlePinComplete = useCallback(async () => {
    if (!selectedWorker || pin.length < maxPin || loading) return;
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
  }, [selectedWorker, pin, loading, onLoggedIn]);

  const handleDigit = useCallback(
    (d: string) => {
      if (pin.length >= maxPin || loading) return;
      setPin((prev) => (prev + d).slice(0, maxPin));
    },
    [pin, loading, maxPin],
  );

  const handleDelete = useCallback(() => {
    setPin((p) => p.slice(0, -1));
    setError(null);
  }, []);

  const handleClear = useCallback(() => {
    setPin("");
    setError(null);
  }, []);

  const backToSelection = useCallback(() => {
    setSelectedWorker(null);
    setPin("");
    setError(null);
  }, []);

  // Auto-submit when the PIN reaches the required length
  useEffect(() => {
    if (pin.length === maxPin && selectedWorker && !loading) {
      const timer = setTimeout(() => handlePinComplete(), 0);
      return () => clearTimeout(timer);
    }
  }, [pin, selectedWorker, loading, maxPin, handlePinComplete]);

  // Keyboard: worker selection screen
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (selectedWorker || loading || workers.length === 0) return;
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + workers.length) % workers.length);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % workers.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        setSelectedWorker(workers[selectedIndex]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWorker, workers, selectedIndex, loading]);

  // Keyboard: PIN entry screen
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!selectedWorker || loading) return;
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (pin.length === maxPin) handlePinComplete();
      } else if (e.key === "Escape") {
        e.preventDefault();
        backToSelection();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedWorker, pin, loading, handleDigit, handleDelete, handlePinComplete, backToSelection]);

  // ── Worker selection ──
  if (!selectedWorker) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-ink/10">
              <User className="h-8 w-8 text-ink" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Who&apos;s working?</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Select your name, or use the arrow keys + Enter
            </p>
          </div>

          <div className="space-y-2">
            {workers.map((w, i) => (
              <button
                key={w.id}
                onClick={() => setSelectedWorker(w)}
                className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all hover:border-ink/20 hover:shadow-md active:scale-[0.98] ${
                  i === selectedIndex
                    ? "border-ink/40 bg-ink/5 ring-2 ring-ink/20"
                    : "border-border bg-card"
                }`}
              >
                <div className="grid h-12 w-12 place-items-center rounded-full bg-ink text-lg font-bold text-white">
                  {w.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-foreground">{w.display_name}</p>
                  <p className="text-xs capitalize text-muted-foreground">{w.role}</p>
                </div>
                <Lock className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}

            {workers.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">No staff added yet.</p>
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

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" />
            Tip: arrow keys to pick, Enter to select
          </p>
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
          <h2 className="text-lg font-bold text-foreground">{selectedWorker.display_name}</h2>
          <button
            onClick={backToSelection}
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
                i < pin.length ? "bg-ink scale-110" : "border-2 border-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && <p className="mb-4 text-center text-sm font-medium text-destructive">{error}</p>}

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

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Keyboard className="h-3.5 w-3.5" />
          Tip: type digits, Backspace to fix, Enter to submit, Esc to switch
        </p>
      </div>
    </div>
  );
}
