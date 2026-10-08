"""
pos/order_edit.py — changes to an order after it has been sent.

  * Free items given by staff: a merchant setting turns the feature on, the
    employee's role must allow it (``items.free``) and, when the merchant set
    one, the free-item PIN must be entered. Every free item is written to the
    audit log with the employee who gave it.
  * Reducing or removing an item on an open, unpaid order. The bill is
    re-priced by the pricing engine (tax, charges, discount) and linked stock
    for the removed units is put back.

Adding items stays where it was (orders.views.add_items_to_order), because
new items need a kitchen ticket.
"""

from decimal import Decimal

from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from inventory.order_stock import (
    safe_restore_stock_for_order,
    safe_restore_stock_for_reduced_line,
)
from orders.models import Order, OrderItem

from . import rbac
from .models import PosAuditLog, ShiftWorker
from .permissions import IsMerchantUser, IsPosEnabled

PIN_MIN, PIN_MAX = 4, 8
PIN_MAX_ATTEMPTS = 5
PIN_LOCK_SECONDS = 10 * 60

# Orders whose lines are a reward being handed over, not a normal sale.
_REWARD_ORDER_TYPES = (Order.ORDER_TYPE_PUNCH_REDEMPTION, Order.ORDER_TYPE_REWARD_REDEMPTION)


def _error(message, code, http=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({"error": message, "code": code, **extra}, status=http)


# ── Free items ───────────────────────────────────────────────────────────────

def _attempt_key(merchant) -> str:
    return f"free-item-pin-attempts:{merchant.id}"


def check_free_item_pin(merchant, pin):
    """None when the PIN is right (or none is set), else an error Response."""
    if not merchant.free_item_pin_set:
        return None
    key = _attempt_key(merchant)
    if (cache.get(key) or 0) >= PIN_MAX_ATTEMPTS:
        return _error(
            "Too many wrong PIN attempts. Try again in a few minutes.",
            "free_item_pin_locked", status.HTTP_429_TOO_MANY_REQUESTS,
        )
    if not pin:
        return _error("Enter the free-item PIN.", "free_item_pin_required", status.HTTP_403_FORBIDDEN)
    if not merchant.check_free_item_pin(str(pin)):
        cache.set(key, (cache.get(key) or 0) + 1, PIN_LOCK_SECONDS)
        return _error("Wrong free-item PIN.", "free_item_pin_invalid", status.HTTP_403_FORBIDDEN)
    cache.delete(key)
    return None


def authorize_free_items(request, merchant, worker, pin):
    """
    May this request give something away free? Returns None when allowed,
    otherwise the error Response to send back.
    """
    if not merchant.free_items_enabled:
        return _error(
            "Free items are turned off for this business.",
            "free_items_disabled", status.HTTP_403_FORBIDDEN,
        )
    if worker is not None and not rbac.worker_can(worker, "items.free"):
        return _error(
            "You don't have permission to give free items. Ask a manager.",
            "no_permission", status.HTTP_403_FORBIDDEN, required_permission="items.free",
        )
    return check_free_item_pin(merchant, pin)


def audit_free_items(merchant, order, items, *, worker=None, user=None, whole_order=False):
    """One audit row per order naming the free items and who gave them."""
    free = [i for i in items if whole_order or getattr(i, "is_complimentary", False)]
    if not free:
        return
    PosAuditLog.objects.create(
        merchant=merchant,
        worker=worker,
        user=user if getattr(user, "is_authenticated", False) else None,
        action=PosAuditLog.ACTION_FREE_ITEM,
        entity_type="order",
        entity_id=str(order.id),
        metadata={
            "order_id": str(order.id),
            "given_by": worker.display_name if worker else "Owner",
            "whole_order": whole_order,
            "items": [
                {
                    "name": i.name,
                    "quantity": i.quantity,
                    "value": str(getattr(i, "complimentary_value", 0) or 0),
                }
                for i in free
            ],
            "value": str(sum((Decimal(str(getattr(i, "complimentary_value", 0) or 0)) for i in free), Decimal("0"))),
        },
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def authorize_free_item(request):
    """
    POST /api/pos/free-item/authorize/ { worker_id?, pin? }

    Lets the till check, before an item is marked free, that free items are
    switched on, this employee may give them and the PIN is right. The order
    itself is checked again when it is created.
    """
    merchant = getattr(request.user, "merchant_profile", None)
    worker = None
    if request.data.get("worker_id"):
        try:
            worker = ShiftWorker.objects.get(
                id=request.data.get("worker_id"), merchant=merchant, is_active=True,
            )
        except (ShiftWorker.DoesNotExist, ValueError, DjangoValidationError):
            return _error("Worker not found.", "not_found", status.HTTP_404_NOT_FOUND)
    if worker is None:
        worker = rbac.request_worker(request, merchant)
    refused = authorize_free_items(request, merchant, worker, request.data.get("pin"))
    if refused is not None:
        return refused
    return Response({"allowed": True, "pin_required": merchant.free_item_pin_set})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def set_free_item_pin(request):
    """
    POST /api/pos/settings/free-item-pin/
      { pin: "1234" | "" , current_pin?, account_password? }

    Sets, changes or removes (empty ``pin``) the PIN staff must enter to give a
    free item. Changing or removing an existing PIN needs the current PIN or
    the account password, so a cashier at the till cannot quietly replace it.
    """
    merchant = getattr(request.user, "merchant_profile", None)
    if merchant is None:
        return _error("Merchant not found.", "not_found", status.HTTP_404_NOT_FOUND)

    pin = str(request.data.get("pin") or "").strip()
    if pin and (not pin.isdigit() or not (PIN_MIN <= len(pin) <= PIN_MAX)):
        return _error(f"The PIN must be {PIN_MIN} to {PIN_MAX} digits.", "invalid_pin")

    if merchant.free_item_pin_set:
        current = str(request.data.get("current_pin") or "")
        password = str(request.data.get("account_password") or "")
        key = _attempt_key(merchant)
        if (cache.get(key) or 0) >= PIN_MAX_ATTEMPTS:
            return _error(
                "Too many wrong attempts. Try again in a few minutes.",
                "free_item_pin_locked", status.HTTP_429_TOO_MANY_REQUESTS,
            )
        proven = (current and merchant.check_free_item_pin(current)) or (
            password and request.user.has_usable_password() and request.user.check_password(password)
        )
        if not proven:
            cache.set(key, (cache.get(key) or 0) + 1, PIN_LOCK_SECONDS)
            return _error(
                "Enter the current PIN or your account password to change it.",
                "current_pin_required", status.HTTP_403_FORBIDDEN,
            )
        cache.delete(key)

    merchant.set_free_item_pin(pin)
    merchant.save(update_fields=["free_item_pin_hash", "updated_at"])
    PosAuditLog.objects.create(
        merchant=merchant,
        worker=rbac.request_worker(request, merchant),
        user=request.user,
        action=PosAuditLog.ACTION_SETTINGS_UPDATE,
        entity_type="merchant",
        entity_id=str(merchant.id),
        metadata={"setting": "free_item_pin", "change": "set" if pin else "removed"},
    )
    return Response({"free_item_pin_set": merchant.free_item_pin_set})


# ── Reduce / remove an item on an open order ─────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def update_order_item(request):
    """
    POST /api/pos/order/item/update/
      { order_id: <uuid>, item_id, quantity, worker_id?, reason? }

    Lowers an item's quantity on an open, unpaid order (0 removes the line).
    Re-prices the whole bill and puts linked stock back for the removed units.
    """
    from orders.pricing import PricingError, reprice_order
    from orders.serializers import OrderSerializer

    merchant = getattr(request.user, "merchant_profile", None)
    data = request.data

    try:
        order = Order.objects.select_for_update(of=("self",)).get(
            uuid=data.get("order_id"), merchant=merchant,
        )
    except (Order.DoesNotExist, ValueError, DjangoValidationError):
        return _error("Order not found.", "not_found", status.HTTP_404_NOT_FOUND)

    worker = None
    if data.get("worker_id"):
        try:
            worker = ShiftWorker.objects.get(
                id=data.get("worker_id"), merchant=merchant, is_active=True,
            )
        except (ShiftWorker.DoesNotExist, ValueError, DjangoValidationError):
            return _error("Worker not found.", "not_found", status.HTTP_404_NOT_FOUND)
    if worker is None:
        worker = getattr(request, "worker", None) or rbac.request_worker(request, merchant)

    try:
        new_quantity = int(data.get("quantity"))
    except (TypeError, ValueError):
        return _error("Enter the new quantity.", "invalid_quantity")
    if new_quantity < 0:
        return _error("Quantity cannot be negative.", "invalid_quantity")

    needed = "orders.cancel" if new_quantity == 0 else "orders.edit"
    if worker is not None and not rbac.worker_can(worker, needed):
        return _error(
            "You don't have permission to do this. Ask a manager.",
            "no_permission", status.HTTP_403_FORBIDDEN, required_permission=needed,
        )

    if order.status in (Order.STATUS_COMPLETED, Order.STATUS_CANCELLED) or order.pricing_locked_at:
        return _error("This order is closed and can no longer be changed.", "order_closed")
    if order.payment_status in ("paid", "partially_paid", "refunded"):
        return _error(
            "This order has already been paid. Use a refund instead.",
            "order_paid", payment_status=order.payment_status,
        )
    if order.order_type in _REWARD_ORDER_TYPES:
        return _error("Reward orders cannot be changed.", "reward_order")

    try:
        item = order.items.select_for_update().get(pk=data.get("item_id"))
    except (OrderItem.DoesNotExist, ValueError, TypeError):
        return _error("Item not found on this order.", "not_found", status.HTTP_404_NOT_FOUND)

    if item.is_promotion_reward:
        return _error("This item came from an offer. Remove the offer to change it.", "offer_item")
    old_quantity = item.quantity
    if new_quantity == old_quantity:
        return Response(OrderSerializer(order, context={"request": request}).data)
    if new_quantity > old_quantity:
        return _error(
            "To add more, use Add Items so the kitchen gets a ticket.", "use_add_items",
        )
    if new_quantity == 0 and order.items.count() <= 1:
        return _error(
            "This is the only item. Cancel the order instead.", "last_item",
        )

    old_goods = sum((i.subtotal for i in order.items.all()), Decimal("0"))
    item_name = item.name

    if new_quantity == 0:
        safe_restore_stock_for_order(order, lines=[item], performed_by=request.user)
        removed_subtotal = item.subtotal
        item.delete()
    else:
        safe_restore_stock_for_reduced_line(
            order, item, old_quantity, new_quantity, performed_by=request.user,
        )
        removed_subtotal = item.price * (old_quantity - new_quantity)
        if item.is_complimentary and old_quantity:
            item.complimentary_value = (
                item.complimentary_value * new_quantity / old_quantity
            ).quantize(Decimal("0.01"))
        item.quantity = new_quantity
        item.subtotal = item.price * new_quantity
        item.save(update_fields=["quantity", "subtotal", "complimentary_value"])

    if hasattr(order, "_prefetched_objects_cache"):
        order._prefetched_objects_cache.pop("items", None)

    try:
        pricing = reprice_order(order)
    except PricingError as exc:
        transaction.set_rollback(True)
        return _error(str(exc), exc.code or "pricing_error")

    # Keep the points shown before completion honest; the award at completion
    # is recalculated from the final lines anyway.
    if old_goods > 0 and order.points_earned:
        new_goods = max(old_goods - removed_subtotal, Decimal("0"))
        order.points_earned = int(order.points_earned * new_goods / old_goods)
    order.version += 1
    order.save(update_fields=["points_earned", "version", "updated_at"])

    PosAuditLog.objects.create(
        merchant=merchant,
        worker=worker,
        user=request.user,
        action=PosAuditLog.ACTION_ORDER_ITEM_UPDATE,
        entity_type="order",
        entity_id=str(order.id),
        metadata={
            "order_id": str(order.id),
            "item": item_name,
            "from_quantity": old_quantity,
            "to_quantity": new_quantity,
            "removed": new_quantity == 0,
            "reason": str(data.get("reason") or "")[:200],
            "new_total": str(pricing.grand_total),
            "changed_by": worker.display_name if worker else "Owner",
        },
    )

    order.refresh_from_db()
    payload = OrderSerializer(order, context={"request": request}).data
    payload["pricing_messages"] = pricing.messages
    return Response(payload)
