# notifications/models.py 
from django.db import models


class Notification(models.Model):
    TYPE_ORDER_UPDATE       = "order_update"
    TYPE_NEW_ORDER          = "new_order"
    TYPE_POINTS_EARNED      = "points_earned"
    TYPE_MISSION_COMPLETE   = "mission_completed"
    TYPE_REWARD_REDEEMED    = "reward_redeemed"
    TYPE_PUNCH_CARD         = "punch_card_completed"
    TYPE_SPECIAL_OFFER      = "special_offer"
    TYPE_TRANSFER_SENT      = "transfer_sent"
    TYPE_TRANSFER_RECEIVED  = "transfer_received"
    TYPE_GENERAL            = "generic"

    TYPE_CHOICES = [
        (TYPE_ORDER_UPDATE,       "Order Update"),
        (TYPE_NEW_ORDER,          "New Order"),
        (TYPE_POINTS_EARNED,      "Points Earned"),
        (TYPE_MISSION_COMPLETE,   "Mission Completed"),
        (TYPE_REWARD_REDEEMED,    "Reward Redeemed"),
        (TYPE_PUNCH_CARD,         "Punch Card Completed"),
        (TYPE_SPECIAL_OFFER,      "Special Offer"),
        (TYPE_TRANSFER_SENT,      "Transfer Sent"),
        (TYPE_TRANSFER_RECEIVED,  "Transfer Received"),
        (TYPE_GENERAL,            "General"),
    ]

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    title            = models.CharField(max_length=255)
    message          = models.TextField(blank=True)
    notification_type = models.CharField(
        max_length=30, choices=TYPE_CHOICES, default=TYPE_GENERAL
    )
    merchant_name = models.CharField(max_length=255, blank=True)
    context_url   = models.CharField(max_length=500, blank=True)

    # Optional FK context for deep-linking
    order_id    = models.IntegerField(null=True, blank=True)
    merchant_id = models.IntegerField(null=True, blank=True)
    reward_id   = models.IntegerField(null=True, blank=True)

    is_read    = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "-created_at"], name="notif_user_created_idx"),
        ]

    def __str__(self):
        return f"{self.user} — {self.title}"


class PushSubscription(models.Model):
    """Web-Push subscription (one per browser/PWA install per user)."""

    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.URLField(max_length=1000, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    user_agent = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "push_subscriptions"

    def __str__(self):
        return f"{self.user} — {self.endpoint[:60]}"