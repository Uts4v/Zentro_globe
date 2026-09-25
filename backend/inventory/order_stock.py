"""
inventory/order_stock.py

Order-driven stock consumption for menu items linked to inventory through
`MenuItemStockLink`.

Rules:
  * Only dine-in orders consume stock, and only once confirmed (POS orders
    are created confirmed; table-QR orders when they are accepted).
  * Each (order line, inventory item) pair is deducted at most once. The
    movement's idempotency key is derived from the order line, so retries,
    duplicate submissions and repeated status changes never double-deduct.
  * Selling never fails because of stock. When on-hand is short, only what
    is on hand is deducted (balances cannot go negative) and the shortfall
    is written on the movement note.
  * Cancelling the order puts back exactly what it consumed.
"""

import logging
from collections import defaultdict
from decimal import Decimal

from django.db import transaction

from .models import (
    InventoryBalance,
    InventoryLocation,
    InventoryMovement,
    MenuItemStockLink,
    MovementSource,
    MovementType,
)
from .services import InventoryMovementService

logger = logging.getLogger(__name__)

ZERO = Decimal("0")


def order_consumes_stock(order) -> bool:
    from orders.models import Order

    return order.fulfillment_type == Order.FULFILLMENT_DINE_IN


def _sale_key(line_id, inventory_item_id) -> str:
    return f"order-stock:{line_id}:{inventory_item_id}"


def _user_or_none(user):
    return user if getattr(user, "is_authenticated", False) else None


def _stock_location(merchant, item):
    """Where to take stock from: the item's usual location, else wherever it is held."""
    if item.default_location_id:
        return item.default_location
    balance = (
        InventoryBalance.objects.filter(inventory_item=item, on_hand__gt=0)
        .select_related("location")
        .order_by("-on_hand")
        .first()
    )
    if balance:
        return balance.location
    return (
        InventoryLocation.objects.filter(merchant=merchant, is_active=True)
        .order_by("-is_default", "display_order", "id")
        .first()
    )


def _consume(order, line, link, performed_by):
    merchant = order.merchant
    item = link.inventory_item
    key = _sale_key(line.id, item.id)
    if InventoryMovement.objects.filter(merchant=merchant, idempotency_key=key).exists():
        return None

    location = _stock_location(merchant, item)
    if location is None:
        logger.warning("No stock location for %s; order %s not deducted.", item.name, order.pk)
        return None

    needed = (link.quantity_per_unit * line.quantity).quantize(Decimal("0.000001"))
    with transaction.atomic():
        # Hold the balance lock from the read through the write so the clamp
        # below can't race another order taking the same stock.
        balance = (
            InventoryBalance.objects.select_for_update()
            .filter(inventory_item=item, location=location)
            .first()
        )
        on_hand = balance.on_hand if balance else ZERO
        deduct = min(needed, on_hand)
        if deduct <= 0:
            logger.warning(
                "No %s on hand at %s for order %s; nothing deducted.",
                item.name, location.name, order.pk,
            )
            return None
        note = ""
        if deduct < needed:
            note = f"Short by {needed - deduct} (needed {needed}, on hand {on_hand})."
        return InventoryMovementService.apply_change(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_change=-deduct,
            movement_type=MovementType.SALE,
            source_type=MovementSource.ORDER,
            source_id=order.id,
            reason=f"Order #{order.id}: {line.quantity}x {line.name}",
            note=note,
            performed_by=performed_by,
            idempotency_key=key,
            prevent_negative=True,
        )


def deduct_stock_for_order(order, lines=None, performed_by=None):
    """Consume linked stock for `lines` (default: every line) of a dine-in order.

    Safe to call repeatedly; returns the movements created by this call.
    """
    if not order_consumes_stock(order):
        return []

    from orders.models import OrderItem

    if lines is None:
        lines = order.items.all()
    lines = [
        line for line in lines
        if line.menu_item_id and line.preparation_status != OrderItem.CANCELLED
    ]
    if not lines:
        return []

    links_by_menu_item = defaultdict(list)
    links = MenuItemStockLink.objects.filter(
        merchant=order.merchant,
        menu_item_id__in={line.menu_item_id for line in lines},
        inventory_item__active=True,
        inventory_item__archived=False,
    ).select_related("inventory_item__default_location")
    for link in links:
        links_by_menu_item[link.menu_item_id].append(link)

    performed_by = _user_or_none(performed_by)
    created = []
    for line in lines:
        for link in links_by_menu_item.get(line.menu_item_id, []):
            movement = _consume(order, line, link, performed_by)
            if movement is not None:
                created.append(movement)
    return created


def restore_stock_for_order(order, performed_by=None):
    """Put back everything a cancelled order consumed. Safe to call repeatedly."""
    performed_by = _user_or_none(performed_by)
    sales = InventoryMovement.objects.filter(
        merchant=order.merchant,
        movement_type=MovementType.SALE,
        source_type=MovementSource.ORDER,
        source_id=str(order.id),
    ).select_related("location", "inventory_item")

    restored = []
    for sale in sales:
        # Skip sales already undone, whether by an earlier cancel or by a
        # manual reversal in the movement ledger.
        if sale.reversals.exists():
            continue
        restored.append(InventoryMovementService.apply_change(
            merchant=order.merchant,
            location=sale.location,
            inventory_item=sale.inventory_item,
            quantity_change=-sale.quantity_change,
            movement_type=MovementType.REVERSAL,
            source_type=MovementSource.ORDER,
            source_id=order.id,
            reason=f"Order #{order.id} cancelled",
            note=f"Restoring movement #{sale.id}",
            performed_by=performed_by,
            reversal_of=sale,
            idempotency_key=f"order-stock-restore:{sale.id}",
        ))
    return restored


def safe_deduct_stock_for_order(order, lines=None, performed_by=None):
    """deduct_stock_for_order, but a stock failure never blocks the order flow."""
    try:
        with transaction.atomic():
            return deduct_stock_for_order(order, lines=lines, performed_by=performed_by)
    except Exception:
        logger.exception("Stock deduction failed for order %s (order flow continues)", order.pk)
        return []


def safe_restore_stock_for_order(order, performed_by=None):
    """restore_stock_for_order, but a stock failure never blocks the order flow."""
    try:
        with transaction.atomic():
            return restore_stock_for_order(order, performed_by=performed_by)
    except Exception:
        logger.exception("Stock restore failed for order %s (order flow continues)", order.pk)
        return []
