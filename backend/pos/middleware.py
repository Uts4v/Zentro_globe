"""
pos/middleware.py — server-side enforcement for staff mode.

When a request carries a staff token (an employee is using the dashboard),
the employee's ROLE decides which API areas they may call. This is one
central table instead of role checks spread through the views; anything not
listed is denied. Without a staff token the request is the merchant owner
(Admin of their own merchant) and nothing here applies — tenant scoping in
the views still does.

Staff mode can only ever narrow access, never widen it.
"""

from django.http import JsonResponse

from . import rbac

READ_METHODS = ("GET", "HEAD", "OPTIONS")
ALLOW = None
NO_ACCESS = "You don't have access to this. Contact your administrator if you need access."
SESSION_ENDED = "Your staff session has ended. Please sign in again."

_ANY_STAFF_READ = ("pos.access", "kds.access", "staff.manage", "orders.create")

# (path prefix, permission for reads, permission for writes). First match wins.
# A permission may be a tuple meaning "any of these".
RULES = [
    ("/api/auth/", ALLOW, ALLOW),
    ("/api/notifications/", ALLOW, ALLOW),
    ("/api/pos/staff/", ALLOW, ALLOW),            # start/leave staff mode, who am I
    ("/api/inventory/", ALLOW, ALLOW),            # inventory maps the role itself
    ("/api/media/upload/", ("menu.manage", "settings.manage"), ("menu.manage", "settings.manage")),

    # Team
    ("/api/pos/roles/", ("roles.manage", "staff.manage"), "roles.manage"),
    ("/api/pos/workers/", _ANY_STAFF_READ, "staff.manage"),
    ("/api/pos/schedules/", _ANY_STAFF_READ, "staff.manage"),

    # POS money
    ("/api/pos/refund/", "payments.refund", "payments.refund"),
    ("/api/pos/discount/", "discounts.apply", "discounts.apply"),
    ("/api/pos/payment", "payments.take", "payments.take"),
    ("/api/pos/credit/", "payments.take", "payments.take"),
    ("/api/pos/debit/", "payments.take", "payments.take"),
    ("/api/pos/shift/close/", "shifts.close", "shifts.close"),
    ("/api/pos/z-report/", ("reports.view", "shifts.close"), ("reports.view", "shifts.close")),
    ("/api/pos/reports/", "reports.view", "reports.view"),
    ("/api/pos/staff-report/", "reports.view", "reports.view"),
    ("/api/pos/audit/", "reports.view", "reports.view"),
    ("/api/pos/settings/update/", "settings.manage", "settings.manage"),
    ("/api/pos/settings/free-item-pin/", "settings.manage", "settings.manage"),
    ("/api/pos/order/item/", "pos.access", ("orders.edit", "orders.cancel")),
    ("/api/finance/", "accounts.view", "accounts.manage"),
    ("/api/pos/device", "pos.access", "settings.manage"),
    ("/api/pos/order", "pos.access", "orders.create"),
    ("/api/pos/staff-shift", ("pos.access", "kds.access"), ("pos.access", "kds.access")),
    ("/api/pos/", ("pos.access", "kds.access"), "pos.access"),

    # Orders & kitchen (marking items is kitchen work; setting areas up is not)
    ("/api/orders/staff/", _ANY_STAFF_READ, "staff.manage"),
    ("/api/orders/preparation-settings/", ("kds.access", "pos.access"), "settings.manage"),
    ("/api/orders/preparation-areas/", ("kds.access", "pos.access", "staff.manage"), "settings.manage"),
    ("/api/orders/", ("pos.access", "orders.create", "kds.access", "reports.view"), "orders.create"),

    # Tables
    ("/api/merchants/table-areas/", ("tables.view", "tables.manage", "pos.access"), "tables.manage"),
    ("/api/merchants/tables/", ("tables.view", "tables.manage", "pos.access"), "tables.manage"),

    # Menu
    ("/api/merchants/categories/", ALLOW, "menu.manage"),
    ("/api/merchants/menu-items/", ALLOW, "menu.manage"),
    ("/api/merchants/pdf-menu/", ALLOW, "menu.manage"),
    ("/api/loyalty/merchant/specials/", ALLOW, "menu.manage"),

    # Business
    ("/api/merchants/analytics/", "reports.view", "reports.view"),
    ("/api/merchants/", ALLOW, "settings.manage"),

    # Customers, loyalty, offers
    ("/api/offers/pos/", "pos.access", "pos.access"),
    ("/api/offers/merchant/redeem/", ("pos.access", "customers.manage"), ("pos.access", "customers.manage")),
    ("/api/offers/", "customers.manage", "customers.manage"),
    ("/api/loyalty/punch-cards/confirm-proof/", ("pos.access", "customers.manage"), ("pos.access", "customers.manage")),
    ("/api/loyalty/redemptions/", ("pos.access", "customers.manage"), ("pos.access", "customers.manage")),
    ("/api/loyalty/", "customers.manage", "customers.manage"),

    ("/api/ai/", "reports.view", "reports.view"),
]

# Reachable even with an expired token, so a stuck device can recover.
_NO_TOKEN_CHECK = ("/api/auth/", "/api/pos/staff/", "/api/inventory/staff/")


def required_permission(path: str, method: str):
    """Permission needed for this call in staff mode. ``False`` = denied."""
    read = method in READ_METHODS
    if path.startswith("/api/orders/preparation-areas/") and "/action/" in path:
        return "kds.access"
    if path.startswith("/api/orders/") and path.endswith("/cancel/"):
        return "orders.cancel"
    for prefix, read_perm, write_perm in RULES:
        if path.startswith(prefix):
            return read_perm if read else write_perm
    return False


def _denied(message, code="no_access"):
    return JsonResponse({"detail": message, "error": message, "code": code}, status=403)


class StaffModeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = rbac.staff_token_from(request)
        if not token or not request.path.startswith("/api/"):
            return self.get_response(request)
        if request.path.startswith(_NO_TOKEN_CHECK):
            return self.get_response(request)

        worker = rbac.worker_from_token(token)
        if worker is None:
            return _denied(SESSION_ENDED, code="staff_session_ended")
        request._staff_worker = worker

        needed = required_permission(request.path, request.method)
        if needed is False:
            return _denied(NO_ACCESS)
        if needed is not ALLOW:
            perms = rbac.worker_permissions(worker)
            wanted = needed if isinstance(needed, tuple) else (needed,)
            if not any(code in perms for code in wanted):
                return _denied(NO_ACCESS)
        return self.get_response(request)
