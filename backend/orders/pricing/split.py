"""
Split-bill allocation.

Zentro does not have a split-bill feature yet (only split *payment*). This is
the allocation rule it must use when it does: each line goes to exactly one
bill with its own stored discount and tax, and order-level charges are shared
by each bill's goods value using largest remainder. By construction the bills
add up to the original total exactly.
"""

from __future__ import annotations

from .money import ZERO, allocate, currency_quantum
from .types import PricingError, PricingResult


def split_result(result: PricingResult, groups: list[list[str]]) -> list[dict]:
    keys = [key for group in groups for key in group]
    line_keys = [ln.key for ln in result.lines]
    if sorted(keys) != sorted(line_keys) or len(set(keys)) != len(keys):
        raise PricingError("Every line must be assigned to exactly one bill.", code="invalid_split")

    quantum = currency_quantum(result.currency_code)
    by_key = {ln.key: ln for ln in result.lines}
    weights = [sum((by_key[k].net_amount for k in group), ZERO) for group in groups]
    if sum(weights, ZERO) <= ZERO:
        weights = [ZERO for _ in groups]
        weights[0] = 1

    charge_amount = sum((c.amount for c in result.charges), ZERO)
    charge_tax = sum((c.tax for c in result.charges), ZERO)
    charge_shares = allocate(charge_amount, weights, quantum)
    charge_tax_shares = allocate(charge_tax, weights, quantum)

    bills = []
    for group, charge_share, charge_tax_share in zip(groups, charge_shares, charge_tax_shares):
        lines = [by_key[k] for k in group]
        tax = sum((ln.tax for ln in lines), ZERO) + charge_tax_share
        total = sum((ln.total for ln in lines), ZERO) + charge_share
        if not result.prices_include_tax:
            total += charge_tax_share
        bills.append({
            "line_keys": list(group),
            "subtotal": sum((ln.line_subtotal for ln in lines), ZERO),
            "discount": sum((ln.discount for ln in lines), ZERO),
            "charges": charge_share,
            "tax": tax,
            "total": total,
        })
    return bills
