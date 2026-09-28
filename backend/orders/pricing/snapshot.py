"""
Read an order's stored pricing, exactly as it was charged.

Receipts, refunds and reports use this, never ``calculate``: historical money
must not change because a menu price, tax rate or charge setting changed later.
"""

from __future__ import annotations


def order_pricing_snapshot(order) -> dict:
    items = list(order.items.all().order_by("id"))
    adjustments = list(order.adjustments.filter(status="active").prefetch_related("allocations"))
    return {
        "pricing_version": order.pricing_version or None,
        "currency": order.currency_code_snapshot or order.merchant.currency_code,
        "currency_symbol": order.currency_symbol_snapshot or order.merchant.currency_symbol,
        "tax_policy": order.tax_policy_snapshot or None,
        "prices_include_tax": order.prices_include_tax,
        "locked": order.pricing_locked_at is not None,
        "subtotal": str(order.subtotal),
        "discount_total": str(order.discount_amount),
        "taxable_total": str(order.taxable_amount),
        "tax_total": str(order.tax_amount),
        "charge_total": str(sum((c.amount for c in order.charges.all()), 0) or order.service_charge),
        "grand_total": str(order.total_amount),
        "taxes": order.tax_breakdown or [],
        "lines": [
            {
                "order_item_id": i.id,
                "name": i.name,
                "quantity": i.quantity,
                "tax_class": i.tax_class,
                "unit_price": str(i.price),
                "list_unit_price": str(i.list_unit_price) if i.list_unit_price is not None else None,
                "line_subtotal": str(i.subtotal),
                "discount": str(i.discount_amount),
                "taxable_amount": str(i.taxable_amount),
                "tax": str(i.tax_amount),
                "line_total": str(i.total_amount),
                "refunded_quantity": i.refunded_quantity,
                "refunded_amount": str(i.refunded_amount),
            }
            for i in items
        ],
        "discounts": [
            {
                "kind": a.kind,
                "label": a.label,
                "calc_type": a.calc_type,
                "value": str(a.value),
                "amount": str(a.amount),
                "eligible": a.eligible,
                "reason": a.reason,
                "allocations": {str(al.order_item_id): str(al.amount) for al in a.allocations.all()},
            }
            for a in adjustments
        ],
        "charges": [
            {
                "kind": c.kind,
                "label": c.label,
                "calc_type": c.calc_type,
                "value": str(c.value),
                "amount": str(c.amount),
                "taxable": c.taxable,
                "tax": str(c.tax_amount),
            }
            for c in order.charges.all()
        ],
        "messages": [
            {"kind": a.kind, "label": a.label, **a.reason}
            for a in adjustments
            if not a.eligible and a.reason
        ],
    }
