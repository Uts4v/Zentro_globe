"""Shared tax calculation utilities."""


def calculate_tax(subtotal, merchant):
    """
    Calculate tax breakdown from a merchant's tax_components.

    Returns (tax_amount, tax_breakdown) where:
      - tax_amount is the total tax (Decimal)
      - tax_breakdown is a list of dicts: [{"name": str, "rate": float, "amount": float}, ...]

    Falls back to the legacy tax_rate_percent when tax_components is empty.
    """
    from decimal import Decimal

    components = merchant.tax_components or []

    if not components:
        # Fallback to legacy field
        rate = float(merchant.tax_rate_percent or 0)
        if rate > 0:
            amt = round(float(subtotal) * (rate / 100), 2)
            return Decimal(str(amt)), [{"name": "VAT", "rate": rate, "amount": amt}]
        return Decimal("0"), []

    total_tax = Decimal("0")
    breakdown = []
    for comp in components:
        name = comp.get("name", "Tax")
        rate = float(comp.get("rate", 0))
        if rate <= 0:
            continue
        amt = round(float(subtotal) * (rate / 100), 2)
        breakdown.append({"name": name, "rate": rate, "amount": amt})
        total_tax += Decimal(str(amt))

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
