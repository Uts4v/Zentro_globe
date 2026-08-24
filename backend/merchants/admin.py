# merchants/admin.py
from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from .models import MerchantProfile, MenuItem, MerchantTable


@admin.register(MerchantProfile)
class MerchantProfileAdmin(UnfoldModelAdmin):
    list_display = [
        "business_name",   # was store_name
        "slug",            # was store_slug
        "phone",
        "is_approved",
        "is_open",
        "onboarding_complete",
        "table_ordering_enabled",
        "created_at",
    ]
    list_filter = ["is_approved", "is_open", "onboarding_complete", "table_ordering_enabled"]
    search_fields = ["business_name", "slug", "phone", "address"]
    prepopulated_fields = {"slug": ("business_name",)}  # was store_slug / store_name
    readonly_fields = ["qr_code", "created_at", "updated_at"]


@admin.register(MenuItem)
class MenuItemAdmin(UnfoldModelAdmin):
    list_display = [
        "name",
        "merchant",
        "category",
        "price",
        "is_available",
        "is_featured",
        "points_per_item",
    ]
    list_filter = ["is_available", "is_featured", "category"]
    search_fields = ["name", "merchant__business_name"]  # was merchant__store_name


@admin.register(MerchantTable)
class MerchantTableAdmin(UnfoldModelAdmin):
    list_display = [
        "name", "merchant", "table_number", "public_token",
        "is_active", "created_at",
    ]
    list_filter = ["is_active", "merchant"]
    search_fields = ["name", "merchant__business_name", "public_token"]
    readonly_fields = ["public_token", "created_at", "updated_at"]