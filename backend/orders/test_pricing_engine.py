"""
Pure pricing-engine tests: golden vectors, invariants, split bills.

Run with: python manage.py test orders.test_pricing_engine
"""

import json
import random
from decimal import Decimal
from pathlib import Path

from django.test import SimpleTestCase

from orders.pricing import (
    AdjustmentSpec,
    ChargeSpec,
    LineInput,
    PricingContext,
    PricingError,
    TaxComponent,
    allocate,
    calculate,
    split_result,
)
from orders.pricing.tax import POLICIES
from merchants.models import MerchantProfile

VECTORS = json.loads((Path(__file__).parent / "pricing" / "vectors.json").read_text(encoding="utf-8"))["vectors"]


def context_from_vector(v):
    adjustments = ()
    if v.get("adjustment"):
        a = v["adjustment"]
        adjustments = (AdjustmentSpec(
            kind="manual_discount",
            calc_type=a["calc_type"],
            value=Decimal(a["value"]),
            max_amount=Decimal(a["max_amount"]) if a.get("max_amount") else None,
            min_subtotal=Decimal(a["min_subtotal"]) if a.get("min_subtotal") else None,
            eligible_line_keys=frozenset(a["eligible_line_keys"]) if a.get("eligible_line_keys") else None,
        ),)
    return PricingContext(
        currency_code=v["currency"],
        policy_code=v["policy"],
        tax_enabled=bool(v["tax_components"]),
        tax_components=tuple(TaxComponent(c["name"], Decimal(c["rate"])) for c in v["tax_components"]),
        lines=tuple(
            LineInput(
                key=ln["key"], name=ln["key"], quantity=ln["quantity"],
                unit_price=Decimal(ln["unit_price"]),
                list_unit_price=Decimal(ln.get("list_unit_price", ln["unit_price"])),
                tax_class=ln.get("tax_class", "standard"),
            )
            for ln in v["lines"]
        ),
        adjustments=adjustments,
        charges=tuple(
            ChargeSpec(kind=c["kind"], label=c["kind"], calc_type=c["calc_type"],
                       value=Decimal(c["value"]), taxable=c.get("taxable"))
            for c in v.get("charges", [])
        ),
    )


class GoldenVectorTests(SimpleTestCase):
    def test_vectors(self):
        for v in VECTORS:
            with self.subTest(v["name"]):
                result = calculate(context_from_vector(v)).to_dict()
                exp = v["expected"]
                for field in ("subtotal", "discount_total", "taxable_total", "tax_total",
                              "charge_total", "grand_total"):
                    self.assertEqual(result[field], exp[field], field)
                for key, line_exp in exp.get("lines", {}).items():
                    line = next(ln for ln in result["lines"] if ln["key"] == key)
                    for field, value in line_exp.items():
                        self.assertEqual(line[field], value, f"{key}.{field}")
                if "taxes" in exp:
                    self.assertEqual([t["amount"] for t in result["taxes"]], exp["taxes"])
                if "messages" in exp:
                    got = [{k: m[k] for k in exp["messages"][0]} for m in result["messages"]]
                    self.assertEqual(got, exp["messages"])

    def test_policy_choices_match_merchant_field(self):
        field = MerchantProfile._meta.get_field("tax_policy")
        self.assertEqual({c for c, _ in field.choices}, set(POLICIES))


class InvariantTests(SimpleTestCase):
    """Random baskets must always reconcile to the cent."""

    def test_random_baskets_reconcile(self):
        rng = random.Random(20260928)
        for _ in range(400):
            policy = rng.choice(list(POLICIES))
            lines = tuple(
                LineInput(
                    key=str(i), name=str(i), quantity=rng.randint(1, 5),
                    unit_price=Decimal(rng.randint(0, 250000)) / 100,
                    list_unit_price=Decimal(0),
                    tax_class=rng.choice(["standard", "standard", "exempt"]),
                )
                for i in range(rng.randint(1, 8))
            )
            adjustments = ()
            if rng.random() < 0.7:
                adjustments = (AdjustmentSpec(
                    kind="manual_discount",
                    calc_type=rng.choice(["percentage", "fixed"]),
                    value=Decimal(rng.randint(1, 5000)) / 100,
                ),)
            charges = ()
            if rng.random() < 0.5:
                charges = (ChargeSpec(kind="service", label="s", calc_type="percentage",
                                      value=Decimal(rng.choice([5, 10, 12.5]))),)
            comps = rng.choice([(), (TaxComponent("VAT", Decimal("13")),),
                                (TaxComponent("CGST", Decimal("2.5")), TaxComponent("SGST", Decimal("2.5")))])
            ctx = PricingContext("NPR", policy, bool(comps), comps, lines, adjustments, charges)
            result = calculate(ctx)

            self.assertEqual(result.discount_total, sum((ln.discount for ln in result.lines), Decimal(0)))
            self.assertEqual(result.tax_total,
                             sum((ln.tax for ln in result.lines), Decimal(0)) + sum((c.tax for c in result.charges), Decimal(0)))
            self.assertGreaterEqual(result.grand_total, Decimal(0))
            for ln in result.lines:
                self.assertGreaterEqual(ln.net_amount, Decimal(0))

            keys = [ln.key for ln in lines]
            rng.shuffle(keys)
            cut = rng.randint(1, len(keys))
            groups = [keys[:cut], keys[cut:]] if keys[cut:] else [keys]
            bills = split_result(result, groups)
            self.assertEqual(sum((b["total"] for b in bills), Decimal(0)), result.grand_total)

    def test_allocate_is_exact_and_deterministic(self):
        q = Decimal("0.01")
        self.assertEqual(allocate(Decimal("100"), [Decimal(1)] * 3, q),
                         [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")])
        self.assertEqual(sum(allocate(Decimal("0.05"), [Decimal(7), Decimal(3)], q)), Decimal("0.05"))
        self.assertEqual(allocate(Decimal("10"), [Decimal(0), Decimal(0)], q), [Decimal(0), Decimal(0)])


class SplitBillTests(SimpleTestCase):
    def test_split_preserves_total_with_discount_tax_and_service(self):
        ctx = PricingContext(
            "NPR", "exclusive", True, (TaxComponent("VAT", Decimal("13")),),
            (
                LineInput("a", "A", 1, Decimal("600"), Decimal("600")),
                LineInput("b", "B", 1, Decimal("400"), Decimal("400")),
            ),
            (AdjustmentSpec("manual_discount", "percentage", Decimal("10")),),
            (ChargeSpec("service", "Service", "percentage", Decimal("10")),),
        )
        result = calculate(ctx)
        bills = split_result(result, [["a"], ["b"]])
        self.assertEqual(bills[0]["total"] + bills[1]["total"], result.grand_total)
        self.assertEqual(bills[0]["discount"], Decimal("60.00"))

    def test_split_rejects_missing_or_duplicate_lines(self):
        ctx = PricingContext("NPR", "legacy", False, (), (
            LineInput("a", "A", 1, Decimal("1"), Decimal("1")),
            LineInput("b", "B", 1, Decimal("1"), Decimal("1")),
        ))
        result = calculate(ctx)
        with self.assertRaises(PricingError):
            split_result(result, [["a"]])
        with self.assertRaises(PricingError):
            split_result(result, [["a", "b"], ["b"]])
