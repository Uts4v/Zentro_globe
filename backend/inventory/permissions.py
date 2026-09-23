"""
inventory/permissions.py

Reuses Zentro's existing authentication architecture: the merchant dashboard
is authenticated as `accounts.User` with role='merchant' (or a superuser).
No separate permissions framework is introduced — these constants and helpers
label the inventory capabilities so UI can be permission-aware and a future
POS-worker integration can map role → capabilities.

Every endpoint still enforces tenant scoping by resolving the acting
merchant from the request and validating each object belongs to it.
"""

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
    RECORD_WASTE = "inventory.record_waste"
    MANAGE_SUPPLIERS = "inventory.manage_suppliers"
    PURCHASE = "inventory.purchase"
    TRANSFER = "inventory.transfer"
    VIEW_REPORTS = "inventory.view_reports"
    MANAGE_SETTINGS = "inventory.manage_settings"

    ALL = [
        VIEW, VIEW_COST, MANAGE_ITEMS, COUNT, SUBMIT_COUNT, APPROVE_COUNT,
        RECEIVE, ADJUST, RECORD_WASTE, MANAGE_SUPPLIERS, PURCHASE,
        TRANSFER, VIEW_REPORTS, MANAGE_SETTINGS,
    ]

    # Role defaults — configurable by merchant later.
    ROLE_DEFAULTS = {
        "owner": ALL,
        "manager": [
            VIEW, VIEW_COST, MANAGE_ITEMS, COUNT, SUBMIT_COUNT, APPROVE_COUNT,
            RECEIVE, ADJUST, RECORD_WASTE, MANAGE_SUPPLIERS, PURCHASE, TRANSFER,
            VIEW_REPORTS, MANAGE_SETTINGS,
        ],
        "kitchen": [VIEW, COUNT, SUBMIT_COUNT, RECORD_WASTE],
        "bar": [VIEW, COUNT, SUBMIT_COUNT, RECORD_WASTE],
        "cashier": [VIEW],
    }


def user_merchant(user):
    """Resolve the acting MerchantProfile for a User, or None."""
    if user is None or not user.is_authenticated:
        return None
    try:
        return user.merchant_profile
    except Exception:
        return None


def can_inventory(user, permission: str) -> bool:
    """Granular capability check (V1: merchant owners/admins have all).

    ShiftWorker-level mapping is a documented future extension; the merchant
    dashboard treats the merchant user as owner-level. Superusers pass.
    """
    if user is None or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    if user.role != "merchant":
        return False
    return user_merchant(user) is not None


class IsMerchantOrSuperuser(permissions.BasePermission):
    """Dashboard-level gate: merchant user (or superuser) with a profile."""

    def has_permission(self, request, view):
        return can_inventory(request.user, InvPerm.VIEW)


def view_cost_allowed(user) -> bool:
    """Cost fields (avg/latest cost, stock value) can be restricted later.

    V1: merchant owner sees costs. Hook exists so the merchant settings can
    toggle this without changing call sites.
    """
    if user is None or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    merchant = user_merchant(user)
    if merchant is None:
        return False
    # Future: read merchant.inventory_settings.restrict_cost_visibility.
    return True