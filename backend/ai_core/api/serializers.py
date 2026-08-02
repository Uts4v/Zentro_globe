from rest_framework import serializers

from ..models import AIArtifact, AIRequest, AIConversation, AIConversationMessage


class AIArtifactSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIArtifact
        fields = [
            "id", "artifact_type", "schema_version", "title",
            "structured_content", "effective_date",
            "prompt_name", "prompt_version", "status",
            "created_at",
        ]


class AIRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIRequest
        fields = [
            "id", "use_case", "model_alias", "provider", "status",
            "input_tokens", "output_tokens", "total_tokens",
            "latency_ms", "error_code", "sanitized_error",
            "created_at", "started_at", "completed_at",
        ]


class ConversationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIConversation
        fields = ["id", "title", "status", "created_at", "updated_at"]


class ConversationMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIConversationMessage
        fields = ["id", "role", "content", "tool_calls", "tool_results",
                   "input_tokens", "output_tokens", "created_at"]


class ChatInputSerializer(serializers.Serializer):
    conversation_id = serializers.CharField(required=False, allow_null=True)
    message = serializers.CharField(max_length=10000)


class ChatOutputSerializer(serializers.Serializer):
    message_id = serializers.UUIDField()
    content = serializers.CharField()
    conversation_id = serializers.UUIDField()
    request_id = serializers.UUIDField()
    tokens = serializers.IntegerField(allow_null=True)


class DailyInsightGenerateSerializer(serializers.Serializer):
    date = serializers.DateField(required=False, default=None)
