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

import os
import secrets
from datetime import timedelta

from django.contrib.auth import update_session_auth_hash
from django.utils import timezone
from django.core.mail import send_mail
from django.core import signing
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

from config.media_utils import UploadValidationError, validate_image_upload

from .models import User, CustomerProfile, PasswordResetToken, OtpCode
from .sms import send_sms, build_otp_message
from .serializers import (
    RegisterSerializer,
    UserProfileSerializer,
    UpdateProfileSerializer,
    ChangePasswordSerializer,
    ForgotPasswordSerializer,
    ResetPasswordSerializer,
    CustomTokenObtainPairSerializer,
    SendOtpSerializer,
    VerifyOtpSerializer,
    GoogleAuthSerializer,
    OtpPurpose,
    sign_phone_token,
)


# ── Shared helpers ────────────────────────────────────────────────────────────


def _resolve_full_name(user: User, fallback: str = "") -> str:
    full_name = ""
    try:
        full_name = user.customer_profile.full_name
    except Exception:
        pass
    if not full_name:
        full_name = f"{user.first_name} {user.last_name}".strip()
    return full_name or fallback


def _auth_payload(user: User, full_name: str = "") -> dict:
    """Build the JWT response dict used by login/register/google."""
    full_name = full_name or _resolve_full_name(user)
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    refresh["email"] = user.email
    refresh["full_name"] = full_name
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": user.role,
        "email": user.email,
        "full_name": full_name,
    }


def _create_customer_profile(user: User, full_name: str) -> None:
    CustomerProfile.objects.create(
        user=user,
        full_name=full_name,
        loyalty_points=0,
        tier="bronze",
    )


def _create_merchant_profile(user: User, store_name: str) -> None:
    from merchants.models import MerchantProfile
    import re

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
        is_approved=os.getenv("AUTO_APPROVE_MERCHANTS", "false").lower() == "true",
        onboarding_complete=False,
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


def _unique_username(email: str) -> str:
    base = email.split("@")[0]
    username = base
    counter = 1
    while User.objects.filter(username=username).exists():
        username = f"{base}{counter}"
        counter += 1
    return username


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
    phone = data.get("phone", "")
    phone_verified = data.get("phone_verified", False)
    username = _unique_username(email)

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
        phone=phone,
        phone_verified=phone_verified,
    )

    # Create associated profile(s)
    if role == "customer":
        _create_customer_profile(user, data["full_name"])

    elif role == "merchant":
        _create_merchant_profile(user, data["store_name"].strip())

    # Issue tokens immediately so the user is logged in after registering
    return Response(_auth_payload(user, data["full_name"]), status=status.HTTP_201_CREATED)


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


# ── OTP (mobile verification) ─────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def send_otp(request):
    """
    POST /api/auth/send-otp/
    Body: { "phone": "+15551234567", "purpose": "signup" }
    Sends a 6-digit code by SMS. In dev (SMS_BACKEND=console, DEBUG=True)
    the code is logged and returned as `debug_code`.
    """
    serializer = SendOtpSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    phone = serializer.validated_data["phone"]
    purpose = serializer.validated_data["purpose"]

    # Invalidate outstanding unused codes for this phone+purpose.
    OtpCode.objects.filter(identifier=phone, purpose=purpose, is_used=False).update(is_used=True)

    otp = OtpCode.issue(phone, purpose, ttl_minutes=settings.OTP_TTL_MINUTES)
    try:
        result = send_sms(phone, build_otp_message(otp.plain_code))
    except Exception as exc:
        otp.is_used = True
        otp.save(update_fields=["is_used"])
        return Response(
            {"error": f"Could not deliver the code: {exc}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )

    payload = {
        "detail": "Verification code sent.",
        "sent_via": result.get("channel"),
        "expires_in_seconds": settings.OTP_TTL_MINUTES * 60,
    }
    # Dev-only: surface the code so local testing doesn't need a real SMS.
    if settings.DEBUG and result.get("debug_code"):
        payload["debug_code"] = result["debug_code"]
    return Response(payload)


send_otp.throttle_scope = "otp"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def verify_otp(request):
    """
    POST /api/auth/verify-otp/
    Body: { "phone": "+15551234567", "code": "123456", "purpose": "signup" }
    On success returns { verified, phone_token } where phone_token is a
    short-lived signed proof of phone ownership (used at register / google).
    """
    serializer = VerifyOtpSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    phone = serializer.validated_data["phone"]
    code = serializer.validated_data["code"]
    purpose = serializer.validated_data["purpose"]

    otp_obj = (
        OtpCode.objects.filter(
            identifier=phone,
            purpose=purpose,
            is_used=False,
            expires_at__gte=timezone.now(),
        )
        .order_by("-created_at")
        .first()
    )
    if otp_obj is None:
        return Response(
            {"error": "No active code found. Please request a new one."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if otp_obj.attempts >= 5:
        return Response(
            {"error": "Too many attempts. Please request a new code."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not otp_obj.verify(code):
        otp_obj.attempts += 1
        otp_obj.save(update_fields=["attempts"])
        return Response({"error": "Incorrect code."}, status=status.HTTP_400_BAD_REQUEST)

    otp_obj.is_used = True
    otp_obj.save(update_fields=["is_used"])

    phone_token = sign_phone_token(phone, purpose=purpose)
    return Response({"verified": True, "phone_token": phone_token, "phone": phone})


verify_otp.throttle_scope = "otp"


# ── Google OAuth ("Continue with Google") ────────────────────────────────────

def _google_client_ids() -> list:
    cids = settings.GOOGLE_OAUTH_CLIENT_IDS or []
    if settings.GOOGLE_AUDIENCE:
        cids.append(settings.GOOGLE_AUDIENCE)
    return list(dict.fromkeys(cids))


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
@transaction.atomic
def google_auth(request):
    """
    POST /api/auth/google/
    Body: {
      "id_token": "<credential from Google Identity Services>",
      "role": "customer" | "merchant",
      "phone": "+15551234567",       // optional — collected from the sign-up form
      "phone_token": "...",           // optional — verified only if supplied
      "store_name": "..."             // required iff role == merchant
    }
    Verifies the Google ID token, finds or creates the user (by google_sub or
    email), links the Google account and issues JWTs.

    Note: Google's basic profile scope does NOT include a phone number, so any
    phone is collected from the sign-up form. OTP verification is optional for
    now (SMS gated behind a future update).
    """
    serializer = GoogleAuthSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    client_ids = _google_client_ids()
    if not client_ids:
        return Response(
            {"error": "Google sign-in is not configured on the server."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        info = google_id_token.verify_oauth2_token(
            data["id_token"],
            google_requests.Request(),
            audience=client_ids if len(client_ids) > 1 else client_ids[0],
        )
    except Exception:
        return Response(
            {"error": "The Google token could not be verified."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if info.get("aud") not in client_ids:
        return Response(
            {"error": "The Google token audience is not recognised."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    email = (info.get("email") or "").lower().strip()
    if not email:
        return Response(
            {"error": "No email address on this Google account."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not info.get("email_verified"):
        return Response(
            {"error": "The Google email address is not verified."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    sub = str(info["sub"])
    role = data["role"]
    google_name = (info.get("name") or "").strip()
    google_picture = (info.get("picture") or "").strip()

    try:
        user = User.objects.get(google_sub=sub)
    except User.DoesNotExist:
        user = User.objects.filter(email=email).first()

    if user is None:
        # ── New account ─────────────────────────────────────────────────────
        name_parts = google_name.split(" ", 1)
        user = User.objects.create_user(
            username=_unique_username(email),
            email=email,
            password=None,
            role=role,
            first_name=name_parts[0],
            last_name=name_parts[1] if len(name_parts) > 1 else "",
            google_sub=sub,
            avatar_url=google_picture,
            phone=data.get("phone", ""),
            phone_verified=data.get("phone_verified", False),
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])

        if role == "customer":
            _create_customer_profile(user, google_name or email)
        else:
            _create_merchant_profile(user, data["store_name"].strip())

    else:
        # ── Existing account — link Google if not already linked ────────────
        if role != user.role:
            return Response(
                {
                    "error": (
                        f"This email already belongs to a {user.role} account. "
                        f"Please use the {user.role} sign-in page."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        changed = False
        if not user.google_sub:
            user.google_sub = sub
            changed = True
        if not user.avatar_url and google_picture:
            user.avatar_url = google_picture
            changed = True
        if data.get("phone") and user.phone != data["phone"]:
            user.phone = data["phone"]
            user.phone_verified = data.get("phone_verified", False)
            changed = True
        if changed:
            user.save()

        if role == "customer" and not hasattr(user, "customer_profile"):
            _create_customer_profile(user, google_name or _resolve_full_name(user))

    return Response(_auth_payload(user, google_name or _resolve_full_name(user)))


google_auth.throttle_scope = "login"


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
@throttle_classes([ScopedRateThrottle])
def upload_image(request):
    """
    POST /api/media/upload/
    Multipart form: field name = "file"
    Returns: { "url": "http://..." }

    The upload is treated as untrusted: the file is sniffed with Pillow,
    only JPEG/PNG/WEBP raster images are accepted, and the image is
    re-encoded server-side and stored under a server-generated name.
    In production, point MEDIA_ROOT at a CDN-backed directory or
    swap default_storage for S3/DigitalOcean Spaces.
    """
    file = request.FILES.get("file")

    try:
        data, ext = validate_image_upload(file)
    except UploadValidationError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    # Server-generated filename + canonical extension (never derived from the
    # client filename, which is untrusted).
    filename = f"uploads/{_uuid.uuid4().hex}{ext}"

    saved_path = default_storage.save(filename, ContentFile(data))
    file_url = request.build_absolute_uri(settings.MEDIA_URL + saved_path)

    return Response({"url": file_url}, status=status.HTTP_201_CREATED)


upload_image.throttle_scope = "upload"