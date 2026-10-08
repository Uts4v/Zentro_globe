from django.db import migrations


def forwards(apps, schema_editor):
    MenuOptionGroup = apps.get_model("merchants", "MenuOptionGroup")
    MerchantProfile = apps.get_model("merchants", "MerchantProfile")

    # Add-ons are optional unless the merchant marked the group Required. A
    # leftover minimum on a non-required add-on group forced a pick at the
    # till; clear it.
    MenuOptionGroup.objects.filter(
        kind="modifier", required=False, min_select__gt=0,
    ).update(min_select=0)

    # "Staff Free" orders existed before this setting did. Businesses that are
    # already running keep it switched on; new businesses start with it off.
    MerchantProfile.objects.update(free_items_enabled=True)


class Migration(migrations.Migration):

    dependencies = [
        ("merchants", "0029_merchantprofile_free_item_pin_hash_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
