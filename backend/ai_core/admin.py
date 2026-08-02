from django.contrib import admin

from .models import AIRequest, AIArtifact, AIConversation, AIConversationMessage


@admin.register(AIRequest)
class AIRequestAdmin(admin.ModelAdmin):
    list_display = ["id", "merchant", "use_case", "status", "provider_model", "created_at"]
    list_filter = ["status", "use_case", "provider"]
    search_fields = ["merchant__business_name", "id"]


@admin.register(AIArtifact)
class AIArtifactAdmin(admin.ModelAdmin):
    list_display = ["id", "merchant", "artifact_type", "effective_date", "status"]
    list_filter = ["artifact_type", "status"]
    search_fields = ["merchant__business_name"]


@admin.register(AIConversation)
class AIConversationAdmin(admin.ModelAdmin):
    list_display = ["id", "merchant", "title", "status", "created_at"]
    list_filter = ["status"]


@admin.register(AIConversationMessage)
class AIConversationMessageAdmin(admin.ModelAdmin):
    list_display = ["id", "conversation", "role", "created_at"]
    list_filter = ["role"]
