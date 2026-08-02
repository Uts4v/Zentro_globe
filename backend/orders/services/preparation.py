# orders/services/preparation.py
"""
Preparation-area routing, status transitions, and parent-order synchronization.

All preparation logic lives here — serializers and views delegate to these
functions so business rules are never duplicated.
"""

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone

from orders.models import Order, OrderItem, PreparationArea

logger = logging.getLogger(__name__)


# ── Station resolution ────────────────────────────────────────────────────────


def resolve_preparation_area(*, merchant, menu_item):
    """
    Determine the preparation area for a menu item using the priority chain:
    1. Menu-item explicit assignment
    (Category default — not applicable, category is a CharField)
    3. Merchant default area
    4. First active area as final fallback

    Returns None only when routing is disabled or no areas exist.
    """
    item_area = getattr(menu_item, "preparation_area", None)
    if item_area is not None:
        if item_area.merchant_id != merchant.id:
            logger.warning(
                "Menu item %s has area %s belonging to another merchant",
                menu_item.id, item_area.id,
            )
        elif item_area.is_active:
            return item_area

    default_area = (
        merchant.preparation_areas
        .filter(is_active=True, is_default=True)
        .first()
    )
    if default_area:
        return default_area

    return merchant.preparation_areas.filter(is_active=True).first()


def ensure_fallback_area(merchant):
    """
    Return or create a 'Main Counter' fallback area for the merchant.
    Called when routing is enabled but no default area is configured.
    """
    area, created = PreparationArea.objects.get_or_create(
        merchant=merchant,
        name="Main Counter",
        defaults={"is_default": True, "display_order": 999, "is_active": True},
    )
    if created:
        area.is_default = True
        area.save(update_fields=["is_default"])
    return area


# ── Order-item preparation routing ────────────────────────────────────────────


def apply_preparation_routing_to_item(*, order, order_item, menu_item):
    """
    Snapshot the resolved preparation area onto the order item.
    Does NOT save — the caller controls when the item is saved.
    """
    merchant = order.merchant
    routing_enabled = getattr(merchant, "preparation_routing_enabled", False)
    requires_preparation = getattr(menu_item, "requires_preparation", True)

    order_item.requires_preparation = requires_preparation

    if not routing_enabled or not requires_preparation:
        order_item.preparation_area = None
        order_item.preparation_status = OrderItem.PENDING
        return order_item

    area = resolve_preparation_area(merchant=merchant, menu_item=menu_item)
    if area is None:
        area = ensure_fallback_area(merchant)

    order_item.preparation_area = area
    order_item.preparation_status = OrderItem.PENDING
    return order_item


def prepare_order_items_for_routing(order, order_items_data):
    """
    Given raw order_items_data dicts (with 'menu_item' key containing the
    MenuItem instance), return the same list with preparation fields set.

    Call BEFORE bulk_create or individual creates.
    """
    merchant = order.merchant
    if not getattr(merchant, "preparation_routing_enabled", False):
        return order_items_data

    for item_data in order_items_data:
        menu_item = item_data["menu_item"]
        requires = getattr(menu_item, "requires_preparation", True)
        item_data["requires_preparation"] = requires

        if requires:
            area = resolve_preparation_area(merchant=merchant, menu_item=menu_item)
            item_data["preparation_area"] = area
            item_data["preparation_status"] = OrderItem.PENDING
        else:
            item_data["preparation_area"] = None
            item_data["preparation_status"] = OrderItem.PENDING

    return order_items_data


# ── Preparation status transitions ────────────────────────────────────────────

VALID_AREA_TRANSITIONS = {
    "pending": {"preparing", "cancelled"},
    "preparing": {"ready", "cancelled"},
    "ready": set(),
    "cancelled": set(),
}


def validate_area_status_transition(current_status, target_status):
    """Raise ValueError if the transition is not allowed."""
    allowed = VALID_AREA_TRANSITIONS.get(current_status, set())
    if target_status not in allowed:
        raise ValueError(
            f"Cannot transition from '{current_status}' to '{target_status}'. "
            f"Allowed: {sorted(allowed) or 'none'}"
        )


@transaction.atomic
def update_area_order_status(*, order, preparation_area, staff, target_status):
    """
    Update all active preparation items for one order + one area.
    Returns the updated QuerySet.

    Used by the KDS (Kitchen Display System) when a worker taps
    Start Preparing, Mark Ready, etc.
    """
    items = (
        OrderItem.objects
        .select_for_update()
        .filter(
            order=order,
            preparation_area=preparation_area,
            requires_preparation=True,
        )
        .exclude(preparation_status=OrderItem.CANCELLED)
    )

    if not items.exists():
        raise ValueError(
            "No active preparation items for this order and area."
        )

    current_statuses = set(
        items.values_list("preparation_status", flat=True)
    )

    # Validate that all items can make this transition
    for cs in current_statuses:
        validate_area_status_transition(cs, target_status)

    now = timezone.now()
    update_fields = {"preparation_status": target_status}

    if target_status == "preparing":
        update_fields["preparation_started_at"] = now
    elif target_status == "ready":
        update_fields["preparation_ready_at"] = now

    items.update(**update_fields)

    # Refresh from DB to get updated values
    items = OrderItem.objects.filter(
        order=order,
        preparation_area=preparation_area,
        requires_preparation=True,
    )

    synchronize_parent_order_status(order)

    return items


# ── Parent order status synchronization ───────────────────────────────────────


@transaction.atomic
def synchronize_parent_order_status(order):
    """
    Calculate and apply the parent order status from its preparation items.

    Rules:
    - If no required preparation items exist → no change
    - If ALL required active items are ready → order = ready
    - If ANY required item is preparing/ready → order = preparing
    - Otherwise → order = pending (stay pending until someone starts)
    """
    required_items = (
        order.items
        .filter(requires_preparation=True)
        .exclude(preparation_status=OrderItem.CANCELLED)
    )

    if not required_items.exists():
        return order

    statuses = list(
        required_items.values_list("preparation_status", flat=True)
    )

    if all(s == OrderItem.READY for s in statuses):
        target_status = Order.STATUS_READY
    elif any(s in (OrderItem.PREPARING, OrderItem.READY) for s in statuses):
        target_status = Order.STATUS_PREPARING
    else:
        target_status = Order.STATUS_PENDING

    # Only update if the new status is a valid transition or is same
    if order.status != target_status:
        if order.can_transition_to(target_status):
            order.status = target_status
            order.version += 1
            order.save(update_fields=["status", "version", "updated_at"])
        elif order.status == target_status:
            pass  # already correct
        else:
            # For preparation sync, we force-update if going to preparing/ready
            # even if current state doesn't normally allow it (e.g. from confirmed)
            # This handles the case where POS orders start at confirmed
            if target_status in (Order.STATUS_PREPARING, Order.STATUS_READY):
                order.status = target_status
                order.version += 1
                order.save(update_fields=["status", "version", "updated_at"])

    return order


# ── Grouped area orders for KDS display ───────────────────────────────────────


def get_area_orders(merchant, preparation_area, status_filter=None):
    """
    Return orders grouped by (order, area) for the preparation display.
    Each result includes only the items relevant to the given area.

    If preparation_area is the default area, returns ALL items from ALL
    areas (consolidated view for the main counter / pickup point).
    """
    if preparation_area.is_default:
        # Default area shows ALL items across all areas
        item_qs = OrderItem.objects.filter(requires_preparation=True)
    else:
        item_qs = OrderItem.objects.filter(
            preparation_area=preparation_area,
            requires_preparation=True,
        )
    if status_filter:
        item_qs = item_qs.filter(preparation_status=status_filter)
    else:
        # Default: active items (pending or preparing)
        item_qs = item_qs.filter(
            preparation_status__in=[OrderItem.PENDING, OrderItem.PREPARING]
        )

    orders = (
        Order.objects
        .filter(
            merchant=merchant,
            items__in=item_qs,
        )
        .exclude(
            status__in=[Order.STATUS_CANCELLED, Order.STATUS_COMPLETED]
        )
        .distinct()
        .prefetch_related(
            Prefetch(
                "items",
                queryset=item_qs.select_related("menu_item"),
                to_attr="area_items",
            )
        )
        .select_related("table", "customer__user")
        .order_by("created_at")
    )

    return orders


# ── Realtime broadcasting ─────────────────────────────────────────────────────


def broadcast_area_event(*, merchant_id, area_id, event_type, payload):
    """
    Send a preparation event to the merchant + area channel group.
    Called via transaction.on_commit() so we never broadcast partial data.
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    group_name = f"merchant_{merchant_id}_preparation_{area_id}"

    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "preparation.event",
            "event": event_type,
            "data": payload,
        },
    )

    # Also broadcast to merchant-level group (for dashboard counters)
    merchant_group = f"merchant_{merchant_id}_preparation_all"
    async_to_sync(channel_layer.group_send)(
        merchant_group,
        {
            "type": "preparation.event",
            "event": event_type,
            "data": payload,
        },
    )


def broadcast_order_ready(merchant_id, order_id):
    """Broadcast that the entire order is ready."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    group_name = f"merchant_{merchant_id}_preparation_all"
    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "preparation.event",
            "event": "order.ready",
            "data": {"order_id": order_id},
        },
    )
