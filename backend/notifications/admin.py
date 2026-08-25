from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from .models import Notification
from config.admin import FastAdminMixin


@admin.register(Notification)
class NotificationAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["user", "title", "notification_type", "is_read", "created_at"]
    list_filter  = ["notification_type", "is_read"]
    search_fields = ["user__email", "title"]