"""
orders/admin.py
"""

from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin, TabularInline as UnfoldTabularInline
from .models import Order, OrderItem


class OrderItemInline(UnfoldTabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ["subtotal"]


@admin.register(Order)
class OrderAdmin(UnfoldModelAdmin):
    list_display   = ["id", "customer", "merchant", "status", "order_type", "fulfillment_type", "table_name_snapshot", "total_amount", "points_earned", "created_at"]
    list_filter    = ["status", "order_type", "fulfillment_type"]
    search_fields  = ["customer__full_name", "merchant__business_name", "table_name_snapshot"]
    readonly_fields = ["created_at", "updated_at"]
    inlines        = [OrderItemInline]
    date_hierarchy = "created_at"


@admin.register(OrderItem)
class OrderItemAdmin(UnfoldModelAdmin):
    list_display  = ["id", "order", "name", "quantity", "price", "subtotal"]
    search_fields = ["name", "order__id"]