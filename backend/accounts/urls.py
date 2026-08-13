"""
accounts/urls.py

Auth URL routes mounted at /api/auth/.
"""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    register,
    logout,
    me,
    change_password,
    forgot_password,
    reset_password,
    ws_token,
    upload_image,
)

urlpatterns = [
    # Authentication
    path("register/", register, name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("logout/", logout, name="auth-logout"),
    path("ws-token/", ws_token, name="auth-ws-token"),

    # Profile
    path("me/", me, name="auth-me"),

    # Password management
    path("change-password/", change_password, name="auth-change-password"),
    path("forgot-password/", forgot_password, name="auth-forgot-password"),
    path("reset-password/", reset_password, name="auth-reset-password"),
]
