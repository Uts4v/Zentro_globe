# notifications/services.py
"""
Central place to send a notification: persists it (so /api/notifications/
and unread badges work) AND pushes it live over the WebSocket if the
recipient is currently connected.
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Notification


def send_notification(
    *,
    user,
    title: str,
    message: str = "",
    notification_type: str = Notification.TYPE_GENERAL,
    merchant_name: str = "",
    context_url: str = "",
    order_id: int | None = None,
    merchant_id: int | None = None,
    reward_id: int | None = None,
) -> Notification:
    notification = Notification.objects.create(
        user=user,
        title=title,
        message=message,
        notification_type=notification_type,
        merchant_name=merchant_name,
        context_url=context_url,
        order_id=order_id,
        merchant_id=merchant_id,
        reward_id=reward_id,
    )

    payload = {
        "id": str(notification.id),
        "title": notification.title,
        "message": notification.message,
        "notification_type": notification.notification_type,
        "merchant_name": notification.merchant_name,
        "context_url": notification.context_url,
        "order_id": notification.order_id,
        "merchant_id": notification.merchant_id,
        "reward_id": notification.reward_id,
        "is_read": notification.is_read,
        "created_at": notification.created_at.isoformat(),
    }

    channel_layer = get_channel_layer()
    if channel_layer is not None:
        async_to_sync(channel_layer.group_send)(
            f"user_{user.id}",
            {
                "type": "notification.message",  # routes to NotificationConsumer.notification_message
                "data": payload,
            },
        )

    # Web-Push for PWA/installed-app users (no-op if VAPID not configured)
    from .push import send_web_push

    try:
        send_web_push(user, payload)
    except Exception:
        pass

    return notification