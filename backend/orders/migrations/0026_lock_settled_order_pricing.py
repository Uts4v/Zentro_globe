from django.db import migrations
from django.db.models import F, Q


def lock_settled_orders(apps, schema_editor):
    Order = apps.get_model("orders", "Order")
    Order.objects.filter(pricing_locked_at__isnull=True).filter(
        Q(status__in=["completed", "cancelled", "refunded"])
        | Q(payment_status__in=["paid", "refunded"])
    ).update(pricing_locked_at=F("updated_at"))


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0025_pricing_v1"),
    ]

    operations = [
        migrations.RunPython(lock_settled_orders, migrations.RunPython.noop),
    ]
