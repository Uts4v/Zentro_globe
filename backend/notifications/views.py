from datetime import timedelta
from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .models import Notification, PushSubscription
from .serializers import NotificationSerializer


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notification_list(request):
    """GET /api/notifications/ — last 7 days only"""
    one_week_ago = timezone.now() - timedelta(days=7)
    notifs = Notification.objects.filter(
        user=request.user,
        created_at__gte=one_week_ago,
    ).order_by("is_read", "-created_at")[:100]
    return Response(NotificationSerializer(notifs, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def unread_count(request):
    """GET /api/notifications/unread-count/"""
    one_week_ago = timezone.now() - timedelta(days=7)
    count = Notification.objects.filter(
        user=request.user,
        is_read=False,
        created_at__gte=one_week_ago,
    ).count()
    return Response({"unread_count": count})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def mark_read(request, pk):
    """PATCH /api/notifications/<pk>/read/"""
    try:
        notif = Notification.objects.get(pk=pk, user=request.user)
    except Notification.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)
    notif.is_read = True
    notif.save(update_fields=["is_read"])
    return Response(NotificationSerializer(notif).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_all_read(request):
    """POST /api/notifications/read-all/"""
    Notification.objects.filter(
        user=request.user, is_read=False
    ).update(is_read=True)
    return Response({"status": "ok"})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def clear_all(request):
    """DELETE /api/notifications/clear/ — delete all notifications for user"""
    Notification.objects.filter(user=request.user).delete()
    return Response({"status": "cleared"})


# ── Web Push (PWA) ────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def vapid_public_key(request):
    """GET /api/notifications/vapid-public-key/"""
    return Response({"public_key": getattr(settings, "VAPID_PUBLIC_KEY", "")})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_subscribe(request):
    """POST /api/notifications/subscribe/
    Body: { endpoint, keys: { p256dh, auth } }"""
    endpoint = request.data.get("endpoint") or ""
    keys = request.data.get("keys") or {}
    p256dh = keys.get("p256dh") or ""
    auth = keys.get("auth") or ""

    if not endpoint or not p256dh or not auth:
        return Response(
            {"error": "endpoint, keys.p256dh and keys.auth are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    PushSubscription.objects.update_or_create(
        endpoint=endpoint[:1000],
        defaults={
            "user": request.user,
            "p256dh": p256dh,
            "auth": auth,
            "user_agent": (request.META.get("HTTP_USER_AGENT") or "")[:500],
        },
    )
    return Response({"status": "subscribed"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def push_unsubscribe(request):
    """POST /api/notifications/unsubscribe/  Body: { endpoint }"""
    endpoint = request.data.get("endpoint") or ""
    deleted, _ = PushSubscription.objects.filter(
        user=request.user, endpoint=endpoint
    ).delete()
    return Response({"status": "unsubscribed", "removed": deleted})