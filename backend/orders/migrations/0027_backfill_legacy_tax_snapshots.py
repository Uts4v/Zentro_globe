from decimal import Decimal, InvalidOperation

from django.db import migrations


def _clean_rate(raw) -> str:
    """Format a stored rate the way orders.pricing.service._rate_str does."""
    try:
        return format(Decimal(str(raw)).normalize(), "f")
    except (InvalidOperation, TypeError, ValueError):
        return "0"


def backfill_legacy_tax_snapshots(apps, schema_editor):
    """
    Give pre-pricing-v1 orders the tax snapshot they were charged under.

    Orders created before the engine store their tax detail in
    ``tax_breakdown`` (added in 0020_add_tax_breakdown) and their inclusive /
    exclusive flag in ``prices_include_tax``. Both are exactly what was applied
    at the time, so copying them across is faithful to history.

    Deliberately does NOT touch any money column, and leaves
    ``pricing_version`` empty. Empty is the documented "priced before v1"
    marker, and the refund path branches on it (see pos.views: a per-line
    refund on such an order is refused with a clear message rather than
    silently refunding a fabricated line total). Backfilling amounts would
    make a guess at a tax allocation the original bill never made.
    """
    Order = apps.get_model("orders", "Order")

    for order in Order.objects.filter(tax_policy_snapshot="").iterator(chunk_size=200):
        components = []
        for row in order.tax_breakdown or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            components.append({"name": name, "rate": _clean_rate(row.get("rate", 0))})

        order.tax_policy_snapshot = "inclusive" if order.prices_include_tax else "legacy"
        order.tax_components_snapshot = components
        order.save(update_fields=["tax_policy_snapshot", "tax_components_snapshot"])


def unbackfill_legacy_tax_snapshots(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    Order.objects.exclude(tax_policy_snapshot="").update(
        tax_policy_snapshot="",
        tax_components_snapshot=[],
    )


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0026_lock_settled_order_pricing"),
    ]

    operations = [
        migrations.RunPython(
            backfill_legacy_tax_snapshots,
            unbackfill_legacy_tax_snapshots,
        ),
    ]
