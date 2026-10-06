"""
loyalty/redemption.py — the rules for handing a reward over at a counter.

A customer fulfils a reward in one of two ways, and both end with staff at a
till saying "yes, that is the code":

  * Punch card: the customer generates a short proof code once their card is
    full. Confirming it creates a zero-value reward order (so the free item
    still reaches the kitchen and the receipt) and starts their next card.
  * Reward: the customer spends their points in the app and gets a redemption
    code. Confirming it marks the redemption delivered.

Both are reachable from the merchant dashboard and from a POS terminal, so the
rules live here and each surface only owns its own permission checks and audit
trail. Anything that redeems money or stock must go through this module rather
than being reimplemented per surface, otherwise the two paths drift.
"""

from django.db import transaction
from django.utils import timezone


class RedemptionError(Exception):
    """A redemption that cannot go ahead, with the message staff should read.

    ``code`` lets a UI distinguish "someone beat you to it" from "that code
    expired" without matching on prose.
    """

    def __init__(self, message, code="invalid", status=404):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status


def _notify_safe(**kwargs):
    """Notifications are a nicety; never fail a redemption because one failed."""
    from pos.views import _notify_safe as pos_notify_safe
    pos_notify_safe(**kwargs)


def confirm_punch_proof(merchant, code):
    """Confirm a customer's completed punch card and start their next one.

    ``code`` is the proof code the customer shows. Returns the payload the
    caller should hand back to the staff member.
    """
    from notifications.models import Notification
    from orders.models import Order, OrderItem
    from orders.pricing import reprice_order

    from .models import CustomerPunchCard, PunchCardEvent

    code = (code or "").strip().upper()
    if not code:
        raise RedemptionError("proof_code is required.", code="missing_code", status=400)

    try:
        card = CustomerPunchCard.objects.select_related(
            "customer__user", "punch_card", "merchant",
        ).get(
            proof_code=code,
            merchant=merchant,
            is_completed=True,
            proof_code_used=False,
        )
    except CustomerPunchCard.DoesNotExist:
        raise RedemptionError(
            "Invalid code or already used.", code="invalid_code", status=404,
        )

    if card.proof_code_expires_at and timezone.now() > card.proof_code_expires_at:
        raise RedemptionError("This code has expired.", code="expired", status=400)

    # Only the mutating half runs atomically. Validation happens outside it so a
    # rejected code leaves no half-applied change behind, and so raising out of
    # the block can never roll back work the caller wanted to keep.
    with transaction.atomic():
        card.proof_code_used = True
        card.save(update_fields=["proof_code_used", "updated_at"])

        # A real order with a zero total: the free product has to reach the
        # kitchen and print on the receipt, but it never earns points, punches
        # or order count (see loyalty.earning), which is what
        # is_promotion_reward means.
        redemption_order = Order.objects.create(
            customer=card.customer,
            merchant=merchant,
            status=Order.STATUS_PENDING,
            order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
            total_amount=0,
            points_earned=0,
            loyalty_spend_rate=0,
            is_reward_order=True,
            notes=f"Punch card reward: {card.punch_card.reward_text}",
            punch_card_redemption=card,
        )
        OrderItem.objects.create(
            order=redemption_order,
            name=f"🎁 {card.punch_card.reward_text} (Punch Card Reward)",
            price=0,
            quantity=1,
            subtotal=0,
            is_promotion_reward=True,
        )
        # Reward orders are free, but priced through the same engine so they
        # carry the same pricing snapshot as every other order.
        reprice_order(redemption_order)

        card.redeem(order=redemption_order)

        new_card, created = CustomerPunchCard.objects.get_or_create(
            customer=card.customer,
            punch_card=card.punch_card,
            merchant=merchant,
            is_completed=False,
            defaults={"current_stamps": 0},
        )
        if created:
            new_card.record_event(
                PunchCardEvent.EVENT_STARTED,
                note="New card started after claiming reward",
            )

    customer_name = card.customer.full_name or card.customer.user.email

    transaction.on_commit(lambda: _notify_safe(
        user=card.customer.user,
        title="Reward confirmed! 🎉",
        message=(
            f"Your '{card.punch_card.reward_text}' has been confirmed at "
            f"{merchant.business_name}. A new stamp card has started!"
        ),
        notification_type=Notification.TYPE_PUNCH_CARD,
        merchant_name=merchant.business_name,
        context_url=f"/customer/merchant/{merchant.slug}",
        merchant_id=merchant.id,
    ))

    return {
        "success": True,
        "customer_name": customer_name,
        "reward_text": card.punch_card.reward_text,
        "order_id": redemption_order.id,
        "new_card_started": True,
    }


def confirm_reward(merchant, code):
    """Confirm a points redemption the customer already paid for in the app."""
    from .models import Redemption

    code = (code or "").strip().upper()
    if not code:
        raise RedemptionError("code is required.", code="missing_code", status=400)

    try:
        redemption = Redemption.objects.select_related(
            "customer", "reward__merchant",
        ).get(
            code=code,
            status=Redemption.STATUS_PENDING,
            reward__merchant=merchant,
        )
    except Redemption.DoesNotExist:
        raise RedemptionError(
            "Invalid code or already used.", code="invalid_code", status=404,
        )

    if redemption.expires_at and timezone.now() > redemption.expires_at:
        # Marking it expired is a deliberate, standalone write: it is not part
        # of a failed redemption and must survive the error below. After this
        # the code is dead for good, so nobody can retry it later.
        with transaction.atomic():
            redemption.status = Redemption.STATUS_EXPIRED
            redemption.save(update_fields=["status"])
        raise RedemptionError("This code has expired.", code="expired", status=400)

    with transaction.atomic():
        redemption.status = Redemption.STATUS_CONFIRMED
        redemption.confirmed_at = timezone.now()
        redemption.save(update_fields=["status", "confirmed_at"])

    return {
        "success": True,
        "customer_name": redemption.customer.full_name or "Customer",
        "reward_name": redemption.reward.name,
        "points_spent": redemption.points_spent,
        "code": redemption.code,
    }