from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin

from .models import AIRequest, AIArtifact, AIConversation, AIConversationMessage
from config.admin import FastAdminMixin


@admin.register(AIRequest)
class AIRequestAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "use_case", "status", "provider_model", "created_at"]
    list_filter = ["status", "use_case", "provider"]
    search_fields = ["merchant__business_name", "id"]


@admin.register(AIArtifact)
class AIArtifactAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "artifact_type", "effective_date", "status"]
    list_filter = ["artifact_type", "status"]
    search_fields = ["merchant__business_name"]


@admin.register(AIConversation)
class AIConversationAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "title", "status", "created_at"]
    list_filter = ["status"]


@admin.register(AIConversationMessage)
class AIConversationMessageAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "conversation", "role", "created_at"]
    list_filter = ["role"]
