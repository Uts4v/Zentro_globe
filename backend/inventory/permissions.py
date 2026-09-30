"""
inventory/permissions.py

Reuses Zentro's existing identities — no new permission framework:

  * The merchant dashboard user (accounts.User, role='merchant') and
    superusers act as the OWNER.
  * A POS ShiftWorker can use the dashboard in "staff mode" on a shared
    device: the owner session starts a short-lived, signed staff session by
    verifying the worker's PIN (ShiftWorker.verify_pin, with its lockout).
    Requests then carry the ``X-Inventory-Staff`` header and are evaluated
    with the worker's role. This is the "ShiftWorker-level mapping" the V1
    module documented as its future extension.

Every endpoint enforces its capability server-side (see ``inventory_perm``
in views.py). The UI only hides what the backend would refuse anyway.
An invalid or expired staff token fails closed; it never falls back to
owner access.
"""

from dataclasses import dataclass, field

from django.core import signing
from rest_framework import permissions


class InvPerm:
    VIEW = "inventory.view"
    VIEW_COST = "inventory.view_cost"
    MANAGE_ITEMS = "inventory.manage_items"
    COUNT = "inventory.count"
    SUBMIT_COUNT = "inventory.submit_count"
    APPROVE_COUNT = "inventory.approve_count"
    RECEIVE = "inventory.receive"
    ADJUST = "inventory.adjust"
    APPROVE_ADJUSTMENT = "inventory.approve_adjustment"
    RECORD_WASTE = "inventory.record_waste"
    MANAGE_SUPPLIERS = "inventory.manage_suppliers"
    PURCHASE = "inventory.purchase"
    TRANSFER = "inventory.transfer"
    VIEW_REPORTS = "inventory.view_reports"
    MANAGE_SETTINGS = "inventory.manage_settings"
    IMPORT = "inventory.import"

    ALL = [
        VIEW, VIEW_COST, MANAGE_ITEMS, COUNT, SUBMIT_COUNT, APPROVE_COUNT,
        RECEIVE, ADJUST, APPROVE_ADJUSTMENT, RECORD_WASTE, MANAGE_SUPPLIERS,
        PURCHASE, TRANSFER, VIEW_REPORTS, MANAGE_SETTINGS, IMPORT,
    ]

    _FRONTLINE = [VIEW, COUNT, SUBMIT_COUNT, RECORD_WASTE]

    # Role defaults. Owner/admin: everything (settings, costs, audit, import).
    # Manager: deliveries, corrections, suppliers, reports, history, costs.
    # Kitchen/bar staff: stock, counting, waste, moving stock.
    # Cashier: stock, counting, waste.
    ROLE_DEFAULTS = {
        "owner": ALL,
        "admin": ALL,
        "manager": [
            VIEW, VIEW_COST, MANAGE_ITEMS, COUNT, SUBMIT_COUNT, APPROVE_COUNT,
            RECEIVE, ADJUST, RECORD_WASTE, MANAGE_SUPPLIERS, PURCHASE, TRANSFER,
            VIEW_REPORTS,
        ],
        "kitchen": _FRONTLINE + [TRANSFER],
        "bar": _FRONTLINE + [TRANSFER],
        "staff": _FRONTLINE + [TRANSFER],
        "cashier": _FRONTLINE,
    }

    # ShiftWorker.role → inventory role
    WORKER_ROLE_MAP = {
        "admin": "admin",
        "manager": "manager",
        "waiter": "staff",
        "cashier": "cashier",
    }


STAFF_HEADER = "HTTP_X_INVENTORY_STAFF"
STAFF_SALT = "inventory.staff-session"
STAFF_SESSION_MAX_AGE = 12 * 60 * 60  # one working day


@dataclass
class InventoryAccess:
    merchant: object = None
    role: str | None = None
    worker: object = None
    perms: frozenset = field(default_factory=frozenset)
    error: str = ""

    @property
    def ok(self) -> bool:
        return self.merchant is not None and self.role is not None

    def can(self, perm: str) -> bool:
        return self.ok and perm in self.perms

    @property
    def actor_label(self) -> str:
        return self.worker.display_name if self.worker is not None else ""


def user_merchant(user):
    """Resolve the acting MerchantProfile for a User, or None."""
    if user is None or not user.is_authenticated:
        return None
    try:
        return user.merchant_profile
    except Exception:
        return None


def issue_staff_token(worker) -> str:
    return signing.dumps(
        {"w": str(worker.id), "m": worker.merchant_id}, salt=STAFF_SALT, compress=True
    )


def _worker_from_token(token: str, merchant):
    from pos.models import ShiftWorker

    try:
        data = signing.loads(token, salt=STAFF_SALT, max_age=STAFF_SESSION_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get("m") != merchant.id:
        return None
    return ShiftWorker.objects.filter(
        id=data.get("w"), merchant=merchant, is_active=True
    ).first()


def resolve_access(request) -> InventoryAccess:
    """Who is acting, for which merchant, with which inventory capabilities.

    Cached on the request so one request evaluates the staff token once.
    """
    cached = getattr(request, "_inventory_access", None)
    if cached is not None:
        return cached

    user = getattr(request, "user", None)
    access = InventoryAccess()
    if user is None or not user.is_authenticated:
        access.error = "Not signed in."
    elif not (user.is_superuser or getattr(user, "role", "") == "merchant"):
        access.error = "Not a merchant account."
    else:
        merchant = user_merchant(user)
        if merchant is None:
            access.error = "No merchant profile."
        else:
            access.merchant = merchant
            token = request.META.get(STAFF_HEADER, "")
            if token:
                worker = _worker_from_token(token, merchant)
                if worker is None:
                    access.error = "Your staff session has ended. Please sign in again."
                else:
                    role = InvPerm.WORKER_ROLE_MAP.get(worker.role, "cashier")
                    access.worker = worker
                    access.role = role
                    access.perms = frozenset(InvPerm.ROLE_DEFAULTS[role])
            else:
                access.role = "owner"
                access.perms = frozenset(InvPerm.ROLE_DEFAULTS["owner"])

    try:
        request._inventory_access = access
    except Exception:
        pass
    return access


def can_inventory(request, permission: str) -> bool:
    """Granular capability check for the acting identity on this request."""
    return resolve_access(request).can(permission)


def view_cost_allowed(request) -> bool:
    """Costs (unit/avg cost, stock value, purchase and waste cost).

    Applied identically to JSON responses, CSV and PDF exports.
    """
    return can_inventory(request, InvPerm.VIEW_COST)


class IsMerchantOrSuperuser(permissions.BasePermission):
    """Dashboard-level gate: an identity allowed to view inventory."""

    def has_permission(self, request, view):
        return can_inventory(request, InvPerm.VIEW)
