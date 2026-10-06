"""
Re-issue the staff codes that are genuinely ambiguous.

`ShiftWorker.generate_staff_code` used to hand out 1001, 1002, ... per
merchant, so two businesses both had an employee on 1001. A staff member types
a code and a PIN before the server knows which business they mean, so an
ambiguous code could not be resolved and login fell back to asking for a store
name as well.

New codes are drawn from a wide random range (`STAFF_CODE_SPACE`), which is
globally unique. This migration brings the existing rows in line, but only the
ones that are actually ambiguous: re-issuing a code that resolves fine would
take a working PIN away from a cashier for no gain. Codes that already
identify one employee are left alone.
"""

from django.db import migrations
from django.db.models import Count


def reassign_ambiguous_codes(apps, schema_editor):
    ShiftWorker = apps.get_model("pos", "ShiftWorker")

    # A code used by more than one employee cannot identify anybody.
    duplicated = [
        row["staff_code"]
        for row in (
            ShiftWorker.objects.exclude(staff_code="")
            .exclude(is_deleted=True)
            .values("staff_code")
            .annotate(n=Count("id"))
            .filter(n__gt=1)
        )
    ]
    if not duplicated:
        return

    # The live model knows how to pick a free code across the whole install.
    from pos.models import ShiftWorker as LiveShiftWorker

    for code in duplicated:
        # Keep the earliest employee on the original code so at least one person
        # keeps the code they already know.
        keep = (
            ShiftWorker.objects.filter(staff_code=code, is_deleted=False)
            .order_by("created_at", "id")
            .first()
        )
        for worker in ShiftWorker.objects.filter(staff_code=code, is_deleted=False):
            if worker.id == keep.id:
                continue
            new_code = LiveShiftWorker.generate_staff_code(worker.merchant_id)
            worker.staff_code = new_code
            worker.save(update_fields=["staff_code", "updated_at"])


def noop_reverse(apps, schema_editor):
    """Codes cannot be mapped back to their previous values."""
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("pos", "0013_shiftworker_email_shiftworker_is_deleted_and_more"),
    ]

    operations = [
        migrations.RunPython(reassign_ambiguous_codes, noop_reverse),
    ]