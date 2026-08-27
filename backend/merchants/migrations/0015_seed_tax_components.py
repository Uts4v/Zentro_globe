"""Seed tax_components from existing tax_rate_percent for all merchants."""
from django.db import migrations


def seed_tax_components(apps, schema_editor):
    MerchantProfile = apps.get_model("merchants", "MerchantProfile")
    for merchant in MerchantProfile.objects.all():
        rate = float(merchant.tax_rate_percent or 0)
        if not merchant.tax_components and rate > 0:
            merchant.tax_components = [{"name": "VAT", "rate": rate}]
            merchant.save(update_fields=["tax_components"])


def reverse_seed(apps, schema_editor):
    MerchantProfile = apps.get_model("merchants", "MerchantProfile")
    MerchantProfile.objects.update(tax_components=[])


class Migration(migrations.Migration):

    dependencies = [
        ("merchants", "0014_add_currency_and_tax_components"),
    ]

    operations = [
        migrations.RunPython(seed_tax_components, reverse_seed),
    ]
