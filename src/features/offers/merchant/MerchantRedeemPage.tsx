import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, KeyRound, Loader2, ScanLine, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { safeUuid } from "@/lib/utils";
import { formatCurrency } from "@/lib/currency";
import {
  counterRedeemApi,
  offerReasonText,
  type CounterRedemption,
  type PosOfferLookup,
} from "@/lib/api/offers";
import { QrCameraScanner } from "../components/QrCameraScanner";

/**
 * Confirm a customer's offer at the counter from any merchant phone or
 * computer (no POS needed). The server decides whether the code is valid for
 * this store; staff only confirm what it shows.
 */
export function MerchantRedeemPage() {
  const { merchantProfile } = useAuth();
  const currency = merchantProfile?.currency_symbol || "Rs";
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<PosOfferLookup | null>(null);
  const [bill, setBill] = useState("");
  const [done, setDone] = useState<CounterRedemption | null>(null);
  // One key per attempt so a double tap or network retry never redeems twice.
  const attemptKey = useRef(safeUuid());
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setCode("");
    setLookup(null);
    setBill("");
    setDone(null);
    setError(null);
    setScanning(false);
    attemptKey.current = safeUuid();
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function check(raw = code) {
    const value = raw.trim();
    if (!value) return;
    setScanning(false);
    setBusy(true);
    setError(null);
    setLookup(null);
    try {
      const result = await counterRedeemApi.lookup(value);
      setCode(value);
      setLookup(result);
      attemptKey.current = safeUuid();
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't check that code.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!lookup) return;
    if (lookup.needs_bill_amount && !(Number(bill) > 0)) {
      setError(`Enter the ${lookup.bill_label.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await counterRedeemApi.confirm({
        code,
        idempotency_key: attemptKey.current,
        ...(lookup.needs_bill_amount ? { bill_amount: bill } : {}),
      });
      setDone(result);
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't confirm the offer.");
    } finally {
      setBusy(false);
    }
  }

  const eligible = Boolean(lookup?.evaluation.eligible);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Customers</p>
        <h1 className="font-display mt-1 text-3xl text-foreground">Redeem Offer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan the customer's offer QR or type their code. Works on any phone, no POS needed.
        </p>
      </div>

      {done ? (
        <section className="rounded-3xl bg-emerald-50 p-6 text-center" role="status">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <p className="font-display mt-2 text-2xl text-emerald-800">Offer used</p>
          <p className="mt-1 text-sm text-emerald-900">{done.claim.offer.summary}</p>
          {done.discount_amount && (
            <p className="mt-3 text-sm text-emerald-900">
              Give <b>{formatCurrency(done.discount_amount, currency)}</b> off
              {done.bill_amount ? (
                <>
                  {" "}
                  — customer pays{" "}
                  <b>
                    {formatCurrency(
                      Number(done.bill_amount) - Number(done.discount_amount),
                      currency,
                    )}
                  </b>
                </>
              ) : null}
            </p>
          )}
          {!done.discount_amount && done.claim.offer.benefit_kind !== "percent_off" && (
            <p className="mt-3 text-sm text-emerald-900">Hand over the customer's reward.</p>
          )}
          <button
            onClick={reset}
            className="mt-5 h-11 w-full rounded-xl bg-ink text-sm font-bold text-primary-foreground"
          >
            Redeem another
          </button>
        </section>
      ) : (
        <section className="glass-strong space-y-4 rounded-3xl p-5">
          {scanning ? (
            <>
              <QrCameraScanner onResult={(text) => check(text)} />
              <button
                onClick={() => setScanning(false)}
                className="w-full text-center text-xs font-semibold text-muted-foreground"
              >
                Type the code instead
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setLookup(null);
                  setError(null);
                  setScanning(true);
                }}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-base font-bold text-primary-foreground"
              >
                <Camera className="h-5 w-5" /> Scan customer QR
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  check();
                }}
                className="flex gap-2"
              >
                <input
                  ref={inputRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="or type ZNT-XXXX-XXXXX"
                  aria-label="Offer code"
                  autoComplete="off"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-muted/40 px-3 font-mono text-sm uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-ink/20"
                />
                <button
                  type="submit"
                  disabled={busy || !code.trim()}
                  className="h-12 rounded-xl bg-mist px-4 text-sm font-bold text-foreground disabled:opacity-50"
                >
                  {busy && !lookup ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                </button>
              </form>
            </>
          )}

          {lookup && (
            <div className="space-y-3">
              <div className={`rounded-2xl p-4 ${eligible ? "bg-ember-soft" : "bg-rose-50"}`}>
                <p className="text-xs text-muted-foreground">
                  {lookup.customer_first_name
                    ? `${lookup.customer_first_name}'s offer`
                    : "Customer offer"}{" "}
                  · {lookup.code}
                </p>
                <p className="font-display text-xl text-ember">{lookup.offer.summary}</p>
                {lookup.offer.conditions.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lookup.offer.conditions.join(" · ")}
                  </p>
                )}
                {!eligible && (
                  <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-rose-700">
                    <XCircle className="h-4 w-4" />{" "}
                    {offerReasonText(lookup.evaluation.reason, currency)}
                  </p>
                )}
              </div>

              {eligible && lookup.needs_bill_amount && (
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground">
                    {lookup.bill_label} ({currency})
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={bill}
                    onChange={(e) => setBill(e.target.value)}
                    className="h-12 w-full rounded-xl border border-border bg-muted/40 px-3 text-base focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </label>
              )}

              {eligible && (
                <button
                  onClick={confirm}
                  disabled={busy}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ScanLine className="h-4 w-4" />
                  )}
                  Confirm and use offer
                </button>
              )}
              <button
                onClick={reset}
                className="w-full text-center text-xs font-semibold text-muted-foreground"
              >
                Start over
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}
        </section>
      )}

      <StorePinCard />
    </div>
  );
}

function StorePinCard() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["offers", "store-pin"],
    queryFn: counterRedeemApi.pinStatus,
  });
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setPin("");
      setAgain("");
      setError(null);
    }
  }, [editing]);

  async function save() {
    if (pin !== again) return setError("The two PINs don't match.");
    setBusy(true);
    setError(null);
    try {
      await counterRedeemApi.setPin(pin);
      toast.success("Store PIN saved.");
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["offers", "store-pin"] });
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't save the PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!window.confirm("Turn off PIN confirmation? Customers will need staff to scan their code."))
      return;
    await counterRedeemApi.clearPin();
    toast.success("PIN confirmation turned off.");
    queryClient.invalidateQueries({ queryKey: ["offers", "store-pin"] });
  }

  const enabled = status.data?.enabled;
  const pinInput =
    "h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-center font-mono text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-ink/20";

  return (
    <section className="rounded-3xl bg-card p-5" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-mist">
          <KeyRound className="h-5 w-5 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">Store PIN (backup)</p>
          <p className="text-xs text-muted-foreground">
            When you can't scan, staff can type this PIN on the customer's phone to confirm their
            offer. You'll get a notification each time it's used. Keep it private and change it if
            it leaks.
          </p>
          <p className="mt-2 text-xs font-semibold text-foreground">
            {status.isLoading ? "…" : enabled ? "On" : "Off"}
          </p>
        </div>
      </div>
      {editing ? (
        <div className="mt-4 space-y-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="New PIN (4–6 digits)"
            aria-label="New PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={pinInput}
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="Repeat PIN"
            aria-label="Repeat PIN"
            value={again}
            onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))}
            className={pinInput}
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="h-10 flex-1 rounded-xl bg-mist text-sm font-semibold text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy || pin.length < 4}
              className="h-10 flex-1 rounded-xl bg-ink text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              Save PIN
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setEditing(true)}
            className="h-10 flex-1 rounded-xl bg-ink text-sm font-bold text-primary-foreground"
          >
            {enabled ? "Change PIN" : "Set a PIN"}
          </button>
          {enabled && (
            <button
              onClick={turnOff}
              className="h-10 rounded-xl bg-mist px-4 text-sm font-semibold text-foreground"
            >
              Turn off
            </button>
          )}
        </div>
      )}
    </section>
  );
}
