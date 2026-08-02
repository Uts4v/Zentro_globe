import json
import logging

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .permissions import IsMerchantUser, IsAiEnabled
from .serializers import (
    AIArtifactSerializer, AIRequestSerializer,
    ConversationSerializer, ConversationMessageSerializer,
    ChatInputSerializer, ChatOutputSerializer,
    DailyInsightGenerateSerializer,
)
from ..models import AIArtifact, AIRequest, AIConversation, AIConversationMessage
from ..constants import (
    REQUEST_STATUS_QUEUED, REQUEST_STATUS_RUNNING, REQUEST_STATUS_COMPLETED,
    ARTIFACT_TYPE_DAILY_INSIGHT,
)
from ..use_cases.merchant_assistant import chat_with_merchant_assistant
from ..tasks.generate_report import generate_merchant_report

logger = logging.getLogger(__name__)


def _get_merchant(request):
    try:
        return request.user.merchant_profile
    except Exception:
        return None


@api_view(["GET"])
@permission_classes([IsMerchantUser])
def daily_insight(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    date_param = request.query_params.get("date")
    if date_param:
        from datetime import date
        try:
            report_date = date.fromisoformat(date_param)
        except ValueError:
            return Response({"error": "Invalid date format. Use YYYY-MM-DD."}, status=400)
    else:
        from datetime import date
        report_date = timezone.now().date()

    try:
        artifact = AIArtifact.objects.filter(
            merchant=merchant,
            artifact_type=ARTIFACT_TYPE_DAILY_INSIGHT,
            effective_date=report_date,
        ).latest("created_at")
        return Response(AIArtifactSerializer(artifact).data)
    except AIArtifact.DoesNotExist:
        return Response(
            {"error": "No insight available for this date.", "date": str(report_date)},
            status=404,
        )


@api_view(["POST"])
@permission_classes([IsMerchantUser, IsAiEnabled])
def generate_daily_insight_endpoint(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    ser = DailyInsightGenerateSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=400)

    from datetime import date
    report_date = ser.validated_data.get("date") or timezone.now().date()

    import uuid
    idempotency_key = f"daily-insight:{merchant.id}:{report_date}:1.0.0"

    existing_request = AIRequest.objects.filter(
        idempotency_key=idempotency_key,
    ).exclude(status="failed").first()

    if existing_request:
        return Response({
            "request_id": str(existing_request.id),
            "status": existing_request.status,
        })

    request_obj = AIRequest.objects.create(
        merchant=merchant,
        user=request.user,
        use_case="daily_insights",
        model_alias="merchant-insights",
        status=REQUEST_STATUS_QUEUED,
        idempotency_key=idempotency_key,
        prompt_name="daily_merchant_insights",
        prompt_version="1.0.0",
    )

    generate_merchant_report(
        merchant.id, report_date.isoformat(), str(request_obj.id),
    )

    return Response({
        "request_id": str(request_obj.id),
        "status": "queued",
    }, status=202)


@api_view(["GET"])
@permission_classes([IsMerchantUser])
def request_status(request, request_id):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        req = AIRequest.objects.get(id=request_id, merchant=merchant)
        return Response(AIRequestSerializer(req).data)
    except AIRequest.DoesNotExist:
        return Response({"error": "Request not found."}, status=404)


@api_view(["POST"])
@permission_classes([IsMerchantUser, IsAiEnabled])
def chat(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    ser = ChatInputSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=400)

    conversation_id = ser.validated_data.get("conversation_id")
    message_text = ser.validated_data["message"]

    if conversation_id:
        try:
            conversation = AIConversation.objects.get(
                id=conversation_id, merchant=merchant,
            )
        except AIConversation.DoesNotExist:
            return Response({"error": "Conversation not found."}, status=404)
    else:
        conversation = AIConversation.objects.create(
            merchant=merchant,
            user=request.user,
            title=message_text[:100],
        )

    result = chat_with_merchant_assistant(
        merchant=merchant,
        user=request.user,
        conversation=conversation,
        message_content=message_text,
    )

    return Response({
        "message_id": result["message_id"],
        "content": result["content"],
        "conversation_id": str(conversation.id),
        "request_id": result.get("request_id"),
        "tokens": result.get("tokens"),
    })


@api_view(["GET"])
@permission_classes([IsMerchantUser])
def conversation_list(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    conversations = AIConversation.objects.filter(
        merchant=merchant,
    ).order_by("-updated_at")[:50]

    return Response(ConversationSerializer(conversations, many=True).data)


@api_view(["GET", "DELETE"])
@permission_classes([IsMerchantUser])
def conversation_detail(request, conversation_id):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        conversation = AIConversation.objects.get(
            id=conversation_id, merchant=merchant,
        )
    except AIConversation.DoesNotExist:
        return Response({"error": "Conversation not found."}, status=404)

    if request.method == "DELETE":
        conversation.delete()
        return Response(status=204)

    messages = conversation.messages.order_by("created_at")
    return Response({
        "conversation": ConversationSerializer(conversation).data,
        "messages": ConversationMessageSerializer(messages, many=True).data,
    })
