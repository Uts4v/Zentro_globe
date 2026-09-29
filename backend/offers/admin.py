from django.contrib import admin
from unfold.admin import ModelAdmin, StackedInline, TabularInline

from .models import (
    PromotionBenefit,
    PromotionCampaign,
    PromotionCondition,
    PromotionDailyStats,
    PromotionTarget,
    VoucherClaim,
    VoucherRedemption,
)


class BenefitInline(StackedInline):
    model = PromotionBenefit
    extra = 0


class ConditionInline(TabularInline):
    model = PromotionCondition
    extra = 0


class TargetInline(TabularInline):
    model = PromotionTarget
    extra = 0
    raw_id_fields = ("menu_item", "category", "option")


@admin.register(PromotionCampaign)
class PromotionCampaignAdmin(ModelAdmin):
    list_display = ("title", "merchant", "status", "visibility", "claims_count", "redemptions_count",
                    "is_hidden_by_admin", "ends_at")
    list_filter = ("status", "visibility", "is_hidden_by_admin")
    search_fields = ("title", "merchant__business_name")
    list_editable = ("is_hidden_by_admin",)
    readonly_fields = ("claims_count", "reserved_count", "redemptions_count", "link_token", "version",
                       "published_at", "created_at", "updated_at")
    inlines = [BenefitInline, ConditionInline, TargetInline]


@admin.register(VoucherClaim)
class VoucherClaimAdmin(ModelAdmin):
    list_display = ("display_code", "campaign", "customer", "status", "uses_count", "uses_allowed",
                    "expires_at", "claimed_at")
    list_filter = ("status", "source")
    search_fields = ("code", "campaign__title", "customer__full_name", "customer__user__email")
    readonly_fields = ("code", "qr_token", "claimed_at", "updated_at")
    raw_id_fields = ("campaign", "customer", "merchant", "reserved_order")


@admin.register(VoucherRedemption)
class VoucherRedemptionAdmin(ModelAdmin):
    list_display = ("id", "campaign", "merchant", "customer", "channel", "status", "discount_amount", "created_at")
    list_filter = ("status", "channel")
    raw_id_fields = ("claim", "campaign", "merchant", "customer", "order", "redeemed_by_worker", "redeemed_by_user")
    readonly_fields = [f.name for f in VoucherRedemption._meta.fields]

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PromotionDailyStats)
class PromotionDailyStatsAdmin(ModelAdmin):
    list_display = ("campaign", "date", "views", "claims", "redemptions", "voids", "discount_total", "sales_total")
    list_filter = ("date",)
