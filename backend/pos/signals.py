from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from orders.models import Order

from .realtime import broadcast_pos_order_changed


def _schedule_order_broadcast(instance, action):
    merchant_id = instance.merchant_id
    if not merchant_id:
        return

    payload = {
        "merchant_id": merchant_id,
        "order_id": instance.id,
        "order_uuid": str(instance.uuid),
        "status": instance.status,
        "table_id": instance.table_id,
        "version": instance.version,
        "action": action,
    }

    transaction.on_commit(lambda: broadcast_pos_order_changed(**payload))


@receiver(post_save, sender=Order, dispatch_uid="pos_broadcast_order_saved")
def broadcast_order_saved(sender, instance, created, **kwargs):
    _schedule_order_broadcast(instance, "created" if created else "updated")


@receiver(post_delete, sender=Order, dispatch_uid="pos_broadcast_order_deleted")
def broadcast_order_deleted(sender, instance, **kwargs):
    _schedule_order_broadcast(instance, "deleted")
