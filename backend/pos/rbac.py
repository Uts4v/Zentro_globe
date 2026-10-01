"""
pos/rbac.py — Zentro's simple role-based access control.

  ROLE   = what the employee can do          (StaffRole + StaffRolePermission)
  AREA   = which dining areas they work in   (StaffAreaAssignment)
  BRANCH = which location (one per merchant today; models keep a nullable
           branch so multi-branch can be added without replacing this)

Deliberately simple: one role per employee, permissions are plain allow rows,
no inheritance, no per-employee overrides, no policy language. To give
someone a different mix of permissions, create (clone) another role.

Who is acting:
  * The merchant account owner is the ADMIN of their own merchant: every
    permission, always, and never another merchant.
  * An employee (pos.ShiftWorker) acts either through the POS (``worker_id``
    on the request) or through STAFF MODE on the dashboard: a signed
    ``X-Zentro-Staff`` token issued after PIN verification. The token only
    names the worker — permissions are read from the database on every
    request, so role changes take effect immediately.

``worker_can`` / ``actor_can`` are the single place permission decisions are
made. The UI hides what a role cannot do; these checks are authoritative.
"""

from __future__ import annotations

from django.core import signing
from django.db import transaction

# ── Permission catalog (human labels only reach merchants; codes never do) ──

PERMISSION_GROUPS = [
    ("pos", "POS & Orders", [
        ("pos.access", "Use the POS", "Open the POS and see orders."),
        ("orders.create", "Create orders", "Start orders, add items and send them."),
        ("orders.cancel", "Cancel orders", "Cancel an order or remove sent items."),
    ]),
    ("payments", "Payments", [
        ("payments.take", "Take payments", "Accept cash, card and other payments."),
        ("payments.refund", "Refund", "Give money back to a customer."),
        ("discounts.apply", "Give discounts", "Apply a discount to an order."),
        ("shifts.close", "Close the cash shift", "Count the drawer and close the shift."),
    ]),
    ("tables", "Tables", [
        ("tables.view", "See tables", "See tables and which are busy."),
        ("tables.manage", "Set up tables and areas", "Add, rename and move tables and areas."),
    ]),
    ("kitchen", "Kitchen", [
        ("kds.access", "Use the kitchen screen", "See items to prepare and mark them ready."),
    ]),
    ("menu", "Menu", [
        ("menu.manage", "Manage the menu", "Add and change menu items and prices."),
    ]),
    ("inventory", "Inventory", [
        ("inventory.view", "See stock", "See how much of everything there is."),
        ("inventory.count", "Count stock", "Do stock counts."),
        ("inventory.receive", "Add deliveries", "Add stock that arrived."),
        ("inventory.transfer", "Move stock", "Move stock between places."),
        ("inventory.waste", "Record waste", "Record spoiled or broken stock."),
        ("inventory.adjust", "Fix stock", "Correct stock numbers and approve counts."),
        ("inventory.manage", "Manage items and suppliers", "Stock items, suppliers, supplier orders and history."),
        ("inventory.costs", "See costs", "See what stock costs and is worth."),
    ]),
    ("customers", "Customers", [
        ("customers.manage", "Customers, loyalty and offers", "Manage customers, rewards and offers."),
    ]),
    ("reports", "Reports", [
        ("reports.view", "See reports", "Sales, analytics and reports."),
    ]),
    ("employees", "Employees", [
        ("staff.manage", "Manage employees", "Add employees and set their role and areas."),
        ("roles.manage", "Manage roles", "Create roles and change what each role can do."),
    ]),
    ("settings", "Settings", [
        ("settings.manage", "Change business settings", "Store, tax, payment and account settings."),
    ]),
]

ALL_PERMISSIONS: tuple[str, ...] = tuple(
    code for _, _, perms in PERMISSION_GROUPS for code, _, _ in perms
)
_ALL_SET = frozenset(ALL_PERMISSIONS)

# ── Default role templates ───────────────────────────────────────────────────

ROLE_ADMIN, ROLE_MANAGER, ROLE_CASHIER = "admin", "manager", "cashier"
ROLE_SERVER, ROLE_KITCHEN, ROLE_INVENTORY = "server", "kitchen", "inventory"

DEFAULT_ROLES = {
    ROLE_ADMIN: {
        "name": "Admin",
        "description": "Full access to everything in this business.",
        "permissions": ALL_PERMISSIONS,
    },
    ROLE_MANAGER: {
        "name": "Manager",
        "description": "Runs daily operations. Cannot change roles or business settings.",
        "permissions": tuple(p for p in ALL_PERMISSIONS if p not in ("roles.manage", "settings.manage")),
    },
    ROLE_CASHIER: {
        "name": "Cashier",
        "description": "Takes orders and payments at the counter.",
        "permissions": ("pos.access", "orders.create", "payments.take", "tables.view"),
    },
    ROLE_SERVER: {
        "name": "Server",
        "description": "Takes orders at the tables they are assigned to.",
        "permissions": ("pos.access", "orders.create", "payments.take", "tables.view"),
    },
    ROLE_KITCHEN: {
        "name": "Kitchen",
        "description": "Prepares orders on the kitchen screen.",
        "permissions": ("kds.access",),
    },
    ROLE_INVENTORY: {
        "name": "Inventory",
        "description": "Looks after stock, deliveries and suppliers.",
        "permissions": (
            "inventory.view", "inventory.count", "inventory.receive",
            "inventory.transfer", "inventory.waste", "inventory.manage",
        ),
    },
}

# Old ShiftWorker.role values → default role. Only values that actually exist.
LEGACY_ROLE_MAP = {"admin": ROLE_ADMIN, "manager": ROLE_MANAGER, "cashier": ROLE_CASHIER, "waiter": ROLE_SERVER}

# Old per-worker boolean flags ↔ permissions (flags now mirror the role).
LEGACY_FLAGS = {
    "can_apply_discount": "discounts.apply",
    "can_process_refund": "payments.refund",
    "can_close_shift": "shifts.close",
    "can_view_reports": "reports.view",
}
FLAG_LABELS = {
    "can_apply_discount": "Discounts",
    "can_process_refund": "Refunds",
    "can_close_shift": "Close Shift",
    "can_view_reports": "Reports",
}


class RbacError(ValueError):
    """A role/permission change the rules do not allow."""


# ── Roles ────────────────────────────────────────────────────────────────────

def ensure_default_roles(merchant) -> dict:
    """Create any missing default role for ``merchant``. Idempotent."""
    from .models import StaffRole, StaffRolePermission

    existing = {r.system_key: r for r in StaffRole.objects.filter(merchant=merchant, is_system=True)}
    if len(existing) == len(DEFAULT_ROLES):
        return existing
    with transaction.atomic():
        for key, spec in DEFAULT_ROLES.items():
            if key in existing:
                continue
            role, created = StaffRole.objects.get_or_create(
                merchant=merchant, name=spec["name"],
                defaults={
                    "description": spec["description"], "system_key": key,
                    "is_system": True, "is_admin": key == ROLE_ADMIN,
                },
            )
            if created:
                StaffRolePermission.objects.bulk_create([
                    StaffRolePermission(role=role, permission_code=code) for code in spec["permissions"]
                ])
            existing[key] = role
    return existing


def role_permissions(role) -> frozenset:
    """Codes the role allows. The Admin role always allows everything."""
    if role is None or not role.is_active:
        return frozenset()
    if role.is_admin:
        return _ALL_SET
    cached = getattr(role, "_perm_cache", None)
    if cached is None:
        cached = frozenset(
            role.permissions.filter(allowed=True, permission_code__in=ALL_PERMISSIONS)
            .values_list("permission_code", flat=True)
        )
        role._perm_cache = cached
    return cached


def set_role_permissions(role, codes) -> frozenset:
    """Replace the role's permissions and refresh the legacy flags of its employees."""
    from .models import StaffRolePermission

    if role.is_admin:
        raise RbacError("The Admin role always has full access and cannot be changed.")
    wanted = {c for c in codes if c in _ALL_SET}
    with transaction.atomic():
        role.permissions.exclude(permission_code__in=wanted).delete()
        have = set(role.permissions.values_list("permission_code", flat=True))
        StaffRolePermission.objects.bulk_create([
            StaffRolePermission(role=role, permission_code=code) for code in wanted - have
        ])
        role.permissions.filter(permission_code__in=wanted).update(allowed=True)
        role._perm_cache = frozenset(wanted)
        for worker in role.workers.all():
            sync_legacy_fields(worker, role)
    return role._perm_cache


def legacy_role_for(role) -> str:
    """Coarse legacy ShiftWorker.role for code that still reads it."""
    perms = role_permissions(role)
    if role.is_admin:
        return "admin"
    if "staff.manage" in perms:
        return "manager"
    if "orders.create" in perms and "payments.take" not in perms:
        return "waiter"
    if role.system_key == ROLE_SERVER:
        return "waiter"
    return "cashier"


def sync_legacy_fields(worker, role=None, save=True):
    """Mirror the role onto the old role/flag columns existing clients read."""
    role = role or worker.staff_role
    if role is None:
        return
    perms = role_permissions(role)
    worker.role = legacy_role_for(role)
    for flag, code in LEGACY_FLAGS.items():
        setattr(worker, flag, code in perms)
    if save:
        worker.save(update_fields=["role", *LEGACY_FLAGS.keys(), "updated_at"])


def assign_role(worker, role) -> None:
    """Give the employee exactly one role (replacing the previous one)."""
    if role.merchant_id != worker.merchant_id:
        raise RbacError("That role belongs to another business.")
    if not role.is_active:
        raise RbacError("That role is no longer in use.")
    worker.staff_role = role
    sync_legacy_fields(worker, role, save=False)
    worker.save(update_fields=["staff_role", "role", *LEGACY_FLAGS.keys(), "updated_at"])


def worker_role(worker):
    """The employee's role.

    An employee saved without one (older code paths) is given the role that
    preserves exactly what their old role and flags allowed.
    """
    role = worker.staff_role
    if role is None:
        flags = {flag: getattr(worker, flag) for flag in LEGACY_FLAGS}
        role, _ = role_for_legacy_worker(
            worker.merchant, worker.role, flags,
            works_kitchen=worker.preparation_area_assignments.exists(),
        )
        assign_role(worker, role)
    return role


# ── Decisions ────────────────────────────────────────────────────────────────

def worker_permissions(worker) -> frozenset:
    if worker is None or not worker.is_active:
        return frozenset()
    return role_permissions(worker_role(worker))


def worker_can(worker, code: str) -> bool:
    """THE permission check for an employee."""
    return code in worker_permissions(worker)


def allowed_area_ids(worker):
    """Dining areas the employee works in. ``None`` means every area.

    Admins and anyone who can set up tables see all areas. An employee with
    no assigned areas also sees all (useful, not annoying). Otherwise only
    their assigned areas.
    """
    if worker is None:
        return None
    perms = worker_permissions(worker)
    if "tables.manage" in perms or worker_role(worker).is_admin:
        return None
    ids = set(worker.area_assignments.values_list("table_area_id", flat=True))
    return ids or None


def worker_can_use_table(worker, table) -> bool:
    ids = allowed_area_ids(worker)
    return ids is None or table.area_id in ids


# ── Staff mode (dashboard) ───────────────────────────────────────────────────

STAFF_HEADERS = ("HTTP_X_ZENTRO_STAFF", "HTTP_X_INVENTORY_STAFF")
STAFF_SALT = "inventory.staff-session"  # shared with tokens issued before RBAC
STAFF_SESSION_MAX_AGE = 12 * 60 * 60


def issue_staff_token(worker) -> str:
    return signing.dumps({"w": str(worker.id), "m": worker.merchant_id}, salt=STAFF_SALT, compress=True)


def staff_token_from(request) -> str:
    for header in STAFF_HEADERS:
        token = request.META.get(header, "")
        if token:
            return token
    return ""


def worker_from_token(token: str, merchant=None):
    """The active employee a staff token names, or None if it is not valid."""
    from .models import ShiftWorker

    try:
        data = signing.loads(token, salt=STAFF_SALT, max_age=STAFF_SESSION_MAX_AGE)
    except signing.BadSignature:
        return None
    if merchant is not None and data.get("m") != merchant.id:
        return None
    return (
        ShiftWorker.objects.select_related("staff_role", "merchant")
        .filter(id=data.get("w"), merchant_id=data.get("m"), is_active=True)
        .first()
    )


def request_worker(request, merchant=None):
    """Employee acting in staff mode on this request, else None (the owner).

    The middleware has already rejected invalid tokens; ``merchant`` adds the
    tenant check for views that use the worker for data access.
    """
    cached = getattr(request, "_staff_worker", False)
    if cached is not False:
        worker = cached
    else:
        token = staff_token_from(request)
        worker = worker_from_token(token) if token else None
        try:
            request._staff_worker = worker
        except Exception:
            pass
    if worker is not None and merchant is not None and worker.merchant_id != merchant.id:
        return None
    return worker


def actor_can(request, code: str, merchant=None) -> bool:
    """Owner (admin of own merchant) always; an employee by their role."""
    token = staff_token_from(request)
    if not token:
        return True
    worker = request_worker(request, merchant)
    return worker is not None and worker_can(worker, code)


def permission_payload(worker) -> dict:
    """What the frontend needs to tailor navigation (never authoritative)."""
    if worker is None:
        return {
            "mode": "admin", "worker": None, "role": {"name": "Admin", "is_admin": True},
            "permissions": list(ALL_PERMISSIONS), "area_ids": None,
        }
    role = worker_role(worker)
    areas = allowed_area_ids(worker)
    return {
        "mode": "staff",
        "worker": {"id": str(worker.id), "name": worker.display_name},
        "role": {"id": role.id, "name": role.name, "is_admin": role.is_admin},
        "permissions": sorted(role_permissions(role)),
        "area_ids": sorted(areas) if areas is not None else None,
    }


# ── Migration helper ─────────────────────────────────────────────────────────

def role_for_legacy_worker(merchant, legacy_role: str, flags: dict, roles=None, works_kitchen=False):
    """Role that preserves exactly what an existing employee could do.

    Returns ``(role, unmapped)``. If the old flags differ from the default
    role (e.g. a cashier allowed to refund), a custom role such as
    "Cashier + Refunds" is created so nobody loses or gains access.
    """
    from .models import StaffRole, StaffRolePermission

    roles = roles or ensure_default_roles(merchant)
    key = LEGACY_ROLE_MAP.get(legacy_role)
    unmapped = key is None
    base = roles[key or ROLE_CASHIER]
    if base.is_admin:
        return base, unmapped
    base_perms = set(role_permissions(base))
    wanted = set(base_perms)
    plus, minus = [], []
    for flag, code in LEGACY_FLAGS.items():
        if flags.get(flag) and code not in base_perms:
            wanted.add(code)
            plus.append(FLAG_LABELS[flag])
        elif not flags.get(flag) and code in base_perms:
            wanted.discard(code)
            minus.append(FLAG_LABELS[flag])
    if works_kitchen and "kds.access" not in base_perms:
        wanted.add("kds.access")
        plus.append("Kitchen Screen")
    if not plus and not minus:
        return base, unmapped
    name = base.name + "".join(f" + {p}" for p in plus) + "".join(f" − {m}" for m in minus)
    role, created = StaffRole.objects.get_or_create(
        merchant=merchant, name=name[:60],
        defaults={"description": f"Created from existing {base.name} settings."},
    )
    if created:
        StaffRolePermission.objects.bulk_create([
            StaffRolePermission(role=role, permission_code=code) for code in sorted(wanted)
        ])
    return role, unmapped
