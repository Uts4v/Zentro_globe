/**
 * Client-side pricing PREVIEW — a line-for-line port of the backend engine
 * (backend/orders/pricing). The server is always the authority: this exists so
 * the POS can show the right total before (or without) a round trip, e.g. while
 * offline. Both implementations run the same golden vectors
 * (backend/orders/pricing/vectors.json) so they cannot drift apart.
 *
 * All money math is exact: amounts are BigInt minor units, rates are exact
 * decimals, and rounding is ROUND_HALF_UP like the backend's Decimal.
 */

export type TaxPolicyCode = "legacy" | "exclusive" | "inclusive";
type Num = string | number;

export interface PreviewLine {
  key: string;
  quantity: number;
  unitPrice: Num;
  listUnitPrice?: Num;
  taxClass?: string;
}

export interface PreviewAdjustment {
  label?: string;
  calcType: "percentage" | "fixed";
  value: Num;
  maxAmount?: Num | null;
  minSubtotal?: Num | null;
  eligibleLineKeys?: string[] | null;
}

export interface PreviewCharge {
  kind: string;
  label?: string;
  calcType: "percentage" | "fixed";
  value: Num;
  taxable?: boolean | null;
}

export interface PreviewContext {
  currency: string;
  policy: TaxPolicyCode | string;
  taxComponents: Array<{ name: string; rate: Num }>;
  lines: PreviewLine[];
  adjustment?: PreviewAdjustment | null;
  charges?: PreviewCharge[];
}

export interface PreviewMessage {
  code: string;
  required?: string;
  current?: string;
  shortfall?: string;
}

export interface PreviewResult {
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  taxTotal: string;
  chargeTotal: string;
  grandTotal: string;
  pricesIncludeTax: boolean;
  lines: Array<{ key: string; lineSubtotal: string; discount: string; tax: string; lineTotal: string }>;
  taxes: Array<{ name: string; rate: string; amount: string }>;
  charges: Array<{ kind: string; label: string; amount: string; tax: string; taxable: boolean }>;
  messages: PreviewMessage[];
}

const POLICIES: Record<string, { inclusive: boolean; discountReducesTaxable: boolean; chargesTaxable: boolean }> = {
  legacy: { inclusive: false, discountReducesTaxable: false, chargesTaxable: false },
  exclusive: { inclusive: false, discountReducesTaxable: true, chargesTaxable: true },
  inclusive: { inclusive: true, discountReducesTaxable: true, chargesTaxable: true },
};

const EXPONENTS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
};

export function currencyExponent(code: string): number {
  return EXPONENTS[(code || "").toUpperCase()] ?? 2;
}

// ── exact decimal helpers ──────────────────────────────────────────────────

interface Rational {
  n: bigint;
  d: bigint;
}

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

function parseDecimal(value: Num | null | undefined): Rational {
  if (value === null || value === undefined || value === "") return { n: 0n, d: 1n };
  let s = typeof value === "number" ? String(value) : value.trim();
  if (/e/i.test(s)) s = Number(s).toFixed(12);
  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) s = s.slice(1);
  const [intPart, fracPart = ""] = s.split(".");
  const digits = `${intPart || "0"}${fracPart}`.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(digits)) throw new Error(`Invalid amount: ${value}`);
  const n = BigInt(digits);
  return { n: negative ? -n : n, d: pow10(fracPart.length) };
}

/** Round n/d to an integer, ties away from zero (Decimal ROUND_HALF_UP). */
function roundDiv(n: bigint, d: bigint): bigint {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n < 0n) return -((-n * 2n + d) / (2n * d));
  return (n * 2n + d) / (2n * d);
}

function toMinor(value: Num | null | undefined, exp: number): bigint {
  const r = parseDecimal(value);
  return roundDiv(r.n * pow10(exp), r.d);
}

function formatMinor(units: bigint, exp: number): string {
  const negative = units < 0n;
  const abs = (negative ? -units : units).toString().padStart(exp + 1, "0");
  const text = exp === 0 ? abs : `${abs.slice(0, abs.length - exp)}.${abs.slice(abs.length - exp)}`;
  return negative ? `-${text}` : text;
}

/** A rate as the backend prints it: "13", "12.5" (no trailing zeros). */
function formatRate(r: Rational): string {
  if (r.d === 1n) return r.n.toString();
  return formatMinor(r.n, r.d.toString().length - 1).replace(/\.?0+$/, "");
}

const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

/** Largest-remainder split of `total` by integer `weights`; earlier index wins ties. */
function allocate(total: bigint, weights: bigint[]): bigint[] {
  const weightSum = sum(weights);
  if (total === 0n || weightSum <= 0n) return weights.map(() => 0n);
  const floors = weights.map((w) => (total * w) / weightSum);
  const remainders = weights.map((w) => (total * w) % weightSum);
  let leftover = total - sum(floors);
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b));
  for (const i of order) {
    if (leftover <= 0n) break;
    floors[i] += 1n;
    leftover -= 1n;
  }
  return floors;
}

/** Put rationals on a common integer scale so they can be used as weights. */
function commonScale(rs: Rational[]): bigint[] {
  const scale = rs.reduce((acc, r) => (r.d > acc ? r.d : acc), 1n);
  return rs.map((r) => (r.n * scale) / r.d);
}

// ── engine ─────────────────────────────────────────────────────────────────

export function previewPricing(ctx: PreviewContext): PreviewResult {
  const policy = POLICIES[ctx.policy] ?? POLICIES.legacy;
  const exp = currencyExponent(ctx.currency);
  const fmt = (u: bigint) => formatMinor(u, exp);

  const lines = ctx.lines.map((ln) => {
    const unit = toMinor(ln.unitPrice, exp);
    const listUnit = max(toMinor(ln.listUnitPrice ?? ln.unitPrice, exp), unit);
    const lineSubtotal = unit * BigInt(ln.quantity);
    return {
      key: ln.key,
      taxClass: ln.taxClass || "standard",
      lineSubtotal,
      listUnit,
      discount: 0n,
      net: lineSubtotal,
      taxable: 0n,
      tax: 0n,
      total: 0n,
    };
  });
  const subtotal = sum(lines.map((l) => l.lineSubtotal));

  // DiscountEngine
  let discountTotal = 0n;
  const messages: PreviewMessage[] = [];
  const adj = ctx.adjustment;
  if (adj) {
    const minSubtotal = adj.minSubtotal != null && adj.minSubtotal !== "" ? toMinor(adj.minSubtotal, exp) : null;
    if (minSubtotal !== null && subtotal < minSubtotal) {
      messages.push({
        code: "MINIMUM_ORDER_NOT_MET",
        required: fmt(minSubtotal),
        current: fmt(subtotal),
        shortfall: fmt(minSubtotal - subtotal),
      });
    } else {
      const keys = adj.eligibleLineKeys ? new Set(adj.eligibleLineKeys) : null;
      const eligible = lines.filter((l) => (!keys || keys.has(l.key)) && l.net > 0n);
      const base = sum(eligible.map((l) => l.net));
      if (eligible.length === 0 || base <= 0n) {
        if (keys) messages.push({ code: "NO_ELIGIBLE_ITEMS" });
      } else {
        let amount: bigint;
        if (adj.calcType === "percentage") {
          const pct = parseDecimal(adj.value);
          const clamped =
            pct.n < 0n ? { n: 0n, d: 1n } : pct.n > 100n * pct.d ? { n: 100n, d: 1n } : pct;
          amount = roundDiv(base * clamped.n, clamped.d * 100n);
        } else {
          amount = max(toMinor(adj.value, exp), 0n);
        }
        if (adj.maxAmount != null && adj.maxAmount !== "") amount = min(amount, toMinor(adj.maxAmount, exp));
        amount = min(amount, base);
        const shares = allocate(amount, eligible.map((l) => l.net));
        eligible.forEach((l, i) => {
          l.discount += shares[i];
          l.net -= shares[i];
        });
        discountTotal = amount;
      }
    }
  }

  // ChargeEngine
  const goods = sum(lines.map((l) => l.net));
  const charges = (ctx.charges ?? []).map((c) => {
    let amount: bigint;
    if (c.calcType === "percentage") {
      const rate = parseDecimal(c.value);
      amount = roundDiv(max(goods, 0n) * max(rate.n, 0n), rate.d * 100n);
    } else {
      amount = max(toMinor(c.value, exp), 0n);
    }
    const taxable = c.taxable == null ? policy.chargesTaxable : c.taxable && policy.chargesTaxable;
    return { kind: c.kind, label: c.label ?? c.kind, amount, taxable, tax: 0n };
  });

  // TaxEngine
  const components = ctx.taxComponents
    .map((c) => ({ name: c.name || "Tax", rate: parseDecimal(c.rate) }))
    .filter((c) => c.rate.n > 0n);
  const lineBases = lines.map((l) => {
    if (l.taxClass !== "standard" || components.length === 0) return 0n;
    return policy.discountReducesTaxable ? l.net : l.lineSubtotal;
  });
  const chargeBases = charges.map((c) => (c.taxable && components.length ? c.amount : 0n));
  const gross = sum(lineBases) + sum(chargeBases);

  let componentAmounts: bigint[] = components.map(() => 0n);
  let taxTotal = 0n;
  if (gross > 0n && components.length) {
    if (policy.inclusive) {
      const scaled = commonScale(components.map((c) => c.rate));
      const scale = components.reduce((acc, c) => (c.rate.d > acc ? c.rate.d : acc), 1n);
      const rateSum = sum(scaled); // total rate × scale
      taxTotal = roundDiv(gross * rateSum, 100n * scale + rateSum);
      componentAmounts = allocate(taxTotal, scaled);
    } else {
      componentAmounts = components.map((c) => roundDiv(gross * c.rate.n, c.rate.d * 100n));
      taxTotal = sum(componentAmounts);
    }
  }
  const shares = allocate(taxTotal, [...lineBases, ...chargeBases]);
  lines.forEach((l, i) => {
    l.tax = shares[i];
    if (policy.inclusive) {
      l.taxable = lineBases[i] > 0n ? lineBases[i] - l.tax : 0n;
      l.total = l.net;
    } else {
      l.taxable = lineBases[i];
      l.total = l.net + l.tax;
    }
  });
  charges.forEach((c, i) => {
    c.tax = shares[lines.length + i];
  });

  const chargeTotal = sum(charges.map((c) => c.amount));
  const grandTotal = policy.inclusive
    ? subtotal - discountTotal + chargeTotal
    : subtotal - discountTotal + chargeTotal + taxTotal;
  const chargeTaxable = sum(
    charges.filter((c) => c.taxable).map((c) => (policy.inclusive ? c.amount - c.tax : c.amount)),
  );

  return {
    subtotal: fmt(subtotal),
    discountTotal: fmt(discountTotal),
    taxableTotal: fmt(sum(lines.map((l) => l.taxable)) + chargeTaxable),
    taxTotal: fmt(taxTotal),
    chargeTotal: fmt(chargeTotal),
    grandTotal: fmt(grandTotal),
    pricesIncludeTax: policy.inclusive,
    lines: lines.map((l) => ({
      key: l.key,
      lineSubtotal: fmt(l.lineSubtotal),
      discount: fmt(l.discount),
      tax: fmt(l.tax),
      lineTotal: fmt(l.total),
    })),
    taxes: components
      .map((c, i) => ({ name: c.name, rate: formatRate(c.rate), amount: fmt(componentAmounts[i]) }))
      .filter((_, i) => componentAmounts[i] > 0n),
    charges: charges.map((c) => ({
      kind: c.kind,
      label: c.label,
      amount: fmt(c.amount),
      tax: fmt(c.tax),
      taxable: c.taxable,
    })),
    messages,
  };
}

/**
 * The tax components a merchant's settings resolve to, mirroring the backend
 * `resolve_components`: nothing when tax is off, otherwise the configured
 * components, falling back to the legacy single rate when none are set.
 */
export function resolveTaxComponents(settings: {
  tax_enabled?: boolean;
  tax_components?: Array<{ name: string; rate: Num }> | null;
  tax_rate_percent?: Num | null;
}): Array<{ name: string; rate: Num }> {
  if (settings.tax_enabled === false) return [];
  const configured = settings.tax_components ?? [];
  if (configured.length) return configured.filter((c) => parseDecimal(c.rate).n > 0n);
  const legacy = parseDecimal(settings.tax_rate_percent ?? 0);
  return legacy.n > 0n ? [{ name: "VAT", rate: String(settings.tax_rate_percent) }] : [];
}
