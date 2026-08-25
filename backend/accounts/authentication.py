"""
accounts/authentication.py

Native JWT authentication is now handled entirely by
`rest_framework_simplejwt.authentication.JWTAuthentication`.

This module is kept for backwards compatibility and as documentation.
The SupabaseAuthentication class is intentionally left as a no-op so
that any code that imports it does not crash, but it will never be
the active authentication class — simplejwt is wired up in settings.py.
"""

from rest_framework import authentication


class SupabaseAuthentication(authentication.BaseAuthentication):
    """
    Deprecated: Supabase JWT authentication. No longer in use.
    Native Django JWT (djangorestframework-simplejwt) handles all auth now.
    """

    def authenticate(self, request):
        # Return None so the next authentication class in the chain runs.
        return None


from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailOrUsernameBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None or password is None:
            return None

        User = get_user_model()
        user = User.objects.filter(username=username).first()
        if user is None:
            user = User.objects.filter(email__iexact=username).first()

        if user is not None and user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
