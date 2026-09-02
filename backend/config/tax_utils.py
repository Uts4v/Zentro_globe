"""Shared tax calculation utilities."""

from decimal import Decimal, ROUND_HALF_UP

_ONE_CENT = Decimal("0.01")


def _component_tax(subtotal: Decimal, rate) -> Decimal:
    """Tax on subtotal at ``rate`` percent, rounded to the cent (half-up)."""
    r = Decimal(str(rate))
    if r <= 0:
        return Decimal("0")
    amt = subtotal * r / Decimal("100")
    return amt.quantize(_ONE_CENT, rounding=ROUND_HALF_UP)


def calculate_tax(subtotal, merchant):
    """
    Calculate tax breakdown from a merchant's tax_components.

    Returns (tax_amount, tax_breakdown) where:
      - tax_amount is the total tax (Decimal, computed entirely in Decimal)
      - tax_breakdown is a list of dicts: [{"name": str, "rate": float, "amount": float}, ...]

    Falls back to the legacy tax_rate_percent when tax_components is empty.
    """
    components = merchant.tax_components or []
    subtotal_dec = Decimal(str(subtotal))

    if not components:
        # Fallback to legacy field
        rate = Decimal(str(merchant.tax_rate_percent or 0))
        if rate > 0:
            amt = _component_tax(subtotal_dec, rate)
            return amt, [{"name": "VAT", "rate": float(rate), "amount": float(amt)}]
        return Decimal("0"), []

    total_tax = Decimal("0")
    breakdown = []
    for comp in components:
        name = comp.get("name", "Tax")
        amt = _component_tax(subtotal_dec, comp.get("rate", 0))
        if amt <= 0:
            continue
        breakdown.append({"name": name, "rate": float(comp.get("rate", 0)), "amount": float(amt)})
        total_tax += amt

    return total_tax, breakdown


def get_tax_display_label(merchant):
    """
    Return a human-readable label for the tax applied.
    E.g. "GST" for India, "VAT" for Nepal, or "Tax" as default.
    """
    components = merchant.tax_components or []
    if not components:
        rate = float(merchant.tax_rate_percent or 0)
        return "VAT" if rate > 0 else "Tax"

    if len(components) == 1:
        return components[0].get("name", "Tax")

    # Multiple components — use a generic label based on country/currency
    names = [c.get("name", "") for c in components]
    if any(n.upper().startswith("CGST") for n in names):
        return "GST"
    return "Tax"