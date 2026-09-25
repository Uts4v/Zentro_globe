# merchants/serializers.py 
from decimal import ROUND_HALF_UP

from rest_framework import serializers
from .models import MerchantProfile, MenuItem, MenuCategory, MenuOptionGroup, MenuOption
import re


class CoordinateField(serializers.DecimalField):
    """
    Map coordinate stored as DECIMAL(9, 6).

    Browsers report GPS fixes with 10+ decimal places; round them to the
    column's 6 (~0.1 m) instead of rejecting the whole save.
    """

    def __init__(self, bound, **kwargs):
        kwargs.setdefault("max_digits", 9)
        kwargs.setdefault("decimal_places", 6)
        kwargs.setdefault("rounding", ROUND_HALF_UP)
        kwargs.setdefault("required", False)
        kwargs.setdefault("allow_null", True)
        super().__init__(min_value=-bound, max_value=bound, **kwargs)

    def validate_precision(self, value):
        # Range-check before quantize(): an out-of-range value would overflow
        # the 9-digit context there and raise instead of failing validation.
        if value > self.max_value:
            self.fail("max_value", max_value=self.max_value)
        if value < self.min_value:
            self.fail("min_value", min_value=self.min_value)
        return value


class MenuCategorySerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = MenuCategory
        fields = [
            "id", "name", "emoji", "is_active", "display_order",
            "item_count", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name cannot be blank.")
        if len(value) > 100:
            raise serializers.ValidationError("name is too long (max 100).")
        return value


class MenuOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuOption
        fields = [
            "id", "group", "name", "sku", "price", "price_delta",
            "is_default", "is_available", "display_order",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name cannot be blank.")
        if len(value) > 100:
            raise serializers.ValidationError("name is too long (max 100).")
        return value


class MenuOptionGroupSerializer(serializers.ModelSerializer):
    options = MenuOptionSerializer(many=True, required=False)

    class Meta:
        model = MenuOptionGroup
        fields = [
            "id", "name", "kind", "required", "min_select", "max_select",
            "is_active", "display_order", "options",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        min_select = attrs.get("min_select", 0)
        max_select = attrs.get("max_select", 1)
        if max_select < 1:
            raise serializers.ValidationError("max_select must be at least 1.")
        if min_select > max_select:
            raise serializers.ValidationError("min_select cannot exceed max_select.")
        if attrs.get("kind") == "variant" and max_select != 1:
            raise serializers.ValidationError("Variant groups allow exactly one selection (max_select = 1).")
        return attrs


class MenuItemSerializer(serializers.ModelSerializer):
    discount_price = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "description", "price", "image_url",
            "category", "is_available", "is_featured", "loyalty_reward",
            "points_per_item", "emoji",
            "discount_type", "discount_value", "discount_source",
            "discount_price", "discount_amount",
            "preparation_area", "requires_preparation",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_discount_price(self, obj):
        return _discount_price(obj)

    def get_discount_amount(self, obj):
        return _discount_amount(obj)

    def validate_price(self, value):
        if value <= 0:
            raise serializers.ValidationError("price must be greater than zero.")
        return value

    def validate_points_per_item(self, value):
        if value < 0:
            raise serializers.ValidationError("points_per_item cannot be negative.")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name cannot be blank.")
        if len(value) > 255:
            raise serializers.ValidationError("name is too long (max 255).")
        return value

    def validate_category(self, value):
        value = (value or "").strip()
        if len(value) > 100:
            raise serializers.ValidationError("category is too long (max 100).")
        return value


class MenuItemEditorSerializer(serializers.ModelSerializer):
    """Merchant-facing payload for the product editor — includes option groups."""
    groups = MenuOptionGroupSerializer(many=True, required=False, read_only=True, source="option_groups")
    category_name = serializers.CharField(source="category_ref.name", read_only=True, default=None)
    from_price = serializers.SerializerMethodField()
    discount_price = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()

    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "description", "short_description", "price", "image_url",
            "category", "category_ref", "category_name",
            "is_available", "is_featured", "status",
            "loyalty_reward", "points_per_item", "emoji",
            "dietary_tags", "allergens", "display_order",
            "discount_type", "discount_value", "discount_source",
            "preparation_area", "requires_preparation",
            "groups", "from_price", "discount_price", "discount_amount",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "discount_source", "created_at", "updated_at"]

    def get_from_price(self, obj):
        return _from_price(obj)

    def get_discount_price(self, obj):
        return _discount_price(obj)

    def get_discount_amount(self, obj):
        return _discount_amount(obj)

    def validate_discount_value(self, value):
        if value is not None and value < 0:
            raise serializers.ValidationError("discount_value cannot be negative.")
        return value

    def _apply_manual_source(self, instance, validated_data):
        fields = ("discount_type", "discount_value")
        if not any(name in validated_data for name in fields):
            return
        new_type = validated_data.get("discount_type", instance.discount_type)
        new_value = validated_data.get("discount_value", instance.discount_value)
        if new_type != instance.discount_type or new_value != instance.discount_value:
            instance.discount_source = MenuItem.DISCOUNT_SOURCE_MANUAL

    def create(self, validated_data):
        validated_data["discount_source"] = MenuItem.DISCOUNT_SOURCE_MANUAL
        return super().create(validated_data)

    def update(self, instance, validated_data):
        self._apply_manual_source(instance, validated_data)
        return super().update(instance, validated_data)

    def validate_price(self, value):
        if value < 0:
            raise serializers.ValidationError("price cannot be negative.")
        return value

    def validate_points_per_item(self, value):
        if value < 0:
            raise serializers.ValidationError("points_per_item cannot be negative.")
        return value

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("name cannot be blank.")
        if len(value) > 255:
            raise serializers.ValidationError("name is too long (max 255).")
        return value

    def validate_category(self, value):
        value = (value or "").strip()
        if len(value) > 100:
            raise serializers.ValidationError("category is too long (max 100).")
        return value

    def validate_category_ref(self, value):
        if value is None:
            return value
        merchant = self.context.get("merchant")
        if merchant is not None and value.merchant != merchant:
            raise serializers.ValidationError("Category does not belong to your business.")
        return value


class PublicMenuItemSerializer(serializers.ModelSerializer):
    """Customer-facing menu item — rich but safe. Server price is authoritative."""
    groups = MenuOptionGroupSerializer(many=True, required=False, read_only=True, source="option_groups")
    from_price = serializers.SerializerMethodField()
    discount_price = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    category_id = serializers.IntegerField(
        source="category_ref.id", read_only=True, default=None,
    )

    class Meta:
        model = MenuItem
        fields = [
            "id", "name", "description", "short_description", "price", "image_url",
            "emoji", "category", "category_id", "is_featured", "is_available", "status",
            "dietary_tags", "allergens", "points_per_item", "loyalty_reward",
            "discount_type", "discount_value", "discount_source",
            "groups", "from_price", "discount_price", "discount_amount",
        ]

    def get_from_price(self, obj):
        return _from_price(obj)

    def get_discount_price(self, obj):
        return _discount_price(obj)

    def get_discount_amount(self, obj):
        return _discount_amount(obj)


def _from_price(menu_item):
    """Minimum purchasable unit price (informational for display only)."""
    from decimal import Decimal

    from config.menu_pricing import apply_discount, resolve_discount

    prices = []
    for group in menu_item.option_groups.filter(is_active=True, kind="variant"):
        for opt in group.options.filter(is_available=True, group__is_active=True):
            if opt.price is not None:
                prices.append(opt.price)
    if not prices:
        base = menu_item.price
        discount_type, discount_value = resolve_discount(menu_item)
        if discount_type != "none":
            base, _ = apply_discount(base, discount_type, discount_value)
        return base
    return min(prices)


def _discount_price(menu_item):
    """Effective base price after the in-force discount, or None when undiscounted."""
    from config.menu_pricing import apply_discount, resolve_discount

    discount_type, discount_value = resolve_discount(menu_item)
    if discount_type == "none":
        return None
    price, _ = apply_discount(menu_item.price, discount_type, discount_value)
    return price


def _discount_amount(menu_item):
    """Per-unit amount saved by the in-force discount (0 when none applies)."""
    from decimal import Decimal

    from config.menu_pricing import apply_discount, resolve_discount

    discount_type, discount_value = resolve_discount(menu_item)
    if discount_type == "none":
        return Decimal("0.00")
    _, cut = apply_discount(menu_item.price, discount_type, discount_value)
    return cut


class MerchantProfileSerializer(serializers.ModelSerializer):
    menu_items = MenuItemSerializer(many=True, read_only=True)
    latitude = CoordinateField(bound=90)
    longitude = CoordinateField(bound=180)

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
            "offline_discounts_allowed", "offline_credit_allowed", "payment_qr_url",
            "tax_enabled", "tax_rate_percent", "tax_components",
            "currency_code", "currency_symbol",
            "ai_enabled", "ai_insights_enabled", "ai_insights_time", "timezone",
            "pdf_menu_url", "pdf_menu_token",
            "menu_items", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "is_approved", "qr_code", "pdf_menu_token", "created_at", "updated_at"]

    def validate(self, attrs):
        # A lone latitude or longitude is a pin in the wrong place: either
        # both change together (set or cleared) or neither does.
        if ("latitude" in attrs) != ("longitude" in attrs):
            raise serializers.ValidationError(
                {"location": "latitude and longitude must be sent together."}
            )
        if "latitude" in attrs and (attrs["latitude"] is None) != (attrs["longitude"] is None):
            raise serializers.ValidationError(
                {"location": "latitude and longitude must both be set or both be cleared."}
            )
        return attrs

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