"""
DiscountEngine: turns stored order-level adjustments into line allocations.

Adjustments come from server-side sources only (a POS manual discount record,
a loyalty/punch reward, a future promotion). Each is re-evaluated on every
pricing run, so a percentage discount follows the basket and a minimum-spend
rule is re-checked whenever the order changes.

Engine-wise, several adjustments can be applied in sequence (each on what the
previous ones left); the one-discount-per-order rule is a V1 business policy
enforced by the service, not a limit of this module or the schema.
"""

from __future__ import annotations

from decimal import Decimal

from .money import HUNDRED, ZERO, allocate, quantize
from .types import (
    CALC_FIXED,
    CALC_PERCENTAGE,
    REASON_MINIMUM_ORDER_NOT_MET,
    REASON_NO_ELIGIBLE_ITEMS,
    AdjustmentSpec,
    DiscountResult,
    PricedLineResult,
    PricingError,
)


def _ineligible(spec: AdjustmentSpec, reason: dict) -> DiscountResult:
    return DiscountResult(
        kind=spec.kind, calc_type=spec.calc_type, value=spec.value, label=spec.label,
        source_ref=spec.source_ref, eligible=False, amount=ZERO, reason=reason,
    )


def evaluate_adjustment(
    spec: AdjustmentSpec,
    lines: list[PricedLineResult],
    order_subtotal: Decimal,
    quantum: Decimal,
) -> DiscountResult:
    """Compute one adjustment against lines' *remaining* (net) amounts."""
    if spec.min_subtotal is not None and order_subtotal < spec.min_subtotal:
        shortfall = quantize(spec.min_subtotal - order_subtotal, quantum)
        return _ineligible(spec, {
            "code": REASON_MINIMUM_ORDER_NOT_MET,
            "required": str(quantize(spec.min_subtotal, quantum)),
            "current": str(quantize(order_subtotal, quantum)),
            "shortfall": str(shortfall),
        })

    eligible = [
        ln for ln in lines
        if (spec.eligible_line_keys is None or ln.key in spec.eligible_line_keys)
        and ln.net_amount > ZERO
    ]
    base = sum((ln.net_amount for ln in eligible), ZERO)
    if not eligible or base <= ZERO:
        if spec.eligible_line_keys is not None:
            return _ineligible(spec, {"code": REASON_NO_ELIGIBLE_ITEMS})
        return DiscountResult(
            kind=spec.kind, calc_type=spec.calc_type, value=spec.value, label=spec.label,
            source_ref=spec.source_ref, eligible=True, amount=ZERO,
        )

    if spec.calc_type == CALC_PERCENTAGE:
        pct = min(max(spec.value, ZERO), HUNDRED)
        amount = quantize(base * pct / HUNDRED, quantum)
    elif spec.calc_type == CALC_FIXED:
        amount = quantize(max(spec.value, ZERO), quantum)
    else:
        raise PricingError(f"Unknown discount type '{spec.calc_type}'.", code="unknown_discount_type")

    if spec.max_amount is not None:
        amount = min(amount, quantize(spec.max_amount, quantum))
    amount = min(amount, base)

    shares = allocate(amount, [ln.net_amount for ln in eligible], quantum)
    allocations = {}
    for ln, share in zip(eligible, shares):
        if share > ZERO:
            ln.discount += share
            ln.net_amount -= share
            allocations[ln.key] = share

    return DiscountResult(
        kind=spec.kind, calc_type=spec.calc_type, value=spec.value, label=spec.label,
        source_ref=spec.source_ref, eligible=True, amount=amount, allocations=allocations,
    )


def apply_adjustments(
    specs: tuple[AdjustmentSpec, ...],
    lines: list[PricedLineResult],
    quantum: Decimal,
) -> list[DiscountResult]:
    order_subtotal = sum((ln.line_subtotal for ln in lines), ZERO)
    return [evaluate_adjustment(spec, lines, order_subtotal, quantum) for spec in specs]
