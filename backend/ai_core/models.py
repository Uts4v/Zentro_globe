import uuid
from django.db import models
from django.conf import settings

from .constants import (
    REQUEST_STATUS_CHOICES, REQUEST_STATUS_QUEUED,
    ARTIFACT_TYPE_DAILY_INSIGHT,
)


class AIRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="ai_requests",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    use_case = models.CharField(max_length=50, db_index=True)
    model_alias = models.CharField(max_length=50)
    provider = models.CharField(max_length=50)
    provider_model = models.CharField(max_length=100, blank=True)
    prompt_name = models.CharField(max_length=100, blank=True)
    prompt_version = models.CharField(max_length=20, blank=True)
    capability = models.CharField(max_length=50, blank=True)
    status = models.CharField(
        max_length=20, choices=REQUEST_STATUS_CHOICES,
        default=REQUEST_STATUS_QUEUED, db_index=True,
    )
    idempotency_key = models.CharField(max_length=255, unique=True, null=True, blank=True)
    input_tokens = models.IntegerField(null=True, blank=True)
    output_tokens = models.IntegerField(null=True, blank=True)
    total_tokens = models.IntegerField(null=True, blank=True)
    latency_ms = models.IntegerField(null=True, blank=True)
    estimated_cost = models.DecimalField(max_digits=10, decimal_places=6, null=True, blank=True)
    retry_count = models.IntegerField(default=0)
    used_fallback = models.BooleanField(default=False)
    error_code = models.CharField(max_length=50, blank=True)
    sanitized_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_requests"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "created_at"]),
            models.Index(fields=["merchant", "use_case", "created_at"]),
            models.Index(fields=["status", "created_at"]),
        ]

    def __str__(self):
        return f"AIRequest {self.id} [{self.use_case}] {self.status}"


class AIArtifact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="ai_artifacts",
    )
    request = models.ForeignKey(
        AIRequest, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="artifacts",
    )
    artifact_type = models.CharField(max_length=50, db_index=True)
    schema_version = models.CharField(max_length=20, blank=True)
    title = models.CharField(max_length=255, blank=True)
    structured_content = models.JSONField(default=dict)
    effective_date = models.DateField(null=True, blank=True, db_index=True)
    prompt_name = models.CharField(max_length=100, blank=True)
    prompt_version = models.CharField(max_length=20, blank=True)
    context_schema_version = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=20, default="completed")
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_artifacts"
        indexes = [
            models.Index(fields=["merchant", "artifact_type", "effective_date"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "artifact_type", "effective_date", "schema_version", "prompt_version"],
                name="unique_artifact_per_merchant",
            ),
        ]

    def __str__(self):
        return f"AIArtifact {self.artifact_type} {self.effective_date}"


class AIConversation(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_ARCHIVED = "archived"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="ai_conversations",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_conversations",
    )
    title = models.CharField(max_length=255, blank=True)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "ai_conversations"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["merchant", "updated_at"]),
        ]

    def __str__(self):
        return self.title or f"Conversation {self.id}"


class AIConversationMessage(models.Model):
    ROLE_USER = "user"
    ROLE_ASSISTANT = "assistant"
    ROLE_SYSTEM = "system"
    ROLE_TOOL = "tool"

    ROLE_CHOICES = [
        (ROLE_USER, "User"),
        (ROLE_ASSISTANT, "Assistant"),
        (ROLE_SYSTEM, "System"),
        (ROLE_TOOL, "Tool"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        AIConversation, on_delete=models.CASCADE,
        related_name="messages",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    content = models.TextField(blank=True)
    tool_calls = models.JSONField(null=True, blank=True)
    tool_results = models.JSONField(null=True, blank=True)
    provider_message_id = models.CharField(max_length=255, blank=True)
    input_tokens = models.IntegerField(null=True, blank=True)
    output_tokens = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    ai_request = models.ForeignKey(
        AIRequest, on_delete=models.SET_NULL,
        null=True, blank=True,
    )

    class Meta:
        db_table = "ai_conversation_messages"
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.role} @ {self.created_at}"
