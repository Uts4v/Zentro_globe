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
    send_otp,
    verify_otp,
    google_auth,
)

urlpatterns = [
    # Authentication
    path("register/", register, name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("google/", google_auth, name="auth-google"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("logout/", logout, name="auth-logout"),
    path("ws-token/", ws_token, name="auth-ws-token"),

    # Phone OTP (customer mobile verification)
    path("send-otp/", send_otp, name="auth-send-otp"),
    path("verify-otp/", verify_otp, name="auth-verify-otp"),

    # Profile
    path("me/", me, name="auth-me"),

    # Password management
    path("change-password/", change_password, name="auth-change-password"),
    path("forgot-password/", forgot_password, name="auth-forgot-password"),
    path("reset-password/", reset_password, name="auth-reset-password"),
]
