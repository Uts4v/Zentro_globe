from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from .models import Notification


@admin.register(Notification)
class NotificationAdmin(UnfoldModelAdmin):
    list_display = ["user", "title", "notification_type", "is_read", "created_at"]
    list_filter  = ["notification_type", "is_read"]
    search_fields = ["user__email", "title"]