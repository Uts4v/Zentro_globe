from django.db import migrations


def forwards(apps, schema_editor):
    StaffRole = apps.get_model("pos", "StaffRole")
    StaffRolePermission = apps.get_model("pos", "StaffRolePermission")

    def grant(role, code):
        StaffRolePermission.objects.get_or_create(
            role=role, permission_code=code, defaults={"allowed": True},
        )

    # Anyone who could create orders could already ring up a "Staff Free"
    # order. Keep that working: those roles get the new "Give free items"
    # permission, which the merchant can now remove per role.
    order_roles = StaffRole.objects.filter(
        permissions__permission_code="orders.create", permissions__allowed=True,
    ).distinct()
    for role in order_roles:
        grant(role, "items.free")

    # The default Manager role runs daily operations, which includes accounts.
    for role in StaffRole.objects.filter(is_system=True, system_key="manager"):
        grant(role, "items.free")
        grant(role, "accounts.view")
        grant(role, "accounts.manage")


class Migration(migrations.Migration):

    dependencies = [
        ("pos", "0017_alter_posauditlog_action"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
