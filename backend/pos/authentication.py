"""
pos/authentication.py — Staff token authentication for Django REST Framework.

Allows POS and Staff Mode requests bearing an `X-Zentro-Staff` header (or
`Authorization: Staff <token>`) to authenticate seamlessly.
The token identifies the ShiftWorker; the request is scoped to the worker's
merchant, and `request.worker` is set.
"""

from rest_framework import authentication, exceptions
from . import rbac


class StaffTokenAuthentication(authentication.BaseAuthentication):
    """
    Authenticates requests carrying an `X-Zentro-Staff` token (or `Authorization: Staff <token>`).

    Sets:
      - `request.user` = `worker.merchant.user` (so IsAuthenticated / IsMerchantUser passes)
      - `request.worker` = `worker` (the acting ShiftWorker instance)
      - `request._staff_worker` = `worker`
      - `request.pos_merchant` = `worker.merchant`
      - `request.is_staff_mode` = True
    """

    def authenticate(self, request):
        token = rbac.staff_token_from(request)
        if not token:
            auth_header = request.META.get("HTTP_AUTHORIZATION", "")
            if auth_header.startswith("Staff "):
                token = auth_header[6:].strip()

        if not token:
            return None  # Let next authentication class (e.g. JWTAuthentication) handle it

        worker = rbac.worker_from_token(token)
        if worker is None:
            # If a staff token was explicitly sent but is invalid or expired
            raise exceptions.AuthenticationFailed(
                "Your staff session has expired. Please sign in with your PIN again."
            )

        if not worker.is_active or getattr(worker, "is_deleted", False):
            raise exceptions.AuthenticationFailed(
                "This staff account is deactivated. Contact your administrator."
            )

        # Bind to request
        request.worker = worker
        request._staff_worker = worker
        request.pos_merchant = worker.merchant
        request.is_staff_mode = True

        return (worker.merchant.user, token)

    def authenticate_header(self, request):
        """
        Advertise this scheme so DRF answers 401 rather than downgrading to 403.

        DRF asks only the *first* authenticator for the challenge string, and
        falls back to 403 Forbidden when there is none. Without this line every
        unauthenticated request was reported as a permission problem instead of
        a login problem, which is what the connectivity probe and any status-
        based monitoring key off.
        """
        return 'Staff realm="zentro-pos"'
