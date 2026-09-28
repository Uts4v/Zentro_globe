/**
 * The POS preview must agree with the backend on every golden vector.
 * Run with: npm run test:pricing
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewPricing, resolveTaxComponents } from "./preview.ts";

const vectorsUrl = new URL("../../../backend/orders/pricing/vectors.json", import.meta.url);
const { vectors } = JSON.parse(readFileSync(vectorsUrl, "utf-8"));

for (const v of vectors) {
  test(v.name, () => {
    const result = previewPricing({
      currency: v.currency,
      policy: v.policy,
      taxComponents: v.tax_components,
      lines: v.lines.map((ln: any) => ({
        key: ln.key,
        quantity: ln.quantity,
        unitPrice: ln.unit_price,
        listUnitPrice: ln.list_unit_price,
        taxClass: ln.tax_class,
      })),
      adjustment: v.adjustment
        ? {
            calcType: v.adjustment.calc_type,
            value: v.adjustment.value,
            maxAmount: v.adjustment.max_amount,
            minSubtotal: v.adjustment.min_subtotal,
            eligibleLineKeys: v.adjustment.eligible_line_keys,
          }
        : null,
      charges: (v.charges ?? []).map((c: any) => ({
        kind: c.kind,
        calcType: c.calc_type,
        value: c.value,
        taxable: c.taxable,
      })),
    });
    const exp = v.expected;
    assert.equal(result.subtotal, exp.subtotal, "subtotal");
    assert.equal(result.discountTotal, exp.discount_total, "discount_total");
    assert.equal(result.taxableTotal, exp.taxable_total, "taxable_total");
    assert.equal(result.taxTotal, exp.tax_total, "tax_total");
    assert.equal(result.chargeTotal, exp.charge_total, "charge_total");
    assert.equal(result.grandTotal, exp.grand_total, "grand_total");
    for (const [key, lineExp] of Object.entries<any>(exp.lines ?? {})) {
      const line = result.lines.find((l) => l.key === key)!;
      assert.equal(line.discount, lineExp.discount, `${key}.discount`);
      assert.equal(line.tax, lineExp.tax, `${key}.tax`);
      assert.equal(line.lineTotal, lineExp.line_total, `${key}.line_total`);
    }
    if (exp.taxes) {
      assert.deepEqual(result.taxes.map((t) => t.amount), exp.taxes);
    }
    if (exp.messages) {
      assert.deepEqual(
        result.messages.map((m) => ({ code: m.code, required: m.required, current: m.current, shortfall: m.shortfall })),
        exp.messages,
      );
    }
  });
}

test("tax components resolve like the backend", () => {
  assert.deepEqual(resolveTaxComponents({ tax_enabled: false, tax_components: [{ name: "VAT", rate: 13 }] }), []);
  assert.deepEqual(resolveTaxComponents({ tax_components: [], tax_rate_percent: "6.00" }), [
    { name: "VAT", rate: "6.00" },
  ]);
  assert.deepEqual(resolveTaxComponents({ tax_components: [{ name: "VAT", rate: 0 }], tax_rate_percent: "6" }), []);
});
