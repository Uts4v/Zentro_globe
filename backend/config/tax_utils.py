"""Shared tax calculation utilities."""

from decimal import Decimal


def calculate_tax(subtotal, merchant):
    """
    Tax on a plain subtotal with the merchant's current components.

    Kept for callers that only have a subtotal; the arithmetic lives in the
    pricing engine (orders.pricing), which every order flow uses directly.

    Returns (tax_amount, tax_breakdown) where tax_breakdown is a list of
    {"name", "rate", "amount"} dicts.
    """
    from orders.pricing import LineInput, PricingContext, calculate, resolve_components

    components = resolve_components(merchant)
    if not components:
        return Decimal("0"), []
    amount = Decimal(str(subtotal))
    result = calculate(PricingContext(
        currency_code=getattr(merchant, "currency_code", "") or "NPR",
        policy_code="legacy",
        tax_enabled=True,
        tax_components=components,
        lines=(LineInput(key="subtotal", name="subtotal", quantity=1,
                         unit_price=amount, list_unit_price=amount),),
    ))
    return result.tax_total, [
        {"name": t.name, "rate": float(t.rate), "amount": float(t.amount)} for t in result.taxes
    ]


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