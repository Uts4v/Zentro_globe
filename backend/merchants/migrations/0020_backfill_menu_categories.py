# Generated migration: backfill MenuCategory from existing free-text MenuItem.category
# (R-2 no data loss). Any item with a legacy category string gets a MenuCategory row.

from django.db import migrations


def backfill_categories(apps, schema_editor):
    MenuItem = apps.get_model("merchants", "MenuItem")
    MenuCategory = apps.get_model("merchants", "MenuCategory")

    for item in MenuItem.objects.exclude(category=""):
        name = (item.category or "").strip()
        if not name:
            continue

        category, _ = MenuCategory.objects.get_or_create(
            merchant=item.merchant,
            name=name,
            defaults={
                "display_order": 0,
                "is_active": True,
            },
        )
        item.category_ref = category
        item.save(update_fields=["category_ref"])


def reverse(apps, schema_editor):
    # Additive migration — nothing to tear down.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("merchants", "0019_menuitem_allergens_menuitem_dietary_tags_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_categories, reverse),
    ]