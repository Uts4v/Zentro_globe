import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePosStore, isConnectionError } from "../store";
import { posWorkerLogin, posStaffLogin, ShiftWorker } from "../api";
import { staffSession } from "@/lib/staff-session";
import {
  Lock,
  User,
  Delete,
  Loader2,
  UserPlus,
  Keyboard,
  Hash,
  Store,
  ArrowRight,
  ArrowLeft,
  KeyRound,
} from "lucide-react";

interface WorkerPinPadProps {
  onLoggedIn: (worker: ShiftWorker) => void;
}

type Mode = "code" | "list";

export default function WorkerPinPad({ onLoggedIn }: WorkerPinPadProps) {
  const workers = usePosStore((s) => s.workers);
  const currentMerchant = usePosStore((s) => s.merchant);
  const setMerchant = usePosStore((s) => s.setMerchant);
  const setDevice = usePosStore((s) => s.setDevice);

  // If workers are preloaded on an authorized terminal, list mode is available
  const [mode, setMode] = useState<Mode>(workers.length > 0 ? "list" : "code");

  // Code mode state: step 1 = staff code, step 2 = pin
  const [codeStep, setCodeStep] = useState<"code" | "pin">("code");
  const [staffCode, setStaffCode] = useState("");
  const [storeSlug, setStoreSlug] = useState(currentMerchant?.slug || "");
  const [showStoreInput, setShowStoreInput] = useState(false);

  // List mode state
  const [selectedWorker, setSelectedWorker] = useState<ShiftWorker | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // PIN state
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const maxPin = 4;

  // ── Handle Staff Code + PIN Submission ──
  const handleStaffCodeLogin = useCallback(async () => {
    if (!staffCode || pin.length < maxPin || loading) return;
    setLoading(true);
    setError(null);

    try {
      const res = await posStaffLogin({
        staff_code: staffCode,
        pin,
        store: storeSlug.trim() || undefined,
        platform: navigator.userAgent.includes("Mobile") ? "mobile" : "desktop",
      });

      // Save staff session token and permissions
      staffSession.set({
        token: res.token,
        name: res.worker.display_name,
        role: res.worker.role_name || res.worker.role,
        workerId: res.worker.id,
        staffCode: res.worker.staff_code,
        permissions: res.permissions || res.worker.permissions || [],
        merchantSlug: res.merchant?.slug,
        merchantName: res.merchant?.business_name,
      });

      // If device credentials returned, update device state
      if (res.device && res.device_token) {
        localStorage.setItem("pos_device_id", res.device.id);
        localStorage.setItem("pos_device_token", res.device_token);
        setDevice(res.device, res.device_token);
      }

      // If merchant returned, update merchant state
      if (res.merchant) {
        setMerchant(res.merchant);
      }

      onLoggedIn(res.worker);
    } catch (err: any) {
      if (err?.code === "store_required") {
        setShowStoreInput(true);
        setError("Multiple stores have this code. Please enter your store name or slug.");
      } else {
        setError(
          isConnectionError(err)
            ? "No connection — login requires server access. Check your internet connection."
            : err?.message || "Invalid Staff Code or PIN. Please try again.",
        );
      }
      setPin("");
    } finally {
      setLoading(false);
    }
  }, [staffCode, pin, storeSlug, loading, onLoggedIn, setDevice, setMerchant]);

  // ── Handle Selected Worker + PIN Submission ──
  const handleWorkerListLogin = useCallback(async () => {
    if (!selectedWorker || pin.length < maxPin || loading) return;
    setLoading(true);
    setError(null);

    try {
      const result = await posWorkerLogin(selectedWorker.id, pin);

      // Save staff session
      staffSession.set({
        token: result.token || "",
        name: result.worker.display_name,
        role: result.worker.role_name || result.worker.role,
        workerId: result.worker.id,
        staffCode: result.worker.staff_code,
        permissions: result.permissions || result.worker.permissions || [],
      });

      onLoggedIn(result.worker);
    } catch (err: any) {
      setError(
        isConnectionError(err)
          ? "No connection — a PIN can only be checked by the server. Try again when it is back."
          : err?.message || "Invalid PIN. Please try again.",
      );
      setPin("");
    } finally {
      setLoading(false);
    }
  }, [selectedWorker, pin, loading, onLoggedIn]);

  // Digits input helper
  const handleDigit = useCallback(
    (d: string) => {
      if (loading) return;
      if (mode === "code" && codeStep === "code") {
        setStaffCode((prev) => (prev + d).slice(0, 8));
        setError(null);
      } else {
        if (pin.length >= maxPin) return;
        setPin((prev) => (prev + d).slice(0, maxPin));
        setError(null);
      }
    },
    [loading, mode, codeStep, pin.length, maxPin],
  );

  const handleDelete = useCallback(() => {
    if (mode === "code" && codeStep === "code") {
      setStaffCode((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => prev.slice(0, -1));
    }
    setError(null);
  }, [mode, codeStep]);

  const handleClear = useCallback(() => {
    if (mode === "code" && codeStep === "code") {
      setStaffCode("");
    } else {
      setPin("");
    }
    setError(null);
  }, [mode, codeStep]);

  // Auto-submit PIN when 4 digits entered
  useEffect(() => {
    if (pin.length === maxPin && !loading) {
      if (mode === "code" && staffCode) {
        const timer = setTimeout(() => handleStaffCodeLogin(), 50);
        return () => clearTimeout(timer);
      } else if (mode === "list" && selectedWorker) {
        const timer = setTimeout(() => handleWorkerListLogin(), 50);
        return () => clearTimeout(timer);
      }
    }
  }, [pin, loading, mode, staffCode, selectedWorker, maxPin, handleStaffCodeLogin, handleWorkerListLogin]);

  // Keyboard navigation & typing
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Don't intercept if user is typing in store input
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;

      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleDelete();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (mode === "code") {
          if (codeStep === "code" && staffCode.length >= 3) {
            setCodeStep("pin");
          } else if (codeStep === "pin" && pin.length >= maxPin) {
            handleStaffCodeLogin();
          }
        } else if (mode === "list") {
          if (!selectedWorker && workers.length > 0) {
            setSelectedWorker(workers[selectedIndex]);
          } else if (selectedWorker && pin.length >= maxPin) {
            handleWorkerListLogin();
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (mode === "code" && codeStep === "pin") {
          setCodeStep("code");
          setPin("");
          setError(null);
        } else if (mode === "list" && selectedWorker) {
          setSelectedWorker(null);
          setPin("");
          setError(null);
        }
      } else if (mode === "list" && !selectedWorker && workers.length > 0) {
        if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + workers.length) % workers.length);
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % workers.length);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    mode,
    codeStep,
    staffCode,
    pin,
    selectedWorker,
    workers,
    selectedIndex,
    handleDigit,
    handleDelete,
    handleStaffCodeLogin,
    handleWorkerListLogin,
  ]);

  // Keypad numbers grid
  const keypad = (
    <div className="grid grid-cols-3 gap-3">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => handleDigit(d)}
          disabled={loading}
          className="flex h-16 items-center justify-center rounded-2xl border border-border bg-card text-2xl font-bold text-foreground transition-all hover:bg-muted active:scale-95 disabled:opacity-40"
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        onClick={handleClear}
        disabled={loading}
        className="flex h-16 items-center justify-center rounded-2xl text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-40"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={() => handleDigit("0")}
        disabled={loading}
        className="flex h-16 items-center justify-center rounded-2xl border border-border bg-card text-2xl font-bold text-foreground transition-all hover:bg-muted active:scale-95 disabled:opacity-40"
      >
        0
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={loading}
        className="flex h-16 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-muted active:scale-95 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Delete className="h-6 w-6" />}
      </button>
    </div>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // MODE 1: STAFF CODE LOGIN
  // ═══════════════════════════════════════════════════════════════════════════
  if (mode === "code") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10">
              {codeStep === "code" ? (
                <Hash className="h-7 w-7 text-primary" />
              ) : (
                <KeyRound className="h-7 w-7 text-primary" />
              )}
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              {codeStep === "code" ? "Staff Login" : "Enter Security PIN"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {codeStep === "code"
                ? "Enter your 4-digit Staff Code to begin"
                : `Staff Code: ${staffCode}`}
            </p>
          </div>

          {/* Mode Switcher if workers exist */}
          {workers.length > 0 && (
            <div className="mb-6 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setMode("list");
                  setError(null);
                  setPin("");
                }}
                className="rounded-xl border border-border px-3.5 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              >
                Or choose your name from list →
              </button>
            </div>
          )}

          {/* Store Slug field if required/needed */}
          {showStoreInput && (
            <div className="mb-4 space-y-1">
              <label className="text-xs font-medium text-foreground">Store Name or Slug</label>
              <div className="relative flex items-center">
                <Store className="absolute left-3 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="e.g. downtown-branch"
                  value={storeSlug}
                  onChange={(e) => setStoreSlug(e.target.value)}
                  className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          )}

          {/* Display Display value: Code or PIN dots */}
          {codeStep === "code" ? (
            <div className="mb-6">
              <div className="flex h-16 items-center justify-center rounded-2xl border-2 border-primary/30 bg-card px-4 font-mono text-3xl font-bold tracking-widest text-foreground shadow-inner">
                {staffCode || <span className="text-muted-foreground/40 font-normal text-xl tracking-normal">Staff Code</span>}
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <div className="flex justify-center gap-3 py-3">
                {Array.from({ length: maxPin }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-4 w-4 rounded-full transition-all ${
                      i < pin.length ? "bg-primary scale-125" : "border-2 border-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <div className="mt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setCodeStep("code");
                    setPin("");
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Change Staff Code
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="mb-4 text-center text-sm font-medium text-destructive">{error}</p>}

          {/* Keypad */}
          {keypad}

          {/* Next Button for Code step */}
          {codeStep === "code" && (
            <button
              type="button"
              disabled={staffCode.length < 3 || loading}
              onClick={() => {
                setCodeStep("pin");
                setError(null);
              }}
              className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-bold text-primary-foreground shadow-sm transition hover:bg-primary-hover disabled:opacity-40"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          )}

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" />
            Keyboard supported: type digits & press Enter
          </p>

          <div className="mt-6 border-t border-border pt-4 text-center">
            <Link
              to="/auth/merchant"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Merchant / Admin Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODE 2: CHOOSE FROM WORKER LIST
  // ═══════════════════════════════════════════════════════════════════════════

  // Step 2a: Worker is selected → PIN pad
  if (selectedWorker) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-xs">
          {/* Worker info */}
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-xl font-bold text-primary">
              {selectedWorker.display_name.charAt(0).toUpperCase()}
            </div>
            <h2 className="text-xl font-bold text-foreground">{selectedWorker.display_name}</h2>
            <p className="text-xs font-medium text-muted-foreground capitalize">
              {selectedWorker.role_name || selectedWorker.role}
              {selectedWorker.staff_code ? ` · Code: ${selectedWorker.staff_code}` : ""}
            </p>
            <button
              type="button"
              onClick={() => {
                setSelectedWorker(null);
                setPin("");
                setError(null);
              }}
              className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            >
              ← Not you? Switch staff
            </button>
          </div>

          {/* PIN dots */}
          <div className="mb-6 flex justify-center gap-3 py-2">
            {Array.from({ length: maxPin }).map((_, i) => (
              <div
                key={i}
                className={`h-4 w-4 rounded-full transition-all ${
                  i < pin.length ? "bg-primary scale-125" : "border-2 border-muted-foreground/30"
                }`}
              />
            ))}
          </div>

          {/* Error */}
          {error && <p className="mb-4 text-center text-sm font-medium text-destructive">{error}</p>}

          {/* Keypad */}
          {keypad}

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" />
            Type digits, Backspace to fix, Esc to switch
          </p>
        </div>
      </div>
    );
  }

  // Step 2b: Pick worker from list
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
            <User className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Who&apos;s working?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select your account or use your Staff Code
          </p>
        </div>

        {/* Toggle to code mode */}
        <div className="mb-6 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setMode("code");
              setCodeStep("code");
              setError(null);
              setPin("");
            }}
            className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
          >
            <Hash className="h-3.5 w-3.5" /> Log in using Staff Code & PIN
          </button>
        </div>

        <div className="space-y-2">
          {workers.map((w, i) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                setSelectedWorker(w);
                setPin("");
                setError(null);
              }}
              className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all hover:border-primary/40 hover:shadow-md active:scale-[0.98] ${
                i === selectedIndex
                  ? "border-primary/40 bg-primary/5 ring-2 ring-primary/20"
                  : "border-border bg-card"
              }`}
            >
              <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                {w.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{w.display_name}</p>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {w.role_name || w.role}
                  </span>
                </div>
                {w.staff_code && (
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    Code: {w.staff_code}
                  </p>
                )}
              </div>
              <Lock className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}

          {workers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">No staff preloaded on this terminal.</p>
              <button
                type="button"
                onClick={() => setMode("code")}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                <Hash className="h-4 w-4" />
                Sign in with Staff Code
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Keyboard className="h-3.5 w-3.5" />
          Tip: arrow keys to pick, Enter to select
        </p>

        <div className="mt-6 border-t border-border pt-4 text-center">
          <Link
            to="/auth/merchant"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Merchant / Admin Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
