from django.db import migrations


def forwards(apps, schema_editor):
    StaffRole = apps.get_model("pos", "StaffRole")
    StaffRolePermission = apps.get_model("pos", "StaffRolePermission")

    def grant(role, code):
        StaffRolePermission.objects.get_or_create(
            role=role, permission_code=code, defaults={"allowed": True},
        )

    # Custom items carry a manual price, the same kind of financially-sensitive
    # action as giving an item free or applying a discount, so only the default
    # Admin and Manager roles get it. A merchant can grant it to any other role.
    for role in StaffRole.objects.filter(
        is_system=True, system_key__in=("admin", "manager"),
    ):
        grant(role, "items.custom")


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0018_grant_free_items_and_accounts_permissions"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
