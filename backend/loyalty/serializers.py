"""
loyalty/serializers.py
"""

from rest_framework import serializers
from merchants.models import MenuItem
from .models import (
    LoyaltyRules,
    Mission,
    CustomerMission,
    Reward,
    Redemption,
    CustomerMerchantProfile,
    CustomerMerchantWallet,
    MerchantPunchCard,
    CustomerPunchCard,
    PointTransaction,
    TodaySpecial,
    MembershipQrToken,
    MerchantMembershipCardDesign,
)

class LoyaltyRulesSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyRules
        fields = [
            "id",
            "points_per_npr",
            "streak_multiplier",
            "welcome_bonus",
            "birthday_bonus",
            "streak_min_amount",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]


class MerchantPunchCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = MerchantPunchCard
        fields = [
            "id",
            "merchant",
            "name",
            "mode",
            "stamps_required",
            "reward_text",
            "background_image",
            "animated_gif_background",
            "color_scheme",
            "stamp_icon",
            "stamp_gif_url",
            "logo",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "merchant", "created_at", "updated_at"]


class CustomerPunchCardSerializer(serializers.ModelSerializer):
    punch_card    = MerchantPunchCardSerializer(read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)

    class Meta:
        model = CustomerPunchCard
        fields = [
            "id", "customer", "punch_card", "merchant", "merchant_name",
            "current_stamps", "is_completed", "completed_at",
            "is_redeemed", "redeemed_at",
            "proof_code", "proof_code_expires_at", "proof_code_used",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "customer", "punch_card", "merchant", "merchant_name",
            "created_at", "updated_at",
        ]

class PointTransactionSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)

    class Meta:
        model = PointTransaction
        fields = [
            "id",
            "merchant",
            "merchant_name",
            "customer",
            "customer_name",
            "transaction_type",
            "points",
            "balance_before",
            "balance_after",
            "expiry_date",
            "status",
            "description",
            "created_at",
        ]
        read_only_fields = fields


class MissionSerializer(serializers.ModelSerializer):
    required_merchant_name = serializers.CharField(
        source="required_merchant.business_name",
        read_only=True,
        default="",
    )
    linked_menu_item_name = serializers.CharField(
        source="linked_menu_item.name", read_only=True, default=None,
    )
    linked_menu_item = serializers.PrimaryKeyRelatedField(
        queryset=MenuItem.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Mission
        fields = [
            "id",
            "title",
            "description",
            "icon",
            "mission_type",
            "target_count",
            "reward_points",
            "required_merchant",
            "required_merchant_name",
            "is_active",
            "restart_interval",
            "linked_menu_item",
            "linked_menu_item_name",
            "starts_at",
            "ends_at",
            "created_at",
        ]
        read_only_fields = ["id", "required_merchant", "required_merchant_name", "linked_menu_item_name", "created_at"]
class TodaySpecialSerializer(serializers.ModelSerializer):
    linked_menu_item_name = serializers.CharField(
        source="linked_menu_item.name", read_only=True, default=None
    )
    linked_reward_name = serializers.CharField(
        source="linked_reward.name", read_only=True, default=None
    )
    linked_menu_item_price = serializers.DecimalField(
        source="linked_menu_item.price", max_digits=10, decimal_places=2,
        read_only=True, default=None,
    )

    class Meta:
        model = TodaySpecial
        fields = [
            "id", "title", "description", "image_url",
            "linked_menu_item", "linked_menu_item_name", "linked_menu_item_price",
            "linked_reward", "linked_reward_name",
            "discount_type", "discount_value",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

class CustomerMissionSerializer(serializers.ModelSerializer):
    """Customer-facing: mission details + customer's progress."""

    mission = MissionSerializer(read_only=True)

    class Meta:
        model = CustomerMission
        fields = [
            "id",
            "mission",
            "current_count",
            "is_completed",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "mission", "created_at", "updated_at"]


class MissionViewSerializer(serializers.Serializer):
    """
    Flat view used by the /my-missions/ endpoint.
    Mirrors the Supabase MissionView interface.
    """

    id = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField()
    icon = serializers.CharField()
    target_count = serializers.IntegerField()
    current_count = serializers.IntegerField()
    reward_points = serializers.IntegerField()
    is_completed = serializers.BooleanField()
    mission_type = serializers.CharField()
    merchant_name = serializers.CharField(default="")


class RewardSerializer(serializers.ModelSerializer):
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)
    linked_menu_item_name = serializers.CharField(
        source="linked_menu_item.name", read_only=True, default=None,
    )
    linked_menu_item = serializers.PrimaryKeyRelatedField(
        queryset=MenuItem.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Reward
        fields = [
            "id",
            "merchant",
            "merchant_name",
            "name",
            "description",
            "emoji",
            "points_cost",
            "image_url",
            "is_active",
            "stock",
            "linked_menu_item",
            "linked_menu_item_name",
            "created_at",
        ]
        read_only_fields = ["id", "merchant", "merchant_name", "linked_menu_item_name", "created_at"]


class RedemptionSerializer(serializers.ModelSerializer):
    reward = RewardSerializer(read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)

    class Meta:
        model = Redemption
        fields = [
            "id",
            "customer",
            "customer_name",
            "reward",
            "points_spent",
            "status",
            "code",
            "confirmed_at",
            "expires_at",
            "created_at",
        ]
        read_only_fields = ["id", "customer", "customer_name", "reward", "created_at"]


class LeaderboardEntrySerializer(serializers.Serializer):
    """
    Public leaderboard row (customer-facing).

    Exposes only the non-sensitive fields the customer app renders. Requires
    an authenticated request and is rate-limited (see leaderboard view).
    """

    rank = serializers.IntegerField(read_only=True)
    customer_id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    loyalty_points = serializers.IntegerField(read_only=True)
    tier = serializers.CharField(read_only=True)
    streak_days = serializers.IntegerField(read_only=True)
    merchant_id = serializers.IntegerField(read_only=True)


class CustomerMerchantProfileSerializer(serializers.ModelSerializer):
    merchant_id = serializers.IntegerField(source="merchant.id", read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)
    merchant_slug = serializers.CharField(source="merchant.slug", read_only=True)

    class Meta:
        model = CustomerMerchantProfile
        fields = [
            "id",
            "merchant_id",
            "merchant_name",
            "merchant_slug",
            "joined_at",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class CustomerMerchantWalletSerializer(serializers.ModelSerializer):
    merchant_id = serializers.IntegerField(source="merchant.id", read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)
    merchant_slug = serializers.CharField(source="merchant.slug", read_only=True)

    class Meta:
        model = CustomerMerchantWallet
        fields = [
            "id",
            "merchant_id",
            "merchant_name",
            "merchant_slug",
            "points_balance",
            "lifetime_points",
            "expired_points",
            "order_count",
            "streak_days",
            "last_order_datetime",
            "last_point_earned_at",
            "tier_level",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class MembershipSerializer(serializers.ModelSerializer):
    """Serializer for the customer membership response.

    Returns the shape requested by the membership API:
    {
        "membership_id": 42,
        "membership_number": "CAF-A91K22",
        "merchant": { "name": "...", "slug": "...", "logo": "..." },
        "joined_at": "...",
        "status": "active"
    }
    """

    membership_id = serializers.IntegerField(source="id", read_only=True)
    merchant = serializers.SerializerMethodField()

    class Meta:
        model = CustomerMerchantProfile
        fields = [
            "membership_id",
            "membership_number",
            "merchant",
            "joined_at",
            "status",
            "is_active",
            "last_active_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "membership_id",
            "membership_number",
            "joined_at",
            "status",
            "is_active",
            "last_active_at",
            "created_at",
            "updated_at",
        ]

    def get_merchant(self, obj):
        return {
            "name": obj.merchant.business_name,
            "slug": obj.merchant.slug,
            "logo": obj.merchant.logo_url,
        }


class MembershipCardSerializer(serializers.ModelSerializer):
    """Returns the full card data for the customer card stack UI."""

    merchant = serializers.SerializerMethodField()
    membership = serializers.SerializerMethodField()
    wallet = serializers.SerializerMethodField()
    card_design = serializers.SerializerMethodField()
    transfer_enabled = serializers.SerializerMethodField()

    class Meta:
        model = CustomerMerchantProfile
        fields = [
            "merchant",
            "membership",
            "wallet",
            "card_design",
            "transfer_enabled",
        ]

    def get_merchant(self, obj):
        return {
            "name": obj.merchant.business_name,
            "slug": obj.merchant.slug,
            "logo": obj.merchant.logo_url,
        }

    def get_membership(self, obj):
        num = obj.membership_number or ""
        if len(num) > 4:
            masked = "•••• " + num[-6:]
        else:
            masked = num
        return {
            "membership_number_masked": masked,
            "membership_number_full": num,
            "joined_at": obj.joined_at.isoformat() if obj.joined_at else None,
            "status": obj.status,
        }

    def get_wallet(self, obj):
        w = None
        try:
            # Try reverse FK first (wallets linked via membership FK)
            w = obj.wallets.first()
        except Exception:
            pass
        if not w:
            try:
                # Fallback: match by customer+merchant directly
                from .models import CustomerMerchantWallet
                w = CustomerMerchantWallet.objects.filter(
                    customer=obj.customer,
                    merchant=obj.merchant,
                ).first()
            except Exception:
                pass
        if not w:
            return {
                "points_balance": 0,
                "lifetime_points": 0,
                "redeemed_points": 0,
                "tier": "bronze",
                "streak_days": 0,
            }
        return {
            "points_balance": w.points_balance,
            "lifetime_points": w.lifetime_points,
            "redeemed_points": w.redeemed_points,
            "tier": w.tier_level,
            "streak_days": getattr(w, "streak_days", 0),
        }

    def get_card_design(self, obj):
        try:
            design = obj.merchant.card_design
            if not design.is_published:
                return None
            return {
                "primary_color": design.primary_color,
                "secondary_color": design.secondary_color,
                "accent_color": design.accent_color,
                "text_mode": design.text_mode,
                "background_pattern": design.background_pattern,
                "background_type": design.background_type,
                "background_image": design.background_image,
                "card_title": design.card_title,
                "card_subtitle": design.card_subtitle,
                "logo": design.logo,
                "tier_style": design.tier_style,
                "points_label": design.points_label,
                "membership_label": design.membership_label,
                "show_lifetime_points": design.show_lifetime_points,
                "show_joined_date": design.show_joined_date,
                "show_qr_shortcut": design.show_qr_shortcut,
                "show_color_overlay": design.show_color_overlay,
            }
        except MerchantMembershipCardDesign.DoesNotExist:
            return None

    def get_transfer_enabled(self, obj):
        return obj.merchant.allow_point_transfer


class MembershipQrTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = MembershipQrToken
        fields = [
            "id",
            "public_token",
            "token_version",
            "is_active",
            "created_at",
            "rotated_at",
        ]
        read_only_fields = fields


class MerchantCardDesignSerializer(serializers.ModelSerializer):
    class Meta:
        model = MerchantMembershipCardDesign
        fields = [
            "id",
            "card_title",
            "card_subtitle",
            "background_type",
            "primary_color",
            "secondary_color",
            "accent_color",
            "text_mode",
            "background_image",
            "background_pattern",
            "logo",
            "tier_style",
            "points_label",
            "membership_label",
            "show_lifetime_points",
            "show_joined_date",
            "show_qr_shortcut",
            "show_color_overlay",
            "is_published",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
