// src/features/inventory/screens/StockChangeScreens.tsx
// Move Stock, Record Waste and Fix Stock. Each asks a few plain questions,
// confirms the consequence, and then shows exactly what changed. A failed
// request says clearly that nothing changed; retries reuse the same
// idempotency key so a double tap never records twice.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import {
  inventoryApi,
  type Adjustment,
  type InventoryItem,
  type Transfer,
  type WasteRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  ChoiceGroup,
  ConfirmDialog,
  ErrorBlock,
  Field,
  QuantityInput,
  ScreenHeader,
  StickyActions,
  SuccessPanel,
  errorMessage,
  formatQty,
  inputCls,
  parseAmount,
  uid,
} from "@/features/inventory/components/bits";
import { ItemPicker, LocationSelect } from "@/features/inventory/components/ItemPicker";
import {
  stockAtLocation,
  usePreselectedItem,
} from "@/features/inventory/components/usePreselectedItem";
import { copy } from "@/features/inventory/copy";
import { useInventory, useLocations } from "@/features/inventory/context";

function useDefaultLocation(set: (id: number) => void, current: number | null) {
  const locations = useLocations();
  useEffect(() => {
    if (current === null && locations.active.length) {
      set(locations.active.find((l) => l.is_default)?.id ?? locations.active[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations.active, current]);
  return locations;
}

// ── Move Stock ────────────────────────────────────────────────────────────────

export function MoveScreen() {
  const c = copy.move;
  const { go, params, refresh } = useInventory();
  const [from, setFrom] = useState<number | null>(params.location ?? null);
  const [to, setTo] = useState<number | null>(null);
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Transfer | null>(null);
  const locations = useDefaultLocation((id) => setFrom(id), from);

  usePreselectedItem(params.item, (picked) => {
    setItem(picked);
    const holding = picked.locations.find((l) => Number(l.on_hand) > 0);
    setFrom(picked.default_location ?? holding?.location ?? null);
  });

  const available = stockAtLocation(item, from);
  const amount = parseAmount(qty);
  const fromName = locations.active.find((l) => l.id === from)?.name ?? "";
  const toName = locations.active.find((l) => l.id === to)?.name ?? "";

  function validate() {
    if (!from || !to || !item || !amount || amount <= 0) return copy.delivery.needItem;
    if (from === to) return c.samePlace;
    return "";
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.createTransfer({
        from_location: from,
        to_location: to,
        note: note.trim(),
        complete: true,
        lines: [{ item_id: item!.id, quantity: String(amount) }],
      });
      setConfirming(false);
      setResult(res);
      refresh();
      toast.success(c.toast(formatQty(amount), item!.base_unit_code, item!.name, toName));
    } catch (e) {
      setConfirming(false);
      setError(`${c.failed} ${errorMessage(e, "")}`.trim());
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const line = result.results?.[0];
    return (
      <SuccessPanel
        title={c.successTitle}
        lines={[
          {
            label: item?.name ?? "",
            value: `${formatQty(amount)} ${item?.base_unit_code ?? ""}`,
            sub: line
              ? `${result.from_name}: ${formatQty(line.from_stock)} ${line.unit} · ${result.to_name}: ${formatQty(line.to_stock)} ${line.unit}`
              : `${result.from_name} → ${result.to_name}`,
          },
        ]}
        primary={{ label: copy.common.done, onClick: () => go("home") }}
        secondary={{
          label: c.moveAnother,
          onClick: () => {
            setResult(null);
            setItem(null);
            setQty("");
            setNote("");
          },
        }}
      />
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const problem = validate();
        if (problem) setError(problem);
        else {
          setError("");
          setConfirming(true);
        }
      }}
    >
      <ScreenHeader title={c.title} onBack={() => go("actions")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={c.from} htmlFor="move-from">
          <LocationSelect
            id="move-from"
            value={from}
            onChange={setFrom}
            locations={locations.active}
          />
        </Field>
        <Field label={c.to} htmlFor="move-to">
          <LocationSelect
            id="move-to"
            value={to}
            onChange={setTo}
            locations={locations.active.filter((l) => l.id !== from)}
          />
        </Field>
      </div>
      <Field
        label={c.what}
        htmlFor="move-item"
        hint={item && from ? c.available(formatQty(available), item.base_unit_code) : undefined}
      >
        <ItemPicker id="move-item" value={item} onChange={setItem} locationId={from} />
      </Field>
      <Field label={c.howMuch} htmlFor="move-qty">
        <QuantityInput
          id="move-qty"
          value={qty}
          onChange={setQty}
          unit={item?.base_unit_code}
          large
        />
      </Field>
      <Field label={c.note} htmlFor="move-note" optional>
        <input
          id="move-note"
          className={inputCls}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {error && <ErrorBlock message={error} />}
      <StickyActions>
        <Button type="button" variant="outline" className="h-12" onClick={() => go("actions")}>
          {copy.common.cancel}
        </Button>
        <Button type="submit" className="h-12 sm:min-w-40">
          {c.submit}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={c.confirmTitle}
        busy={busy}
        confirmLabel={c.submit}
        onConfirm={submit}
        body={
          <p className="text-base text-foreground">
            {formatQty(amount)} {item?.base_unit_code} {item?.name}: {fromName} → {toName}
          </p>
        }
      />
    </form>
  );
}

// ── Record Waste ──────────────────────────────────────────────────────────────

const WASTE_REASONS = [
  "SPOILED",
  "EXPIRED",
  "DROPPED",
  "DAMAGED",
  "OVER_PREPARED",
  "KITCHEN_MISTAKE",
  "CUSTOMER_RETURN",
  "STAFF_MEAL",
  "OTHER",
] as const;
type WasteReason = (typeof WASTE_REASONS)[number];

export function WasteScreen() {
  const c = copy.waste;
  const { go, params, refresh } = useInventory();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [qty, setQty] = useState("");
  const [location, setLocation] = useState<number | null>(params.location ?? null);
  const [reason, setReason] = useState<WasteReason | "">("");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WasteRecord | null>(null);
  const key = useRef(uid("waste"));
  const locations = useDefaultLocation((id) => setLocation(id), location);

  usePreselectedItem(params.item, (picked) => {
    setItem(picked);
    if (picked.default_location) setLocation(picked.default_location);
  });

  const amount = parseAmount(qty);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.recordWaste({
        inventory_item: item!.id,
        location,
        quantity: String(amount),
        reason,
        custom_reason: reason === "OTHER" ? custom.trim() : "",
        note: note.trim(),
        idempotency_key: key.current,
      });
      setConfirming(false);
      setResult(res);
      refresh();
      toast.success(c.toast(formatQty(amount), item!.base_unit_code, item!.name));
    } catch (e) {
      setConfirming(false);
      setError(`${c.failed} ${errorMessage(e, "")}`.trim());
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <SuccessPanel
        title={c.successTitle}
        lines={[
          {
            label: result.item_name,
            value: `−${formatQty(result.quantity)} ${result.unit_code}`,
            sub: `${result.location_name} · ${c.reasons[result.reason] ?? result.reason_label} · ${copy.delivery.newStock}: ${formatQty(result.new_stock)} ${result.unit_code}`,
          },
        ]}
        primary={{ label: copy.common.done, onClick: () => go("home") }}
        secondary={{
          label: c.recordMore,
          onClick: () => {
            setResult(null);
            setItem(null);
            setQty("");
            setReason("");
            setCustom("");
            setNote("");
            key.current = uid("waste");
          },
        }}
      />
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!item || !location || !amount || amount <= 0 || !reason) {
          setError(copy.delivery.needItem);
          return;
        }
        setError("");
        setConfirming(true);
      }}
    >
      <ScreenHeader title={c.title} onBack={() => go("actions")} />
      <Field label={c.what} htmlFor="waste-item">
        <ItemPicker id="waste-item" value={item} onChange={setItem} locationId={location} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={c.howMuch} htmlFor="waste-qty">
          <QuantityInput
            id="waste-qty"
            value={qty}
            onChange={setQty}
            unit={item?.base_unit_code}
            large
          />
        </Field>
        <Field label={c.where} htmlFor="waste-location">
          <LocationSelect
            id="waste-location"
            value={location}
            onChange={setLocation}
            locations={locations.active}
          />
        </Field>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">{c.why}</p>
        <ChoiceGroup
          label={c.why}
          value={reason}
          onChange={setReason}
          columns={3}
          options={WASTE_REASONS.map((r) => ({ value: r, label: c.reasons[r] }))}
        />
      </div>
      {reason === "OTHER" && (
        <Field label={c.otherReason} htmlFor="waste-custom">
          <input
            id="waste-custom"
            className={inputCls}
            value={custom}
            maxLength={120}
            onChange={(e) => setCustom(e.target.value)}
          />
        </Field>
      )}
      <Field label={c.note} htmlFor="waste-note" optional>
        <input
          id="waste-note"
          className={inputCls}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {error && <ErrorBlock message={error} />}
      <StickyActions>
        <Button type="button" variant="outline" className="h-12" onClick={() => go("actions")}>
          {copy.common.cancel}
        </Button>
        <Button type="submit" className="h-12 sm:min-w-40">
          {c.submit}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={c.confirmTitle}
        busy={busy}
        danger
        confirmLabel={c.submit}
        onConfirm={submit}
        body={
          <>
            <p className="text-base text-foreground">
              {formatQty(amount)} {item?.base_unit_code} {item?.name} ·{" "}
              {reason ? c.reasons[reason] : ""}
            </p>
            <p>{c.confirmBody}</p>
          </>
        }
      />
    </form>
  );
}

// ── Fix Stock (manager) ───────────────────────────────────────────────────────

export function FixScreen() {
  const c = copy.fix;
  const { go, params, refresh, root } = useInventory();
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [location, setLocation] = useState<number | null>(params.location ?? null);
  const [direction, setDirection] = useState<"add" | "remove" | "">("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Adjustment | null>(null);
  const key = useRef(uid("fix"));
  const locations = useDefaultLocation((id) => setLocation(id), location);

  usePreselectedItem(params.item, (picked) => {
    setItem(picked);
    if (picked.default_location) setLocation(picked.default_location);
  });

  // Fresh numbers for the chosen item (the picker result may be a bit old).
  const fresh = useQuery({
    queryKey: ["inventory", "item", item?.id],
    queryFn: () => inventoryApi.itemDetail(item!.id),
    enabled: Boolean(item),
  });
  const current = stockAtLocation(fresh.data ?? item, location);
  const amount = parseAmount(qty) ?? 0;
  const after = direction === "remove" ? current - amount : current + amount;
  const finalReason =
    reason === c.reasons[c.reasons.length - 1] ? customReason.trim() || reason : reason;
  const needsApproval =
    root.adjustment_approval_required && !root.permissions["inventory.approve_adjustment"];

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await inventoryApi.createAdjustment({
        inventory_item: item!.id,
        location,
        quantity_delta: String(direction === "remove" ? -amount : amount),
        reason: finalReason,
        note: note.trim(),
        idempotency_key: key.current,
      });
      setConfirming(false);
      setResult(res);
      refresh();
      if (res.status === "APPROVED")
        toast.success(c.toast(formatQty(res.new_stock), res.unit_code, res.item_name));
    } catch (e) {
      setConfirming(false);
      setError(`${c.failed} ${errorMessage(e, "")}`.trim());
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const pending = result.status === "PENDING";
    return (
      <SuccessPanel
        tone={pending ? "info" : "success"}
        title={pending ? c.pendingTitle : c.successTitle}
        note={pending ? c.pendingBody : undefined}
        lines={[
          {
            label: result.item_name,
            value: `${Number(result.quantity_delta) > 0 ? "+" : "−"}${formatQty(Math.abs(Number(result.quantity_delta)))} ${result.unit_code}`,
            sub: pending
              ? `${result.location_name} · ${result.reason}`
              : `${result.location_name} · ${copy.delivery.newStock}: ${formatQty(result.new_stock)} ${result.unit_code}`,
          },
        ]}
        primary={{ label: copy.common.done, onClick: () => go("home") }}
        secondary={{
          label: c.fixAnother,
          onClick: () => {
            setResult(null);
            setItem(null);
            setQty("");
            setDirection("");
            setReason("");
            setNote("");
            key.current = uid("fix");
          },
        }}
      />
    );
  }

  return (
    <form
      className="mx-auto max-w-2xl space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!item || !location || !direction || amount <= 0 || !finalReason) {
          setError(copy.delivery.needItem);
          return;
        }
        setError("");
        setConfirming(true);
      }}
    >
      <ScreenHeader title={c.title} onBack={() => go("actions")} />
      <Field label={c.item} htmlFor="fix-item">
        <ItemPicker id="fix-item" value={item} onChange={setItem} locationId={location} />
      </Field>
      <Field label={c.where} htmlFor="fix-location">
        <LocationSelect
          id="fix-location"
          value={location}
          onChange={setLocation}
          locations={locations.active}
        />
      </Field>
      {item && (
        <div className="rounded-2xl bg-muted/60 px-4 py-3">
          <p className="text-sm text-muted-foreground">{c.current}</p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {formatQty(current)}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {item.base_unit_code}
            </span>
          </p>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-sm font-medium text-foreground">{c.change}</p>
        <ChoiceGroup
          label={c.change}
          value={direction}
          onChange={setDirection}
          options={[
            { value: "add", label: c.add, icon: Plus },
            { value: "remove", label: c.remove, icon: Minus },
          ]}
        />
      </div>
      <Field label={c.amount} htmlFor="fix-qty">
        <QuantityInput
          id="fix-qty"
          value={qty}
          onChange={setQty}
          unit={item?.base_unit_code}
          large
        />
      </Field>
      <Field label={c.why} htmlFor="fix-reason">
        <select
          id="fix-reason"
          className={inputCls}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="" disabled>
            {copy.itemForm.choose}
          </option>
          {c.reasons.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      {reason === c.reasons[c.reasons.length - 1] && (
        <Field label={copy.waste.otherReason} htmlFor="fix-custom">
          <input
            id="fix-custom"
            className={inputCls}
            value={customReason}
            maxLength={200}
            onChange={(e) => setCustomReason(e.target.value)}
          />
        </Field>
      )}
      <Field label={c.note} htmlFor="fix-note" optional>
        <input
          id="fix-note"
          className={inputCls}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {error && <ErrorBlock message={error} />}
      <StickyActions>
        <Button type="button" variant="outline" className="h-12" onClick={() => go("actions")}>
          {copy.common.cancel}
        </Button>
        <Button type="submit" className="h-12 sm:min-w-40">
          {c.submit}
        </Button>
      </StickyActions>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={c.confirmTitle}
        busy={busy}
        confirmLabel={c.submit}
        onConfirm={submit}
        body={
          <>
            <p className="text-base text-foreground">
              {item?.name}: {direction === "remove" ? "−" : "+"}
              {formatQty(amount)} {item?.base_unit_code} · {finalReason}
            </p>
            <p>
              {needsApproval
                ? c.needsApproval
                : c.willBecome(formatQty(after), item?.base_unit_code ?? "")}
            </p>
          </>
        }
      />
    </form>
  );
}
