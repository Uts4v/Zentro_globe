import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Gift, Loader2, Percent, Repeat, Tag, X } from "lucide-react";
import { menuApi, type MenuCategory, type MenuItem } from "@/lib/api";
import {
  merchantOffersApi,
  type BenefitKind,
  type Campaign,
  type CampaignInput,
} from "@/lib/api/offers";
import { TargetPicker, type TargetRef } from "./TargetPicker";

type Draft = {
  title: string;
  description: string;
  terms: string;
  kind: BenefitKind;
  value: string;
  scope: "order" | "targets";
  benefitTargets: TargetRef[];
  qualifyingTargets: TargetRef[];
  qualifyingQuantity: number;
  rewardQuantity: number;
  rewardPercent: string;
  maxApplications: number;
  minOrder: string;
  maxDiscount: string;
  perCustomer: number;
  excludeSpecials: boolean;
  claimValidDays: string;
  startsAt: string;
  endsAt: string;
  maxClaims: string;
  maxRedemptions: string;
  visibility: "public" | "link_only";
  channels: "all" | "online" | "in_store";
  restoreOnCancel: boolean;
};

const EMPTY: Draft = {
  title: "",
  description: "",
  terms: "",
  kind: "percent_off",
  value: "10",
  scope: "order",
  benefitTargets: [],
  qualifyingTargets: [],
  qualifyingQuantity: 1,
  rewardQuantity: 1,
  rewardPercent: "100",
  maxApplications: 1,
  minOrder: "",
  maxDiscount: "",
  perCustomer: 1,
  excludeSpecials: true,
  claimValidDays: "",
  startsAt: "",
  endsAt: "",
  maxClaims: "",
  maxRedemptions: "",
  visibility: "public",
  channels: "all",
  restoreOnCancel: true,
};

const KINDS: Array<{ kind: BenefitKind; title: string; hint: string; icon: typeof Percent }> = [
  { kind: "percent_off", title: "Percentage off", hint: "e.g. 20% off your order", icon: Percent },
  { kind: "amount_off", title: "Amount off", hint: "e.g. Rs 200 off over Rs 1,000", icon: Tag },
  { kind: "free_item", title: "Free item", hint: "e.g. free coffee over Rs 800", icon: Gift },
  {
    kind: "buy_x_get_y",
    title: "Buy X get Y",
    hint: "e.g. buy a pizza, get a drink free",
    icon: Repeat,
  },
];

const STEPS = ["The offer", "Applies to", "Rules", "Availability", "Review"];

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromCampaign(c: Campaign): Draft {
  const pick = (role: "benefit" | "qualifying"): TargetRef[] =>
    c.targets
      .filter((t) => t.role === role)
      .map((t) => ({
        menu_item: t.menu_item ?? undefined,
        category: t.category ?? undefined,
        option: t.option ?? undefined,
        label: t.label ?? "",
      }));
  const b = c.benefit;
  return {
    title: c.title,
    description: c.description,
    terms: c.terms,
    kind: b?.kind ?? "percent_off",
    value: b?.value ?? "",
    scope: b?.scope ?? "order",
    benefitTargets: pick("benefit"),
    qualifyingTargets: pick("qualifying"),
    qualifyingQuantity: c.qualifying_quantity ?? 1,
    rewardQuantity: b?.reward_quantity ?? 1,
    rewardPercent: b?.reward_discount_percent ?? "100",
    maxApplications: b?.max_applications ?? 1,
    minOrder: c.min_order_amount ?? "",
    maxDiscount: c.max_discount_amount ?? "",
    perCustomer: c.per_customer_limit,
    excludeSpecials: c.exclude_discounted_items,
    claimValidDays: c.claim_valid_days ? String(c.claim_valid_days) : "",
    startsAt: toLocalInput(c.starts_at),
    endsAt: toLocalInput(c.ends_at),
    maxClaims: c.max_claims ? String(c.max_claims) : "",
    maxRedemptions: c.max_redemptions ? String(c.max_redemptions) : "",
    visibility: c.visibility,
    channels: c.channels,
    restoreOnCancel: c.restore_on_cancel,
  };
}

function sentence(d: Draft, symbol: string): string {
  const names = (ts: TargetRef[]) =>
    ts
      .map((t) => t.label)
      .slice(0, 2)
      .join(", ") || "items";
  const free = Number(d.rewardPercent) >= 100 ? "free" : `${d.rewardPercent}% off`;
  switch (d.kind) {
    case "percent_off":
      return `${d.value || "?"}% off ${d.scope === "order" ? "your order" : names(d.benefitTargets)}`;
    case "amount_off":
      return `${symbol} ${d.value || "?"} off ${d.scope === "order" ? "your order" : names(d.benefitTargets)}`;
    case "free_item":
      return `Get ${d.rewardQuantity > 1 ? `${d.rewardQuantity} ` : ""}${names(d.benefitTargets)} ${free}`;
    default:
      return `Buy ${d.qualifyingQuantity} ${names(d.qualifyingTargets)}, get ${d.rewardQuantity > 1 ? `${d.rewardQuantity} ` : ""}${names(d.benefitTargets)} ${free}`;
  }
}

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? null : n;
}

function toPayload(d: Draft, includeRules: boolean, initial: Draft | null): CampaignInput {
  const payload: CampaignInput = {
    title: d.title.trim(),
    description: d.description,
    terms: d.terms,
    max_claims: numOrNull(d.maxClaims),
    max_redemptions: numOrNull(d.maxRedemptions),
    visibility: d.visibility,
    restore_on_cancel: d.restoreOnCancel,
    claim_valid_days: numOrNull(d.claimValidDays),
  };
  // The date input has minute precision: only send dates the merchant changed,
  // or an untouched end date would look like it was moved earlier.
  if (!initial || d.startsAt !== initial.startsAt) {
    payload.starts_at = d.startsAt ? new Date(d.startsAt).toISOString() : null;
  }
  if (!initial || d.endsAt !== initial.endsAt) {
    payload.ends_at = d.endsAt ? new Date(d.endsAt).toISOString() : null;
  }
  if (!includeRules) return payload;
  const strip = (ts: TargetRef[], role: "benefit" | "qualifying") =>
    ts.map((t) => ({
      role,
      menu_item: t.menu_item ?? null,
      category: t.category ?? null,
      option: t.option ?? null,
    }));
  const itemBased = d.kind === "free_item" || d.kind === "buy_x_get_y";
  return {
    ...payload,
    channels: d.channels,
    per_customer_limit: d.perCustomer,
    min_order_amount: d.minOrder.trim() ? d.minOrder : null,
    max_discount_amount: d.maxDiscount.trim() ? d.maxDiscount : null,
    exclude_discounted_items: d.excludeSpecials,
    benefit: {
      kind: d.kind,
      scope: itemBased ? "targets" : d.scope,
      value: itemBased ? null : d.value,
      reward_quantity: d.rewardQuantity,
      reward_discount_percent: d.rewardPercent,
      max_applications: d.maxApplications,
    },
    qualifying_quantity: d.qualifyingQuantity,
    targets: [
      ...(itemBased || d.scope === "targets" ? strip(d.benefitTargets, "benefit") : []),
      ...(d.kind === "buy_x_get_y" ? strip(d.qualifyingTargets, "qualifying") : []),
    ],
  };
}

function stepError(step: number, d: Draft): string | null {
  if (step === 0) {
    if (d.kind === "percent_off" && !(Number(d.value) > 0 && Number(d.value) <= 100))
      return "Enter a percentage between 1 and 100.";
    if (d.kind === "amount_off" && !(Number(d.value) > 0)) return "Enter the amount off.";
  }
  if (step === 1) {
    if (
      (d.kind === "free_item" || d.kind === "buy_x_get_y" || d.scope === "targets") &&
      d.benefitTargets.length === 0
    )
      return d.kind === "percent_off" || d.kind === "amount_off"
        ? "Choose the products the discount applies to."
        : "Choose the free / reward item(s).";
    if (d.kind === "buy_x_get_y" && d.qualifyingTargets.length === 0)
      return "Choose what the customer must buy.";
  }
  if (step === 3 && d.startsAt && d.endsAt && new Date(d.endsAt) <= new Date(d.startsAt))
    return "The end must be after the start.";
  if (step === 4 && d.title.trim().length < 3)
    return "Give the offer a short title (3+ characters).";
  return null;
}

const input =
  "h-11 w-full rounded-xl border border-border bg-muted/40 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ink/20";
const labelCls = "mb-1.5 block text-xs uppercase tracking-widest text-muted-foreground";

export function CampaignWizard({
  campaign,
  currencySymbol,
  onClose,
  onSaved,
}: {
  campaign: Campaign | null;
  currencySymbol: string;
  onClose: () => void;
  onSaved: (c: Campaign) => void;
}) {
  const initial = useMemo(() => (campaign ? fromCampaign(campaign) : null), [campaign]);
  const [draft, setDraft] = useState<Draft>(initial ?? EMPTY);
  const [step, setStep] = useState(0);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rulesLocked = Boolean(campaign && campaign.claims_count > 0);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    Promise.all([menuApi.myItems(), menuApi.categories().catch(() => [] as MenuCategory[])]).then(
      ([i, c]) => {
        setItems(i);
        setCategories(c);
      },
    );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const summary = useMemo(() => sentence(draft, currencySymbol), [draft, currencySymbol]);
  const itemBased = draft.kind === "free_item" || draft.kind === "buy_x_get_y";

  function next() {
    const problem = rulesLocked && step < 3 ? null : stepError(step, draft);
    if (problem) return setError(problem);
    setError(null);
    if (step === 3 && !draft.title) set({ title: summary.slice(0, 120) });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  async function save(publish: boolean) {
    const problem = stepError(4, draft);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(draft, !rulesLocked, initial);
      let saved = campaign
        ? await merchantOffersApi.update(campaign.id, payload)
        : await merchantOffersApi.create(payload);
      if (publish && (saved.status === "draft" || saved.status === "paused")) {
        saved = await merchantOffersApi.action(
          saved.id,
          saved.status === "paused" ? "resume" : "publish",
        );
      }
      onSaved(saved);
    } catch (e: unknown) {
      setError((e as Error).message || "Couldn't save the offer.");
    } finally {
      setSaving(false);
    }
  }

  const locked = rulesLocked && step <= 2;

  const body = (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-title"
        className="glass-strong flex max-h-[94dvh] w-full max-w-xl flex-col rounded-t-3xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="wizard-title" className="font-display text-2xl text-foreground">
              {campaign ? "Edit offer" : "New offer"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="grid h-10 w-10 place-items-center rounded-full bg-mist text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="rounded-2xl bg-ember-soft px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Customers will see
            </p>
            <p className="font-display text-xl text-ember">{summary}</p>
          </div>

          {locked && (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Customers already hold this offer, so the deal itself can't change. Duplicate the
              offer to make a new version.
            </p>
          )}

          <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
            {step === 0 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {KINDS.map(({ kind, title, hint, icon: Icon }) => (
                    <button
                      type="button"
                      key={kind}
                      onClick={() => set({ kind })}
                      className={`rounded-2xl border p-3 text-left ${draft.kind === kind ? "border-ink bg-card" : "border-border bg-muted/30"}`}
                    >
                      <Icon className="h-4 w-4 text-ember" />
                      <p className="mt-1.5 text-sm font-bold text-foreground">{title}</p>
                      <p className="text-[11px] text-muted-foreground">{hint}</p>
                    </button>
                  ))}
                </div>
                {!itemBased && (
                  <div className="max-w-[12rem]">
                    <label className={labelCls} htmlFor="offer-value">
                      {draft.kind === "percent_off"
                        ? "Percent off"
                        : `Amount off (${currencySymbol})`}
                    </label>
                    <input
                      id="offer-value"
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.value}
                      onChange={(e) => set({ value: e.target.value })}
                      className={input}
                    />
                  </div>
                )}
              </>
            )}

            {step === 1 && (
              <>
                {!itemBased && (
                  <div className="flex gap-2">
                    {(["order", "targets"] as const).map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => set({ scope: s })}
                        className={`flex-1 rounded-xl py-2 text-sm font-semibold ${draft.scope === s ? "bg-ink text-primary-foreground" : "bg-mist text-foreground"}`}
                      >
                        {s === "order" ? "Whole order" : "Selected products"}
                      </button>
                    ))}
                  </div>
                )}
                {draft.kind === "buy_x_get_y" && (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-foreground">Customer buys</p>
                    <div className="max-w-[10rem]">
                      <label className={labelCls} htmlFor="buy-qty">
                        Quantity
                      </label>
                      <input
                        id="buy-qty"
                        type="number"
                        min={1}
                        value={draft.qualifyingQuantity}
                        onChange={(e) =>
                          set({ qualifyingQuantity: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className={input}
                      />
                    </div>
                    <TargetPicker
                      items={items}
                      categories={categories}
                      value={draft.qualifyingTargets}
                      onChange={(v) => set({ qualifyingTargets: v })}
                    />
                  </div>
                )}
                {(itemBased || draft.scope === "targets") && (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-foreground">
                      {itemBased
                        ? "Customer gets (they can choose one of these)"
                        : "Discount applies to"}
                    </p>
                    {itemBased && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={labelCls} htmlFor="get-qty">
                            Quantity
                          </label>
                          <input
                            id="get-qty"
                            type="number"
                            min={1}
                            value={draft.rewardQuantity}
                            onChange={(e) =>
                              set({ rewardQuantity: Math.max(1, Number(e.target.value) || 1) })
                            }
                            className={input}
                          />
                        </div>
                        <div>
                          <label className={labelCls} htmlFor="get-pct">
                            % off
                          </label>
                          <input
                            id="get-pct"
                            type="number"
                            min={1}
                            max={100}
                            value={draft.rewardPercent}
                            onChange={(e) => set({ rewardPercent: e.target.value })}
                            className={input}
                          />
                        </div>
                        {draft.kind === "buy_x_get_y" && (
                          <div>
                            <label className={labelCls} htmlFor="max-apps">
                              Times per order
                            </label>
                            <input
                              id="max-apps"
                              type="number"
                              min={1}
                              value={draft.maxApplications}
                              onChange={(e) =>
                                set({ maxApplications: Math.max(1, Number(e.target.value) || 1) })
                              }
                              className={input}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    <TargetPicker
                      items={items}
                      categories={categories}
                      value={draft.benefitTargets}
                      onChange={(v) => set({ benefitTargets: v })}
                    />
                  </div>
                )}
                {!itemBased && draft.scope === "order" && (
                  <p className="text-sm text-muted-foreground">
                    The discount applies to everything in the order.
                  </p>
                )}
              </>
            )}

            {step === 2 && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="min-order">
                    Minimum spend
                  </label>
                  <input
                    id="min-order"
                    type="number"
                    min={0}
                    placeholder="None"
                    value={draft.minOrder}
                    onChange={(e) => set({ minOrder: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="max-disc">
                    Maximum discount
                  </label>
                  <input
                    id="max-disc"
                    type="number"
                    min={0}
                    placeholder="No cap"
                    value={draft.maxDiscount}
                    onChange={(e) => set({ maxDiscount: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="per-cust">
                    Uses per customer
                  </label>
                  <input
                    id="per-cust"
                    type="number"
                    min={1}
                    max={100}
                    value={draft.perCustomer}
                    onChange={(e) => set({ perCustomer: Math.max(1, Number(e.target.value) || 1) })}
                    className={input}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="valid-days">
                    Use within (days)
                  </label>
                  <input
                    id="valid-days"
                    type="number"
                    min={1}
                    placeholder="Until offer ends"
                    value={draft.claimValidDays}
                    onChange={(e) => set({ claimValidDays: e.target.value })}
                    className={input}
                  />
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.excludeSpecials}
                    onChange={(e) => set({ excludeSpecials: e.target.checked })}
                  />
                  Don't apply to items already on Today's Special
                </label>
              </div>
            )}
          </fieldset>

          {step === 3 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="starts">
                  Starts
                </label>
                <input
                  id="starts"
                  type="datetime-local"
                  value={draft.startsAt}
                  disabled={rulesLocked}
                  onChange={(e) => set({ startsAt: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="ends">
                  Ends
                </label>
                <input
                  id="ends"
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(e) => set({ endsAt: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="max-claims">
                  Total claims
                </label>
                <input
                  id="max-claims"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={draft.maxClaims}
                  onChange={(e) => set({ maxClaims: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="max-red">
                  Total uses
                </label>
                <input
                  id="max-red"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={draft.maxRedemptions}
                  onChange={(e) => set({ maxRedemptions: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="visibility">
                  Who can find it
                </label>
                <select
                  id="visibility"
                  value={draft.visibility}
                  className={input}
                  onChange={(e) => set({ visibility: e.target.value as Draft["visibility"] })}
                >
                  <option value="public">Everyone (Offers page)</option>
                  <option value="link_only">Only with my link / QR poster</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="channels">
                  Where it works
                </label>
                <select
                  id="channels"
                  value={draft.channels}
                  className={input}
                  disabled={rulesLocked}
                  onChange={(e) => set({ channels: e.target.value as Draft["channels"] })}
                >
                  <option value="all">Online and in store</option>
                  <option value="online">Online orders only</option>
                  <option value="in_store">In store (POS) only</option>
                </select>
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={draft.restoreOnCancel}
                  onChange={(e) => set({ restoreOnCancel: e.target.checked })}
                />
                Give the offer back if an order using it is cancelled or refunded
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div>
                <label className={labelCls} htmlFor="title">
                  Title
                </label>
                <input
                  id="title"
                  maxLength={120}
                  value={draft.title}
                  onChange={(e) => set({ title: e.target.value })}
                  className={input}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="desc">
                  Description
                </label>
                <textarea
                  id="desc"
                  rows={2}
                  value={draft.description}
                  onChange={(e) => set({ description: e.target.value })}
                  className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="terms">
                  Terms (optional)
                </label>
                <textarea
                  id="terms"
                  rows={2}
                  value={draft.terms}
                  onChange={(e) => set({ terms: e.target.value })}
                  className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          <button
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={next}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-5 py-2.5 text-sm font-bold text-primary-foreground"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => save(false)}
                disabled={saving}
                className="rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground"
              >
                {campaign && campaign.status !== "draft" ? "Save" : "Save draft"}
              </button>
              {(!campaign || campaign.status === "draft" || campaign.status === "paused") && (
                <button
                  onClick={() => save(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-5 py-2.5 text-sm font-bold text-primary-foreground"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Publish
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
