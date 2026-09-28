"""
ChargeEngine: non-product charges (service charge, delivery, packaging, other).

Percentage charges are computed on the goods amount after order discounts.
Whether a charge is taxed is decided by the tax policy unless the charge says
otherwise explicitly; the TaxEngine then taxes it together with the lines.
"""

from __future__ import annotations

from decimal import Decimal

from .money import HUNDRED, ZERO, quantize
from .tax import TaxPolicy
from .types import CALC_FIXED, CALC_PERCENTAGE, ChargeResult, ChargeSpec, PricingError


def compute_charges(
    specs: tuple[ChargeSpec, ...],
    goods_amount: Decimal,
    policy: TaxPolicy,
    quantum: Decimal,
) -> list[ChargeResult]:
    results = []
    for spec in specs:
        if spec.calc_type == CALC_PERCENTAGE:
            amount = quantize(max(goods_amount, ZERO) * max(spec.value, ZERO) / HUNDRED, quantum)
        elif spec.calc_type == CALC_FIXED:
            amount = quantize(max(spec.value, ZERO), quantum)
        else:
            raise PricingError(f"Unknown charge type '{spec.calc_type}'.", code="unknown_charge_type")
        taxable = policy.charges_taxable if spec.taxable is None else (spec.taxable and policy.charges_taxable)
        results.append(ChargeResult(
            kind=spec.kind, label=spec.label, calc_type=spec.calc_type,
            value=spec.value, amount=amount, taxable=taxable,
        ))
    return results
