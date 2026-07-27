"""
accounts/serializers.py

Serializers for:
- Registration (customer and merchant)
- Login (custom JWT pair with role + name embedded)
- Profile read/update
- Password change / reset
"""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from .models import User, CustomerProfile


# ── JWT ───────────────────────────────────────────────────────────────────────

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Extends the default JWT serializer to:
    1. Accept "email" instead of "username" for login.
    2. Enforce the requested account role for customer vs merchant sign-in.
    3. Embed role and full_name in the JWT payload.
    """

    # Add an explicit email field; remove the default username field
    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True)
    role = serializers.ChoiceField(
        choices=[("customer", "customer"), ("merchant", "merchant")],
        required=False,
        allow_blank=False,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Remove the default "username" field so the body only asks for email
        self.fields.pop("username", None)

    @classmethod
    def get_token(cls, user: User):
        token = super().get_token(user)
        token["role"] = user.role
        token["email"] = user.email

        full_name = ""
        try:
            full_name = user.customer_profile.full_name
        except Exception:
            pass
        if not full_name:
            full_name = f"{user.first_name} {user.last_name}".strip()
        token["full_name"] = full_name
        return token

    def validate(self, attrs):
        email = attrs.get("email", "")
        password = attrs.get("password", "")
        requested_role = attrs.get("role")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise serializers.ValidationError(
                {"detail": "No active account found with the given credentials."}
            )

        if requested_role and requested_role != user.role:
            raise serializers.ValidationError(
                {
                    "detail": (
                        f"This account is a {user.role} account. "
                        f"Please use the {user.role} sign in page."
                    )
                }
            )

        if not user.check_password(password):
            raise serializers.ValidationError(
                {"detail": "No active account found with the given credentials."}
            )

        if not user.is_active:
            raise serializers.ValidationError({"detail": "This account is inactive."})

        # Build the tokens
        refresh = self.get_token(user)
        self.user = user

        full_name = ""
        try:
            full_name = user.customer_profile.full_name
        except Exception:
            pass

        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "role": user.role,
            "email": user.email,
            "full_name": full_name or f"{user.first_name} {user.last_name}".strip(),
        }


# ── Registration ──────────────────────────────────────────────────────────────

class RegisterSerializer(serializers.Serializer):
    """
    Handles both customer and merchant registration.

    Required for merchant: store_name.
    """

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True, min_length=8)
    full_name = serializers.CharField(max_length=255)
    role = serializers.ChoiceField(
        choices=["customer", "merchant"],
        default="customer",
    )
    # Merchant-only field
    store_name = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_email(self, value: str) -> str:
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value.lower().strip()

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def validate(self, data):
        if data.get("password") != data.get("confirm_password"):
            raise serializers.ValidationError(
                {"confirm_password": "Passwords do not match."}
            )
        if data.get("role") == "merchant" and not data.get("store_name", "").strip():
            raise serializers.ValidationError(
                {"store_name": "Store name is required for merchant accounts."}
            )
        return data


# ── Profile ───────────────────────────────────────────────────────────────────

class CustomerProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerProfile
        fields = [
            "id",
            "full_name",
            "loyalty_points",
            "streak_days",
            "total_orders",
            "tier",
            "transfer_code",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "loyalty_points", "streak_days", "total_orders", "tier", "transfer_code", "created_at", "updated_at"]


class UserProfileSerializer(serializers.ModelSerializer):
    """Full profile response — used for /api/auth/me/."""

    customer_profile = CustomerProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "role",
            "phone",
            "avatar_url",
            "customer_profile",
        ]
        read_only_fields = ["id", "email", "role"]


class UpdateProfileSerializer(serializers.ModelSerializer):
    """Allows users to update their own profile."""

    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)

    class Meta:
        model = User
        fields = ["first_name", "last_name", "phone", "avatar_url", "full_name"]

    def update(self, instance, validated_data):
        full_name = validated_data.pop("full_name", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()

        # Also update customer profile's full_name if present
        if full_name is not None and hasattr(instance, "customer_profile"):
            instance.customer_profile.full_name = full_name
            instance.customer_profile.save(update_fields=["full_name"])

        return instance


# ── Password ──────────────────────────────────────────────────────────────────

class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value
