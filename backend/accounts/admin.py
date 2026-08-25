"""
accounts/admin.py — register models with Django admin.
"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from .models import User, CustomerProfile, PasswordResetToken
from config.admin import FastAdminMixin


@admin.register(User)
class UserAdmin(FastAdminMixin, BaseUserAdmin, UnfoldModelAdmin):
    list_display = ["email", "username", "role", "is_active", "date_joined"]
    list_filter = ["role", "is_active", "is_staff"]
    search_fields = ["email", "username", "first_name", "last_name"]
    ordering = ["-date_joined"]
    fieldsets = BaseUserAdmin.fieldsets + (
        ("Zentro", {"fields": ("role", "phone", "avatar_url", "supabase_id")}),
    )


@admin.register(CustomerProfile)
class CustomerProfileAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["user", "full_name", "loyalty_points", "tier", "streak_days", "total_orders"]
    list_filter = ["tier"]
    search_fields = ["user__email", "full_name"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["user", "created_at", "used"]
    list_filter = ["used"]
    readonly_fields = ["token", "created_at"]
