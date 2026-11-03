import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def pos_group_name(merchant_id):
    return f"merchant_{merchant_id}_pos"


def broadcast_pos_order_changed(
    *,
    merchant_id,
    order_id,
    order_uuid,
    status="",
    table_id=None,
    version=None,
    action="updated",
):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    data = {
        "merchant_id": merchant_id,
        "order_id": order_id,
        "order_uuid": order_uuid,
        "status": status,
        "table_id": table_id,
        "version": version,
        "action": action,
    }

    try:
        async_to_sync(channel_layer.group_send)(
            pos_group_name(merchant_id),
            {
                "type": "pos.event",
                "event": "order.changed",
                "data": data,
            },
        )
    except Exception:
        logger.warning(
            "POS realtime broadcast failed for merchant %s order %s",
            merchant_id,
            order_id,
            exc_info=True,
        )
