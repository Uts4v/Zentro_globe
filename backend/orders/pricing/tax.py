"""
TaxEngine and tax policies.

A tax policy describes *how* tax behaves (inclusive or exclusive prices, whether
discounts reduce the taxable value, whether charges are taxed). Rates come from
the merchant's validated ``tax_components``. Policies are defined here in code,
not edited by merchants: choosing one is a Zentro-controlled setting
(``MerchantProfile.tax_policy``, changeable by platform admins), because the
calculation order is a legal question, not a preference.

Rounding: each tax component is computed on the invoice-level taxable base and
rounded once (ROUND_HALF_UP), exactly as Zentro has always done. The rounded
tax is then allocated back to lines and charges by largest remainder, so line
taxes always add up to the invoice tax.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .money import HUNDRED, ZERO, allocate, quantize, to_decimal
from .types import (
    TAX_CLASS_STANDARD,
    ChargeResult,
    PricedLineResult,
    PricingError,
    TaxComponent,
    TaxComponentResult,
)


@dataclass(frozen=True)
class TaxPolicy:
    code: str
    label: str
    prices_include_tax: bool
    discount_reduces_taxable: bool
    charges_taxable: bool


POLICY_LEGACY = "legacy"
POLICY_EXCLUSIVE = "exclusive"
POLICY_INCLUSIVE = "inclusive"

POLICIES: dict[str, TaxPolicy] = {
    # Zentro's behaviour before pricing v1: tax on the full price before any
    # order discount, charges untaxed. Default for existing merchants so their
    # totals do not change until the business decides to switch.
    POLICY_LEGACY: TaxPolicy(
        code=POLICY_LEGACY,
        label="Tax on full price, before discounts (legacy)",
        prices_include_tax=False,
        discount_reduces_taxable=False,
        charges_taxable=False,
    ),
    # Tax added at checkout on the discounted value (VAT/GST style, e.g. Nepal
    # VAT, India GST, US sales tax on the post-discount price).
    POLICY_EXCLUSIVE: TaxPolicy(
        code=POLICY_EXCLUSIVE,
        label="Tax added at checkout; discounts reduce the taxable value",
        prices_include_tax=False,
        discount_reduces_taxable=True,
        charges_taxable=True,
    ),
    # Menu prices already include tax, which is extracted (e.g. UK VAT,
    # Australian GST).
    POLICY_INCLUSIVE: TaxPolicy(
        code=POLICY_INCLUSIVE,
        label="Prices include tax; discounts reduce the taxable value",
        prices_include_tax=True,
        discount_reduces_taxable=True,
        charges_taxable=True,
    ),
}

POLICY_CHOICES = [(code, policy.label) for code, policy in POLICIES.items()]


def get_policy(code: str | None) -> TaxPolicy:
    try:
        return POLICIES[code or POLICY_LEGACY]
    except KeyError:
        raise PricingError(f"Unknown tax policy '{code}'.", code="unknown_tax_policy")


def resolve_components(merchant) -> tuple[TaxComponent, ...]:
    """The merchant's live tax components, with the legacy single-rate fallback."""
    if not getattr(merchant, "tax_enabled", True):
        return ()
    components = []
    for comp in getattr(merchant, "tax_components", None) or []:
        rate = to_decimal(comp.get("rate", 0))
        if rate > ZERO:
            components.append(TaxComponent(name=str(comp.get("name") or "Tax"), rate=rate))
    if components or (getattr(merchant, "tax_components", None) or []):
        return tuple(components)
    legacy_rate = to_decimal(getattr(merchant, "tax_rate_percent", 0))
    if legacy_rate > ZERO:
        return (TaxComponent(name="VAT", rate=legacy_rate),)
    return ()


def components_to_json(components) -> list[dict]:
    return [{"name": c.name, "rate": str(c.rate)} for c in components]


def components_from_json(rows) -> tuple[TaxComponent, ...]:
    return tuple(
        TaxComponent(name=str(r.get("name") or "Tax"), rate=to_decimal(r.get("rate")))
        for r in rows or []
        if to_decimal(r.get("rate")) > ZERO
    )


def apply_tax(
    lines: list[PricedLineResult],
    charges: list[ChargeResult],
    components: tuple[TaxComponent, ...],
    policy: TaxPolicy,
    quantum: Decimal,
) -> list[TaxComponentResult]:
    """
    Fill ``taxable_amount``, ``tax`` and ``total`` on every line and charge and
    return the per-component tax breakdown.
    """
    line_bases = []
    for line in lines:
        taxable = line.tax_class == TAX_CLASS_STANDARD and bool(components)
        if not taxable:
            line_bases.append(ZERO)
        elif policy.discount_reduces_taxable:
            line_bases.append(line.net_amount)
        else:
            line_bases.append(line.line_subtotal)
    charge_bases = [c.amount if (c.taxable and components) else ZERO for c in charges]

    gross_base = sum(line_bases, ZERO) + sum(charge_bases, ZERO)
    rate_total = sum((c.rate for c in components), ZERO)

    if gross_base <= ZERO or rate_total <= ZERO:
        component_amounts = [ZERO for _ in components]
        tax_total = ZERO
    elif policy.prices_include_tax:
        # Extract the tax contained in the gross amount, then split it across
        # components in proportion to their rates.
        net = gross_base * HUNDRED / (HUNDRED + rate_total)
        tax_total = quantize(gross_base - net, quantum)
        component_amounts = allocate(tax_total, [c.rate for c in components], quantum)
    else:
        component_amounts = [quantize(gross_base * c.rate / HUNDRED, quantum) for c in components]
        tax_total = sum(component_amounts, ZERO)

    shares = allocate(tax_total, line_bases + charge_bases, quantum)
    line_taxes, charge_taxes = shares[: len(lines)], shares[len(lines):]

    for line, base, tax in zip(lines, line_bases, line_taxes):
        line.tax = tax
        if policy.prices_include_tax:
            line.taxable_amount = base - tax if base > ZERO else ZERO
            line.total = line.net_amount
        else:
            line.taxable_amount = base
            line.total = line.net_amount + tax
    for charge, tax in zip(charges, charge_taxes):
        charge.tax = tax

    return [
        TaxComponentResult(name=c.name, rate=c.rate, amount=amt)
        for c, amt in zip(components, component_amounts)
        if amt > ZERO
    ]
