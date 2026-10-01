"""Put every existing table into a default "Main Area".

No table is removed, renamed or re-tokenised: only ``area`` is filled in for
tables that have none. QR tokens and order history are untouched.
"""

from django.db import migrations

DEFAULT_AREA_NAME = "Main Area"


def assign_default_area(apps, schema_editor):
    MerchantTable = apps.get_model("merchants", "MerchantTable")
    TableArea = apps.get_model("merchants", "TableArea")

    merchant_ids = (
        MerchantTable.objects.filter(area__isnull=True)
        .values_list("merchant_id", flat=True)
        .distinct()
    )
    for merchant_id in merchant_ids:
        area, _ = TableArea.objects.get_or_create(
            merchant_id=merchant_id, name=DEFAULT_AREA_NAME, defaults={"display_order": 0},
        )
        MerchantTable.objects.filter(merchant_id=merchant_id, area__isnull=True).update(area=area)


def unassign(apps, schema_editor):
    # Reversing only detaches tables; the schema migration drops the column.
    apps.get_model("merchants", "MerchantTable").objects.update(area=None)


class Migration(migrations.Migration):
    dependencies = [("merchants", "0027_table_areas_and_roles")]
    operations = [migrations.RunPython(assign_default_area, unassign)]
