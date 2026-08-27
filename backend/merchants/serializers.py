# merchants/serializers.py 
from rest_framework import serializers
from .models import MerchantProfile, MenuItem
import re


class MenuItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "description", "price", "image_url",
            "category", "is_available", "is_featured", "loyalty_reward",
            "points_per_item", "emoji",
            "preparation_area", "requires_preparation",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class MerchantProfileSerializer(serializers.ModelSerializer):
    menu_items = MenuItemSerializer(many=True, read_only=True)

    class Meta:
        model = MerchantProfile
        fields = [
            "id", "business_name", "slug", "business_type",
            "address", "phone", "logo_url", "banner_url",
            "description", "is_approved", "is_open",
            "onboarding_complete",
            "latitude", "longitude", "qr_code",
            "store_theme_color", "card_text_color", "card_background_image",
            "table_ordering_enabled", "allow_pickup", "allow_delivery", "allow_dine_in",
            "allow_point_transfer",
            "pos_enabled", "offline_pos_enabled",
            "credit_accounts_enabled", "debit_accounts_enabled",
            "discounts_enabled", "shift_management_enabled", "receipt_printing_enabled",
            "max_worker_discount_percent", "manager_approval_threshold",
            "offline_discounts_allowed", "offline_credit_allowed",
            "tax_enabled", "tax_rate_percent", "tax_components",
            "currency_code", "currency_symbol",
            "ai_enabled", "ai_insights_enabled", "ai_insights_time", "timezone",
            "pdf_menu_url", "pdf_menu_token",
            "menu_items", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_approved", "qr_code", "pdf_menu_token", "created_at", "updated_at"]

    def validate_slug(self, value):
        value = value.lower().strip()
        value = re.sub(r"[^\w-]", "", value.replace(" ", "-"))
        if not value:
            raise serializers.ValidationError("Slug cannot be empty.")
        qs = MerchantProfile.objects.filter(slug=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This slug is already taken.")
        return value


class MerchantPublicSerializer(serializers.ModelSerializer):
    """Public merchant data for customer-facing views — no private fields."""

    class Meta:
        model = MerchantProfile
        fields = [
            "id", "business_name", "slug", "business_type",
            "address", "phone", "logo_url", "banner_url",
            "description", "is_open",
            "latitude", "longitude",
            "store_theme_color", "card_text_color", "card_background_image",
            "table_ordering_enabled", "allow_pickup", "allow_delivery", "allow_dine_in",
        ]


class MerchantDiscoverySerializer(serializers.ModelSerializer):
    """Minimal public fields for map/nearby discovery — nothing private."""
    distance_km = serializers.SerializerMethodField()

    class Meta:
        model = MerchantProfile
        fields = [
            "id", "business_name", "slug", "business_type",
            "address", "phone", "logo_url", "is_open",
            "latitude", "longitude", "distance_km",
        ]

    def get_distance_km(self, obj):
        distance = self.context.get("distances", {}).get(obj.id)
        return round(distance, 2) if distance is not None else None