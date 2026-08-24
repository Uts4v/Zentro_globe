# notifications/push.py
"""
Web-Push delivery for PWA users.

Reads VAPID credentials from Django settings (env vars):
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

If keys are not configured, pushes are silently skipped so dev
environments without keys keep working.
"""

import json
import logging

from django.conf import settings

from .models import PushSubscription

logger = logging.getLogger(__name__)


def vapid_configured() -> bool:
    return bool(
        getattr(settings, "VAPID_PUBLIC_KEY", "")
        and getattr(settings, "VAPID_PRIVATE_KEY", "")
    )


def send_web_push(user, payload: dict) -> None:
    """Send a JSON push to every subscription of the user. Fail-silent."""
    if not vapid_configured():
        return

    from pywebpush import WebPushException, webpush

    dead = []
    for sub in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code in (404, 410):
                # Subscription expired / gone — remove it
                dead.append(sub.id)
            else:
                logger.warning(
                    "Web push to user %s failed: %s", user.id, exc
                )
        except Exception as exc:  # never break the request flow
            logger.warning("Web push error for user %s: %s", user.id, exc)

    if dead:
        PushSubscription.objects.filter(id__in=dead).delete()
