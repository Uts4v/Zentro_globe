"""
Order lifecycle → voucher lifecycle.

Every path that settles an order (customer confirm/complete, POS payment,
cancel, refund) ends in ``Order.save()``, which sets ``pricing_locked_at``.
Hooking here means no view has to remember to redeem or release a voucher.
"""

from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver

from orders.models import Order


@receiver(post_save, sender=Order, dispatch_uid="offers_finalize_on_order_settled")
def _finalize_on_settled(sender, instance, created, **kwargs):
    if created or instance.pricing_locked_at is None:
        return
    from .engine import finalize_order

    finalize_order(instance)


@receiver(pre_delete, sender=Order, dispatch_uid="offers_release_on_order_delete")
def _release_on_delete(sender, instance, **kwargs):
    from .engine import release_claim
    from .models import VoucherClaim

    for claim_id in VoucherClaim.objects.filter(
        reserved_order=instance, status=VoucherClaim.STATUS_RESERVED,
    ).values_list("pk", flat=True):
        release_claim(claim_id, order=instance, reprice=False)
