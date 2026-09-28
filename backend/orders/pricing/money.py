"""
Money helpers for the pricing engine.

Every amount is a ``Decimal`` quantized to the currency's minor unit with
ROUND_HALF_UP, the same rounding the rest of Zentro already uses. Splitting an
amount across lines uses largest-remainder allocation so the parts always sum
exactly to the whole.
"""

from __future__ import annotations

from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

ZERO = Decimal("0")
HUNDRED = Decimal("100")

# ISO 4217 minor-unit exponents that differ from the default of 2.
_CURRENCY_EXPONENTS = {
    "JPY": 0, "KRW": 0, "VND": 0, "CLP": 0, "ISK": 0, "UGX": 0,
    "BHD": 3, "KWD": 3, "OMR": 3, "JOD": 3, "TND": 3, "LYD": 3, "IQD": 3,
}


def currency_quantum(currency_code: str | None) -> Decimal:
    exponent = _CURRENCY_EXPONENTS.get((currency_code or "").upper(), 2)
    return Decimal(1).scaleb(-exponent)


def to_decimal(value) -> Decimal:
    if value is None or value == "":
        return ZERO
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        # repr-exact conversion; never Decimal(float), which carries binary noise
        return Decimal(repr(value))
    return Decimal(str(value))


def quantize(amount, quantum: Decimal) -> Decimal:
    return to_decimal(amount).quantize(quantum, rounding=ROUND_HALF_UP)


def allocate(total: Decimal, weights: list[Decimal], quantum: Decimal) -> list[Decimal]:
    """
    Split ``total`` across ``weights`` proportionally, in whole minor units.

    Largest-remainder method: each share is floored, then the leftover units go
    to the largest fractional remainders (earlier index wins ties), so the
    result is deterministic and ``sum(result) == total`` exactly.
    """
    if not weights:
        return []
    total = quantize(total, quantum)
    weight_sum = sum(weights, ZERO)
    if total == ZERO or weight_sum <= ZERO:
        return [ZERO for _ in weights]

    total_units = int(total / quantum)
    raw = [Decimal(total_units) * w / weight_sum for w in weights]
    floors = [int(r.to_integral_value(rounding=ROUND_DOWN)) for r in raw]
    leftover = total_units - sum(floors)
    order = sorted(range(len(weights)), key=lambda i: (-(raw[i] - floors[i]), i))
    for i in order[:leftover]:
        floors[i] += 1
    return [Decimal(units) * quantum for units in floors]
