from rest_framework import permissions


class IsAiEnabled(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        try:
            merchant = request.user.merchant_profile
            return merchant.ai_enabled
        except Exception:
            return False


class IsMerchantUser(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and hasattr(request.user, "merchant_profile")
        )
