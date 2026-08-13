"""
accounts/views.py

Auth endpoints:
  POST /api/auth/register/         — register customer or merchant
  POST /api/auth/login/            — obtain JWT access + refresh tokens
  POST /api/auth/token/refresh/    — refresh access token
  POST /api/auth/logout/           — blacklist refresh token
  GET  /api/auth/me/               — get own profile
  PATCH /api/auth/me/              — update own profile
  POST /api/auth/change-password/  — change password (authenticated)
  POST /api/auth/forgot-password/  — send reset email
  POST /api/auth/reset-password/   — apply reset token + new password

Media:
  POST /api/media/upload/          — upload an image file, get back a URL
"""

import secrets
from datetime import timedelta

from django.contrib.auth import update_session_auth_hash
from django.utils import timezone
from django.core.mail import send_mail
from django.conf import settings
from django.db import transaction

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.exceptions import TokenError

from .models import User, CustomerProfile, PasswordResetToken
from .serializers import (
    RegisterSerializer,
    UserProfileSerializer,
    UpdateProfileSerializer,
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    CustomTokenObtainPairSerializer,
)


# ── Login ─────────────────────────────────────────────────────────────────────

class LoginView(TokenObtainPairView):
    """
    POST /api/auth/login/
    Body: { "email": "...", "password": "..." }
    Returns: { access, refresh, role, email, full_name }
    """
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


# ── Register ──────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
@transaction.atomic
def register(request):
    """
    POST /api/auth/register/
    Body: { email, password, full_name, role, store_name? }
    Returns: { access, refresh, role, email, full_name }
    """
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    email = data["email"]
    role = data["role"]

    # Build username from email prefix (guaranteed unique per validate_email)
    base_username = email.split("@")[0]
    username = base_username
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f"{base_username}{counter}"
        counter += 1

    # Split full_name into first / last
    name_parts = data["full_name"].strip().split(" ", 1)
    first_name = name_parts[0]
    last_name = name_parts[1] if len(name_parts) > 1 else ""

    user = User.objects.create_user(
        username=username,
        email=email,
        password=data["password"],
        first_name=first_name,
        last_name=last_name,
        role=role,
    )

    # Create associated profile(s)
    if role == "customer":
        CustomerProfile.objects.create(
            user=user,
            full_name=data["full_name"],
            loyalty_points=0,
            tier="bronze",
        )

    elif role == "merchant":
        from merchants.models import MerchantProfile
        import re

        store_name = data["store_name"].strip()
        base_slug = re.sub(r"[^a-z0-9]+", "-", store_name.lower()).strip("-")
        slug = base_slug
        idx = 1
        while MerchantProfile.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{idx}"
            idx += 1

        MerchantProfile.objects.create(
            user=user,
            business_name=store_name,
            slug=slug,
            is_approved=True,  # Auto-approve for easier testing
            onboarding_complete=False,
            # POS feature flags (default False)
            pos_enabled=False,
            offline_pos_enabled=False,
            credit_accounts_enabled=False,
            debit_accounts_enabled=False,
            discounts_enabled=False,
            shift_management_enabled=False,
            receipt_printing_enabled=False,
            offline_discounts_allowed=False,
            offline_credit_allowed=False,
            max_worker_discount_percent=0,
            manager_approval_threshold=0,
        )

    # Issue tokens immediately so the user is logged in after registering
    refresh = RefreshToken.for_user(user)
    # Embed custom claims
    refresh["role"] = user.role
    refresh["email"] = user.email

    full_name = data["full_name"]
    refresh["full_name"] = full_name

    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "role": user.role,
            "email": user.email,
            "full_name": full_name,
        },
        status=status.HTTP_201_CREATED,
    )


register.throttle_scope = "login"


# ── Logout ────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    """
    POST /api/auth/logout/
    Body: { "refresh": "<refresh_token>" }
    Blacklists the refresh token so it cannot be reused.
    """
    refresh_token = request.data.get("refresh")
    if not refresh_token:
        return Response(
            {"error": "refresh token is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        token = RefreshToken(refresh_token)
        token.blacklist()
    except TokenError:
        # Already blacklisted or invalid — treat as success
        pass
    return Response({"detail": "Logged out successfully."}, status=status.HTTP_200_OK)


# ── Profile ───────────────────────────────────────────────────────────────────

@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request):
    """
    GET  /api/auth/me/ — return full user + loyalty profile
    PATCH /api/auth/me/ — update name, phone, avatar
    """
    if request.method == "GET":
        # Ensure every customer has a transfer code
        cp = getattr(request.user, "customer_profile", None)
        if cp and not cp.transfer_code:
            cp.transfer_code = CustomerProfile._generate_transfer_code()
            cp.save(update_fields=["transfer_code"])
        serializer = UserProfileSerializer(request.user)
        return Response(serializer.data)

    # PATCH
    serializer = UpdateProfileSerializer(request.user, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response(UserProfileSerializer(request.user).data)


# ── Change password ───────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([ScopedRateThrottle])
@transaction.atomic
def change_password(request):
    """
    POST /api/auth/change-password/
    Body: { old_password, new_password }
    """
    serializer = ChangePasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    if not user.check_password(serializer.validated_data["old_password"]):
        return Response(
            {"error": "Current password is incorrect."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.set_password(serializer.validated_data["new_password"])
    user.save()
    # Keep the session valid after password change (for session-based auth)
    update_session_auth_hash(request, user)
    return Response({"detail": "Password changed successfully."})


change_password.throttle_scope = "login"


# ── Forgot password ───────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def forgot_password(request):
    """
    POST /api/auth/forgot-password/
    Body: { "email": "user@example.com" }

    Sends a reset link to the user's email.
    Always returns 200 to prevent email enumeration.
    """
    serializer = ForgotPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    email = serializer.validated_data["email"]

    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Return success anyway — don't reveal whether email exists
        return Response({"detail": "If that email is registered, you will receive a reset link."})

    # Invalidate any existing unused tokens for this user
    PasswordResetToken.objects.filter(user=user, used=False).update(used=True)

    token = secrets.token_urlsafe(40)
    PasswordResetToken.objects.create(user=user, token=token)

    reset_url = f"{settings.FRONTEND_URL}/auth/reset-password?token={token}"

    send_mail(
        subject="Zentro — Reset your password",
        message=(
            f"Hi {user.first_name or user.email},\n\n"
            f"Click the link below to reset your password. "
            f"This link expires in 1 hour.\n\n"
            f"{reset_url}\n\n"
            f"If you did not request a password reset, you can safely ignore this email.\n\n"
            f"— The Zentro Team"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )

    return Response({"detail": "If that email is registered, you will receive a reset link."})


forgot_password.throttle_scope = "otp"


# ── Reset password ────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def reset_password(request):
    """
    POST /api/auth/reset-password/
    Body: { "token": "...", "new_password": "..." }
    """
    serializer = ResetPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    token_str = serializer.validated_data["token"]
    new_password = serializer.validated_data["new_password"]

    # Token must exist, be unused, and be less than 1 hour old
    cutoff = timezone.now() - timedelta(hours=1)
    try:
        reset_token = PasswordResetToken.objects.select_related("user").get(
            token=token_str,
            used=False,
            created_at__gte=cutoff,
        )
    except PasswordResetToken.DoesNotExist:
        return Response(
            {"error": "This reset link is invalid or has expired."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = reset_token.user
    user.set_password(new_password)
    user.save()

    reset_token.used = True
    reset_token.save(update_fields=["used"])

    return Response({"detail": "Password reset successfully. You can now log in."})


reset_password.throttle_scope = "otp"


# ── WebSocket auth token ──────────────────────────────────────────────────────
# WebSocket URLs appear in logs, proxies and monitoring tools, so we must not
# put a long-lived access token in the query string. Clients fetch this short-
# lived (60s) WS-only JWT and connect with ?token=<ws_token>. The WS middleware
# rejects tokens that lack the ws_auth claim, so a stolen access token can
# never be replayed into a WebSocket URL, and the WS token itself expires in
# a minute.

WS_TOKEN_LIFETIME = timedelta(seconds=60)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def ws_token(request):
    token = AccessToken.for_user(request.user)
    token["ws_auth"] = True
    token.set_exp(lifetime=WS_TOKEN_LIFETIME)
    return Response({"token": str(token), "expires_in": 60})


# ── Media upload ──────────────────────────────────────────────────────────────

import os
import uuid as _uuid
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_image(request):
    """
    POST /api/media/upload/
    Multipart form: field name = "file"
    Returns: { "url": "http://..." }

    Saves the uploaded file under MEDIA_ROOT/uploads/<uuid>.<ext>.
    In production, point MEDIA_ROOT at a CDN-backed directory or
    swap default_storage for S3/DigitalOcean Spaces.
    """
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)

    # Limit to image types
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        return Response(
            {"error": f"Unsupported file type: {file.content_type}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Build a safe unique filename
    ext = os.path.splitext(file.name)[1] or ".webp"
    filename = f"uploads/{_uuid.uuid4().hex}{ext}"

    saved_path = default_storage.save(filename, ContentFile(file.read()))
    file_url = request.build_absolute_uri(settings.MEDIA_URL + saved_path)

    return Response({"url": file_url}, status=status.HTTP_201_CREATED)