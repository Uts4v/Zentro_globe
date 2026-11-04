"""
pos/table_views.py — live table status and moving a bill to another table.

The POS Tables screen needs a light, frequently-polled view of which tables
are free and which hold an open bill. Moving a bill is deliberately limited to
free destination tables for now: merging two open bills touches pricing,
payments, loyalty and kitchen history, so it is kept as a separate feature.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from merchants.models import MerchantTable
from orders.models import DiningSession, KitchenOrderTicket, Order

from . import rbac
from .models import PosAuditLog, PosDevice, ShiftWorker
from .permissions import IsMerchantUser, IsPosEnabled

OPEN_ORDER_STATUSES = (
    Order.STATUS_PENDING,
    Order.STATUS_CONFIRMED,
    Order.STATUS_PREPARING,
    Order.STATUS_READY,
)


def _error(message, code, http=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({"error": message, "code": code, **extra}, status=http)


def _merchant(request):
    return getattr(request.user, "merchant_profile", None)


def _worker_for(request, merchant, worker_id=None):
    """Resolve the acting employee; returns (worker, error_response)."""
    if worker_id:
        try:
            worker = ShiftWorker.objects.get(
                id=worker_id, merchant=merchant, is_active=True, is_deleted=False,
            )
        except (ShiftWorker.DoesNotExist, ValueError, TypeError, DjangoValidationError):
            return None, _error("Worker not found.", "not_found", status.HTTP_404_NOT_FOUND)
    else:
        worker = getattr(request, "worker", None) or rbac.request_worker(request, merchant)
    return worker, None


def _permission_denied(worker, code):
    if worker is None or rbac.worker_can(worker, code):
        return None
    return _error(
        "You don't have permission to do this. Ask a manager.",
        "no_permission",
        status.HTTP_403_FORBIDDEN,
        required_permission=code,
    )


def _visible_tables(merchant, worker):
    tables = (
        MerchantTable.objects.filter(merchant=merchant, is_active=True)
        .filter(Q(area__isnull=True) | Q(area__is_active=True))
        .select_related("area")
        .order_by("area__display_order", "area__name", "table_number", "id")
    )
    allowed = rbac.allowed_area_ids(worker)
    if allowed is not None:
        tables = tables.filter(area_id__in=allowed)
    return tables


def _bill_summary(order):
    return {
        "id": order.id,
        "uuid": str(order.uuid),
        "order_number": f"#{order.id}",
        "status": order.status,
        "payment_status": order.payment_status,
        "total_amount": str(order.total_amount),
        "item_count": getattr(order, "item_count", 0),
        "opened_at": order.created_at.isoformat(),
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def table_statuses(request):
    """
    GET /api/pos/tables/status/

    Every active table the acting employee may use, with the open bill on it
    (if any). Polled by the POS Tables screen.
    """
    merchant = _merchant(request)
    if merchant is None:
        return _error("Merchant not found.", "not_found", status.HTTP_404_NOT_FOUND)

    worker, refused = _worker_for(request, merchant)
    if refused is not None:
        return refused
    refused = _permission_denied(worker, "orders.view")
    if refused is not None:
        return refused

    tables = list(_visible_tables(merchant, worker))
    table_ids = [table.id for table in tables]

    open_orders = (
        Order.objects.filter(
            merchant=merchant,
            table_id__in=table_ids,
            status__in=OPEN_ORDER_STATUSES,
        )
        .annotate(item_count=Count("items"))
        .order_by("-created_at", "-id")
    )

    latest_by_table = {}
    counts_by_table = {}
    for order in open_orders:
        counts_by_table[order.table_id] = counts_by_table.get(order.table_id, 0) + 1
        current = latest_by_table.get(order.table_id)
        if current is None or (order.is_bill and not current.is_bill):
            latest_by_table[order.table_id] = order

    payload = []
    for table in tables:
        bill = latest_by_table.get(table.id)
        payload.append({
            "id": table.id,
            "name": table.name,
            "table_number": table.table_number,
            "area_id": table.area_id,
            "area_name": table.area.name if table.area_id else "",
            "seats": table.seats,
            "is_occupied": bill is not None,
            "open_bill_count": counts_by_table.get(table.id, 0),
            "bill": _bill_summary(bill) if bill is not None else None,
        })

    return Response({"tables": payload})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def move_order_table(request):
    """
    POST /api/pos/order/table/move/
      { order_id: <uuid|id|client_mutation_id>, table_id, worker_id?, device_id? }

    Moves an open dine-in bill to a free table. The old table becomes empty.
    An occupied destination is refused until bill merging is implemented.
    """
    merchant = _merchant(request)
    if merchant is None:
        return _error("Merchant not found.", "not_found", status.HTTP_404_NOT_FOUND)

    data = request.data
    order_ref = data.get("order_id")
    table_ref = data.get("table_id")
    if order_ref in (None, "") or table_ref in (None, ""):
        return _error("order_id and table_id are required.", "missing_fields")

    worker, refused = _worker_for(request, merchant, data.get("worker_id"))
    if refused is not None:
        return refused
    refused = _permission_denied(worker, "orders.edit")
    if refused is not None:
        return refused

    device = None
    if data.get("device_id"):
        try:
            device = PosDevice.objects.get(
                id=data.get("device_id"), merchant=merchant, is_active=True,
            )
        except (PosDevice.DoesNotExist, ValueError, TypeError, DjangoValidationError):
            return _error("Device not found.", "not_found", status.HTTP_404_NOT_FOUND)

    try:
        order = (
            Order.objects.select_for_update()
            .filter(merchant=merchant)
            .filter(Q(uuid=order_ref) | Q(client_mutation_id=str(order_ref)))
            .first()
        )
    except (DjangoValidationError, ValueError, TypeError):
        order = None
    if order is None and str(order_ref).isdigit():
        order = (
            Order.objects.select_for_update()
            .filter(merchant=merchant, id=int(order_ref))
            .first()
        )
    if order is None:
        return _error("Order not found.", "not_found", status.HTTP_404_NOT_FOUND)

    if not order.is_bill:
        return _error(
            "This order is part of another bill and cannot be moved on its own.",
            "not_a_bill",
        )
    if order.fulfillment_type != Order.FULFILLMENT_DINE_IN:
        return _error("Only dine-in orders can be moved to a table.", "not_dine_in")
    if order.status not in OPEN_ORDER_STATUSES or order.pricing_locked_at:
        return _error("This order is closed and can no longer be moved.", "order_closed")
    if order.payment_status in ("paid", "refunded"):
        return _error(
            "This order has already been settled and can no longer be moved.",
            "order_paid",
            payment_status=order.payment_status,
        )
    if order.table_id is None:
        return _error("This order is not attached to a table.", "no_table")

    try:
        table_id = int(table_ref)
    except (TypeError, ValueError):
        return _error("Choose a valid table.", "invalid_table")

    try:
        destination = (
            MerchantTable.objects.select_for_update(of=("self",))
            .select_related("area")
            .get(id=table_id, merchant=merchant, is_active=True)
        )
    except MerchantTable.DoesNotExist:
        return _error("Table not found.", "not_found", status.HTTP_404_NOT_FOUND)

    if worker is not None:
        if (
            not rbac.worker_can_use_table(worker, order.table)
            or not rbac.worker_can_use_table(worker, destination)
        ):
            return _error(
                "This table is not in your area.", "area_restricted",
                status.HTTP_403_FORBIDDEN,
            )

    if destination.id == order.table_id:
        from orders.serializers import OrderSerializer

        return Response(OrderSerializer(order, context={"request": request}).data)

    # The old table must be left completely empty, so no other open order may
    # share it with the bill being moved.
    if (
        Order.objects.filter(
            merchant=merchant,
            table_id=order.table_id,
            status__in=OPEN_ORDER_STATUSES,
        )
        .exclude(pk=order.pk)
        .exists()
    ):
        return _error(
            "This table has more than one open bill. Close the others first.",
            "multiple_open_bills",
        )

    destination_occupied = (
        Order.objects.filter(
            merchant=merchant,
            table_id=destination.id,
            status__in=OPEN_ORDER_STATUSES,
        ).exists()
        or DiningSession.objects.filter(
            merchant=merchant,
            table=destination,
            status=DiningSession.STATUS_ACTIVE,
        ).exists()
    )
    if destination_occupied:
        return _error(
            "That table has an open bill. Move or settle it first.",
            "table_occupied",
            status.HTTP_409_CONFLICT,
        )

    old_table = order.table
    old_table_id = old_table.id
    old_table_name = old_table.name
    old_table_number = old_table.table_number

    order.table = destination
    order.table_name_snapshot = destination.name
    order.table_number_snapshot = destination.table_number
    order.version += 1
    order.save(update_fields=[
        "table", "table_name_snapshot", "table_number_snapshot", "version", "updated_at",
    ])

    DiningSession.objects.filter(
        merchant=merchant,
        bill_order=order,
        status=DiningSession.STATUS_ACTIVE,
    ).update(table=destination)

    KitchenOrderTicket.objects.filter(order=order).update(
        table_name_snapshot=destination.name,
        table_number_snapshot=destination.table_number,
    )

    PosAuditLog.objects.create(
        merchant=merchant,
        worker=worker,
        user=request.user if getattr(request.user, "is_authenticated", False) else None,
        action=PosAuditLog.ACTION_TABLE_MOVE,
        entity_type="order",
        entity_id=str(order.id),
        metadata={
            "order_id": str(order.id),
            "order_uuid": str(order.uuid),
            "from_table_id": old_table_id,
            "from_table_name": old_table_name,
            "from_table_number": old_table_number,
            "to_table_id": destination.id,
            "to_table_name": destination.name,
            "to_table_number": destination.table_number,
            "merged": False,
            "changed_by": worker.display_name if worker else "Owner",
        },
    )

    from orders.serializers import OrderSerializer

    return Response(OrderSerializer(order, context={"request": request}).data)
