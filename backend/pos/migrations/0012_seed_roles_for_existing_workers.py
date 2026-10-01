"""Give every existing employee a role that preserves exactly what they could do.

Old model: ShiftWorker.role (admin / manager / cashier / waiter) plus four
boolean flags (discount, refund, close shift, view reports).

Mapping (only values that actually exist):
    admin → Admin, manager → Manager, cashier → Cashier, waiter → Server

If an employee's flags differ from the default role (e.g. a cashier who may
close the shift, or one already assigned to a preparation station and so
using the kitchen screen), a custom role such as "Cashier + Close Shift" is created
for that combination, so nobody gains or loses access. An unknown old role
value is NOT guessed silently: the employee is given Cashier (least access)
and reported on the console.

The role catalogue is frozen here on purpose (migrations must not change
when pos/rbac.py does).
"""

from django.db import migrations

ALL = [
    "pos.access", "orders.create", "orders.cancel",
    "payments.take", "payments.refund", "discounts.apply", "shifts.close",
    "tables.view", "tables.manage", "kds.access", "menu.manage",
    "inventory.view", "inventory.count", "inventory.receive", "inventory.transfer",
    "inventory.waste", "inventory.adjust", "inventory.manage", "inventory.costs",
    "customers.manage", "reports.view", "staff.manage", "roles.manage", "settings.manage",
]
DEFAULTS = {
    "admin": ("Admin", "Full access to everything in this business.", ALL),
    "manager": ("Manager", "Runs daily operations. Cannot change roles or business settings.",
                [p for p in ALL if p not in ("roles.manage", "settings.manage")]),
    "cashier": ("Cashier", "Takes orders and payments at the counter.",
                ["pos.access", "orders.create", "payments.take", "tables.view"]),
    "server": ("Server", "Takes orders at the tables they are assigned to.",
               ["pos.access", "orders.create", "payments.take", "tables.view"]),
    "kitchen": ("Kitchen", "Prepares orders on the kitchen screen.", ["kds.access"]),
    "inventory": ("Inventory", "Looks after stock, deliveries and suppliers.",
                  ["inventory.view", "inventory.count", "inventory.receive",
                   "inventory.transfer", "inventory.waste", "inventory.manage"]),
}
LEGACY = {"admin": "admin", "manager": "manager", "cashier": "cashier", "waiter": "server"}
FLAGS = [
    ("can_apply_discount", "discounts.apply", "Discounts"),
    ("can_process_refund", "payments.refund", "Refunds"),
    ("can_close_shift", "shifts.close", "Close Shift"),
    ("can_view_reports", "reports.view", "Reports"),
]


def seed(apps, schema_editor):
    ShiftWorker = apps.get_model("pos", "ShiftWorker")
    StaffPreparationArea = apps.get_model("pos", "StaffPreparationArea")
    kitchen_workers = set(StaffPreparationArea.objects.values_list("worker_id", flat=True))
    StaffRole = apps.get_model("pos", "StaffRole")
    StaffRolePermission = apps.get_model("pos", "StaffRolePermission")

    def make_role(merchant_id, name, description, perms, key="", is_admin=False):
        role, created = StaffRole.objects.get_or_create(
            merchant_id=merchant_id, name=name[:60],
            defaults={"description": description, "system_key": key,
                      "is_system": bool(key), "is_admin": is_admin},
        )
        if created:
            StaffRolePermission.objects.bulk_create(
                [StaffRolePermission(role=role, permission_code=code) for code in perms]
            )
        return role

    unmapped = []
    merchant_ids = ShiftWorker.objects.values_list("merchant_id", flat=True).distinct()
    for merchant_id in merchant_ids:
        roles = {
            key: make_role(merchant_id, name, desc, perms, key=key, is_admin=key == "admin")
            for key, (name, desc, perms) in DEFAULTS.items()
        }
        for worker in ShiftWorker.objects.filter(merchant_id=merchant_id, staff_role__isnull=True):
            key = LEGACY.get(worker.role)
            if key is None:
                unmapped.append((merchant_id, worker.display_name, worker.role))
                key = "cashier"
            role = roles[key]
            if key != "admin":
                base = set(DEFAULTS[key][2])
                wanted, plus, minus = set(base), [], []
                for flag, code, label in FLAGS:
                    if getattr(worker, flag) and code not in base:
                        wanted.add(code)
                        plus.append(label)
                    elif not getattr(worker, flag) and code in base:
                        wanted.discard(code)
                        minus.append(label)
                # Already assigned to a preparation station → keeps the kitchen screen.
                if worker.id in kitchen_workers and "kds.access" not in base:
                    wanted.add("kds.access")
                    plus.append("Kitchen Screen")
                if plus or minus:
                    name = DEFAULTS[key][0] + "".join(f" + {p}" for p in plus) + "".join(f" − {m}" for m in minus)
                    role = make_role(
                        merchant_id, name, f"Created from existing {DEFAULTS[key][0]} settings.", sorted(wanted),
                    )
            worker.staff_role = role
            worker.save(update_fields=["staff_role"])

    for merchant_id, name, old_role in unmapped:
        print(
            f"\n  [roles] merchant {merchant_id}: employee '{name}' had unknown role "
            f"'{old_role}' — given Cashier (least access). Please review."
        )


def unseed(apps, schema_editor):
    apps.get_model("pos", "ShiftWorker").objects.update(staff_role=None)
    apps.get_model("pos", "StaffRole").objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("pos", "0011_table_areas_and_roles")]
    operations = [migrations.RunPython(seed, unseed)]
