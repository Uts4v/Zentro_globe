from django.db import migrations


def backfill_special_discounts(apps, schema_editor):
    TodaySpecial = apps.get_model("loyalty", "TodaySpecial")
    from loyalty.models import sync_menu_item_discount

    item_ids = (
        TodaySpecial.objects.filter(is_active=True, linked_menu_item__isnull=False)
        .values_list("linked_menu_item_id", flat=True)
        .distinct()
    )
    for item_id in item_ids:
        sync_menu_item_discount(item_id)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("loyalty", "0024_todayspecial_cta_label_todayspecial_ends_at_and_more"),
        ("merchants", "0021_menuitem_discount_source_menuitem_discount_type_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_special_discounts, noop),
    ]
