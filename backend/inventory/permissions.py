"""
inventory/permissions.py

Reuses Zentro's existing identities — no new permission framework:

  * The merchant dashboard user (accounts.User, role='merchant') and
    superusers act as the OWNER.
  * A POS ShiftWorker can use the dashboard in "staff mode" on a shared
    device: the owner session starts a short-lived, signed staff session by
    verifying the worker's PIN (ShiftWorker.verify_pin, with its lockout).
    Requests then carry the staff token and are evaluated with the worker's
    ROLE from Zentro's central RBAC (pos.rbac). There is no separate
    inventory role system: ``ROLE_PERMISSION_MAP`` below translates the
    central permissions (inventory.view, inventory.count, …) into the
    inventory capabilities the endpoints check.

Every endpoint enforces its capability server-side (see ``inventory_perm``
in views.py). The UI only hides what the backend would refuse anyway.
An invalid or expired staff token fails closed; it never falls back to
owner access.
"""

from dataclasses import dataclass, field

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

    # Central role permission (pos.rbac) → inventory capabilities it grants.
    ROLE_PERMISSION_MAP = {
        "inventory.view": [VIEW],
        "inventory.count": [VIEW, COUNT, SUBMIT_COUNT],
        "inventory.receive": [VIEW, RECEIVE],
        "inventory.transfer": [VIEW, TRANSFER],
        "inventory.waste": [VIEW, RECORD_WASTE],
        "inventory.adjust": [VIEW, ADJUST, APPROVE_COUNT],
        "inventory.manage": [VIEW, MANAGE_ITEMS, MANAGE_SUPPLIERS, PURCHASE, VIEW_REPORTS],
        "inventory.costs": [VIEW_COST],
        "reports.view": [VIEW_REPORTS],
        "settings.manage": [MANAGE_SETTINGS, IMPORT],
    }

    @classmethod
    def for_role_permissions(cls, codes, is_admin=False) -> frozenset:
        """Inventory capabilities for a role's central permissions."""
        if is_admin:
            return frozenset(cls.ALL)
        granted = set()
        for code in codes:
            granted.update(cls.ROLE_PERMISSION_MAP.get(code, ()))
        if not any(code.startswith("inventory.") for code in codes):
            # Reports/settings alone do not open the inventory module.
            return frozenset()
        return frozenset(granted)




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
    from pos import rbac

    return rbac.issue_staff_token(worker)


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
            from pos import rbac

            token = rbac.staff_token_from(request)
            if token:
                worker = rbac.worker_from_token(token, merchant)
                if worker is None:
                    access.error = "Your staff session has ended. Please sign in again."
                else:
                    role = rbac.worker_role(worker)
                    access.worker = worker
                    access.role = role.system_key or "custom"
                    access.perms = InvPerm.for_role_permissions(
                        rbac.role_permissions(role), is_admin=role.is_admin
                    )
            else:
                # The merchant account owner is the Admin of their own merchant.
                access.role = "owner"
                access.perms = frozenset(InvPerm.ALL)

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
