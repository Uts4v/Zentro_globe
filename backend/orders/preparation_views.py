# orders/preparation_views.py
"""
Preparation-area management and KDS (Kitchen Display System) API views.
"""

import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from merchants.models import MenuItem
from pos.models import PosAuditLog, ShiftWorker, StaffPreparationArea

from .models import Order, OrderItem, PreparationArea
from .serializers import OrderSerializer
from .services.preparation import (
    apply_preparation_routing_to_item,
    broadcast_area_event,
    broadcast_order_ready,
    ensure_fallback_area,
    get_area_orders,
    synchronize_parent_order_status,
    update_area_order_status,
)


logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_merchant(user):
    try:
        return user.merchant_profile
    except Exception:
        return None


def _audit(merchant, action, *, user=None, entity_type="", entity_id="", metadata=None):
    try:
        PosAuditLog.objects.create(
            merchant=merchant,
            user=user,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            metadata=metadata or {},
        )
    except Exception:
        logger.exception("Audit log write failed")


def _worker_has_area_access(worker, area):
    """Check if a worker is assigned to the given preparation area."""
    if worker.role in (ShiftWorker.ROLE_MANAGER, ShiftWorker.ROLE_ADMIN):
        return True
    return StaffPreparationArea.objects.filter(
        worker=worker, preparation_area=area
    ).exists()


# ── Preparation Area Management ──────────────────────────────────────────────

class PreparationAreaSerializer(serializers.ModelSerializer):
    class Meta:
        model = PreparationArea
        fields = [
            "id", "name", "is_default", "is_active",
            "display_order", "color", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def preparation_area_list_create(request):
    """
    GET  /api/orders/preparation-areas/    — list merchant's areas
    POST /api/orders/preparation-areas/    — create a new area
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    if request.method == "GET":
        areas = PreparationArea.objects.filter(merchant=merchant)
        return Response(PreparationAreaSerializer(areas, many=True).data)

    data = request.data.copy()
    name = data.get("name", "").strip()
    if not name:
        return Response({"error": "Name is required."}, status=400)

    if PreparationArea.objects.filter(merchant=merchant, name__iexact=name).exists():
        return Response(
            {"error": f"An area named '{name}' already exists."},
            status=400,
        )

    serializer = PreparationAreaSerializer(data=data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)

    # If this is the first area, make it default
    existing_count = PreparationArea.objects.filter(merchant=merchant).count()
    area = serializer.save(
        merchant=merchant,
        is_default=(existing_count == 0),
    )

    _audit(merchant, PosAuditLog.ACTION_ORDER_CREATE,
           user=request.user, entity_type="preparation_area",
           entity_id=area.id, metadata={"name": area.name})

    return Response(PreparationAreaSerializer(area).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def preparation_area_detail(request, pk):
    """
    PATCH  /api/orders/preparation-areas/<id>/  — update area
    DELETE /api/orders/preparation-areas/<id>/  — delete/deactivate area
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        area = PreparationArea.objects.get(pk=pk, merchant=merchant)
    except PreparationArea.DoesNotExist:
        return Response({"error": "Area not found."}, status=404)

    if request.method == "DELETE":
        # Check if area is referenced by menu items or order items
        has_menu_items = MenuItem.objects.filter(preparation_area=area).exists()
        has_order_items = OrderItem.objects.filter(preparation_area=area).exists()

        if has_menu_items or has_order_items:
            # Deactivate instead of delete
            area.is_active = False
            area.save(update_fields=["is_active", "updated_at"])

            # Clear default if this was the default
            if area.is_default:
                area.is_default = False
                area.save(update_fields=["is_default"])
                # Set another active area as default
                next_default = (
                    PreparationArea.objects
                    .filter(merchant=merchant, is_active=True)
                    .exclude(id=area.id)
                    .order_by("display_order")
                    .first()
                )
                if next_default:
                    next_default.is_default = True
                    next_default.save(update_fields=["is_default"])

            return Response(
                {"message": "Area deactivated (has existing references).", "deactivated": True}
            )

        area.delete()
        return Response(status=204)

    # PATCH
    data = request.data.copy()

    # Validate name uniqueness if changing
    new_name = data.get("name", "").strip()
    if new_name and new_name.lower() != area.name.lower():
        if PreparationArea.objects.filter(
            merchant=merchant, name__iexact=new_name
        ).exclude(id=area.id).exists():
            return Response(
                {"error": f"An area named '{new_name}' already exists."},
                status=400,
            )

    serializer = PreparationAreaSerializer(area, data=data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)

    new_is_default = serializer.validated_data.get("is_default", area.is_default)

    with transaction.atomic():
        # If setting as default, clear others
        if new_is_default and not area.is_default:
            PreparationArea.objects.filter(
                merchant=merchant, is_default=True
            ).exclude(id=area.id).update(is_default=False)

        serializer.save()

    return Response(PreparationAreaSerializer(area).data)


# ── Setup Preset ──────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def setup_cafe_preset(request):
    """
    POST /api/orders/preparation-areas/setup-cafe/
    Creates Bar, Kitchen, Main Counter for a merchant with no areas yet.
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    if PreparationArea.objects.filter(merchant=merchant).exists():
        return Response(
            {"error": "Preparation areas already configured."},
            status=400,
        )

    areas = []
    for i, (name, is_default) in enumerate([
        ("Bar", False),
        ("Kitchen", False),
        ("Main Counter", True),
    ]):
        area = PreparationArea.objects.create(
            merchant=merchant,
            name=name,
            is_default=is_default,
            display_order=i + 1,
        )
        areas.append(area)

    return Response(
        PreparationAreaSerializer(areas, many=True).data,
        status=201,
    )


# ── Bulk Menu Item Assignment ────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def bulk_assign_menu_items(request):
    """
    POST /api/orders/preparation-areas/bulk-assign/
    { menu_item_ids: [1,2,3], preparation_area_id: 1, requires_preparation: true }
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    item_ids = request.data.get("menu_item_ids", [])
    area_id = request.data.get("preparation_area_id")
    requires = request.data.get("requires_preparation", True)

    if not item_ids:
        return Response({"error": "menu_item_ids is required."}, status=400)

    # Validate area if provided
    area = None
    if area_id:
        try:
            area = PreparationArea.objects.get(pk=area_id, merchant=merchant, is_active=True)
        except PreparationArea.DoesNotExist:
            return Response({"error": "Area not found."}, status=404)

    # Update only items belonging to this merchant
    updated = MenuItem.objects.filter(
        id__in=item_ids,
        merchant=merchant,
    ).update(
        preparation_area=area,
        requires_preparation=requires,
    )

    return Response({
        "updated": updated,
        "area": area.name if area else None,
        "requires_preparation": requires,
    })


# ── Staff Preparation Area Assignment ────────────────────────────────────────

class StaffAreaAssignmentSerializer(serializers.Serializer):
    worker_id = serializers.UUIDField()
    area_ids = serializers.ListField(child=serializers.IntegerField())


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def staff_preparation_areas(request, worker_id):
    """
    GET  /api/orders/staff/<worker_id>/preparation-areas/
    PUT  /api/orders/staff/<worker_id>/preparation-areas/
    { area_ids: [1, 2] }
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        worker = ShiftWorker.objects.get(id=worker_id, merchant=merchant)
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."}, status=404)

    if request.method == "GET":
        assignments = StaffPreparationArea.objects.filter(
            worker=worker,
        ).select_related("preparation_area")
        return Response([
            {"area_id": a.preparation_area_id, "area_name": a.preparation_area.name}
            for a in assignments
        ])

    # PUT — replace assignments
    area_ids = request.data.get("area_ids", [])

    # Validate all areas belong to this merchant
    valid_areas = PreparationArea.objects.filter(
        id__in=area_ids, merchant=merchant, is_active=True
    )
    valid_ids = set(valid_areas.values_list("id", flat=True))

    with transaction.atomic():
        StaffPreparationArea.objects.filter(worker=worker).delete()
        for area_id in valid_ids:
            StaffPreparationArea.objects.create(
                worker=worker,
                preparation_area_id=area_id,
            )

    return Response({"assigned": len(valid_ids)})


# ── Preparation Area Orders (KDS View) ───────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def preparation_area_orders(request, area_id):
    """
    GET /api/orders/preparation-areas/<area_id>/orders/
    Query params: ?status=active|ready|all
    Returns orders with only items relevant to the given area.
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        area = PreparationArea.objects.get(pk=area_id, merchant=merchant, is_active=True)
    except PreparationArea.DoesNotExist:
        return Response({"error": "Area not found."}, status=404)

    status_param = request.query_params.get("status", "active")

    if status_param == "ready":
        item_status_filter = OrderItem.READY
    elif status_param == "all":
        item_status_filter = None
    else:
        item_status_filter = None  # active = pending + preparing

    orders = get_area_orders(merchant, area, status_filter=item_status_filter)

    # If status=active, we need both pending and preparing
    if status_param == "active":
        from django.db.models import Prefetch
        if area.is_default:
            active_items = OrderItem.objects.filter(
                requires_preparation=True,
                preparation_status__in=[OrderItem.PENDING, OrderItem.PREPARING],
            )
        else:
            active_items = OrderItem.objects.filter(
                preparation_area=area,
                requires_preparation=True,
                preparation_status__in=[OrderItem.PENDING, OrderItem.PREPARING],
            )
        orders = (
            Order.objects
            .filter(merchant=merchant, items__in=active_items)
            .exclude(status__in=[Order.STATUS_CANCELLED, Order.STATUS_COMPLETED])
            .distinct()
            .prefetch_related(
                Prefetch(
                    "items",
                    queryset=active_items.select_related("menu_item"),
                    to_attr="area_items",
                )
            )
            .select_related("table", "customer__user")
            .order_by("created_at")
        )

    result = []
    for order in orders:
        area_items = getattr(order, "area_items", None)
        if area_items is None:
            filters = {"requires_preparation": True}
            if not area.is_default:
                filters["preparation_area"] = area
            area_items = order.items.filter(
                **filters,
            ).exclude(
                preparation_status=OrderItem.CANCELLED
            ).select_related("menu_item")

        item_data = []
        for item in area_items:
            item_data.append({
                "id": item.id,
                "name": item.name,
                "quantity": item.quantity,
                "price": str(item.price),
                "subtotal": str(item.subtotal),
                "notes": "",  # OrderItem doesn't have notes; order-level notes shown separately
                "preparation_status": item.preparation_status,
                "preparation_started_at": (
                    item.preparation_started_at.isoformat()
                    if item.preparation_started_at else None
                ),
                "preparation_ready_at": (
                    item.preparation_ready_at.isoformat()
                    if item.preparation_ready_at else None
                ),
            })

        # Determine overall area status for this order
        statuses = [i["preparation_status"] for i in item_data]
        if all(s == OrderItem.READY for s in statuses):
            area_status = "ready"
        elif any(s == OrderItem.PREPARING for s in statuses):
            area_status = "preparing"
        else:
            area_status = "pending"

        result.append({
            "id": order.id,
            "uuid": str(order.uuid),
            "order_number": f"#{order.id}",
            "order_type": order.order_type,
            "fulfillment_type": order.fulfillment_type,
            "table_name": order.table_name_snapshot,
            "table_number": order.table_number_snapshot,
            "customer_name": (
                order.customer.full_name
                if order.customer
                else (order.guest_name_snapshot or None)
            ),
            "status": order.status,
            "payment_status": order.payment_status,
            "notes": order.notes,
            "area_status": area_status,
            "items": item_data,
            "created_at": order.created_at.isoformat(),
            "elapsed_seconds": int(
                (timezone.now() - order.created_at).total_seconds()
            ),
        })

    return Response({
        "area": {
            "id": area.id,
            "name": area.name,
            "color": area.color,
        },
        "orders": result,
        "active_count": sum(1 for o in result if o["area_status"] != "ready"),
    })


# ── Preparation Status Actions ────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def preparation_area_action(request, area_id, action):
    """
    POST /api/orders/preparation-areas/<area_id>/action/<action>/
    Actions: start, ready, cancel
    Body: { order_id: <int> }
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    try:
        area = PreparationArea.objects.get(pk=area_id, merchant=merchant, is_active=True)
    except PreparationArea.DoesNotExist:
        return Response({"error": "Area not found."}, status=404)

    order_id = request.data.get("order_id")
    if not order_id:
        return Response({"error": "order_id is required."}, status=400)

    try:
        order = Order.objects.get(id=order_id, merchant=merchant)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=404)

    # Check worker access
    worker_id = request.data.get("worker_id")
    worker = None
    if worker_id:
        try:
            worker = ShiftWorker.objects.get(id=worker_id, merchant=merchant)
            if not _worker_has_area_access(worker, area):
                return Response(
                    {"error": "You do not have access to this preparation area."},
                    status=403,
                )
        except ShiftWorker.DoesNotExist:
            pass

    status_map = {
        "start": OrderItem.PREPARING,
        "ready": OrderItem.READY,
        "cancel": OrderItem.CANCELLED,
    }
    target_status = status_map.get(action)
    if not target_status:
        return Response({"error": f"Unknown action: {action}"}, status=400)

    try:
        items = update_area_order_status(
            order=order,
            preparation_area=area,
            staff=worker,
            target_status=target_status,
        )
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    # Broadcast realtime event
    transaction.on_commit(lambda: broadcast_area_event(
        merchant_id=merchant.id,
        area_id=area.id,
        event_type=f"preparation.{action}",
        payload={
            "order_id": order.id,
            "area_id": area.id,
            "area_name": area.name,
            "status": target_status,
        },
    ))

    # If all items ready, broadcast order ready
    if target_status == OrderItem.READY:
        refreshed_order = Order.objects.get(id=order.id)
        if refreshed_order.status == Order.STATUS_READY:
            transaction.on_commit(lambda: broadcast_order_ready(
                merchant_id=merchant.id,
                order_id=order.id,
            ))

    return Response({
        "order_id": order.id,
        "area_id": area.id,
        "action": action,
        "status": target_status,
        "items_updated": items.count(),
    })


# ── Preparation Settings ─────────────────────────────────────────────────────

@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def preparation_settings(request):
    """
    GET  /api/orders/preparation-settings/  — get merchant preparation config
    PATCH /api/orders/preparation-settings/ — toggle preparation routing
    """
    merchant = _get_merchant(request.user)
    if not merchant:
        return Response({"error": "Merchant access required."}, status=403)

    if request.method == "GET":
        areas = PreparationArea.objects.filter(merchant=merchant)
        assigned_count = MenuItem.objects.filter(
            merchant=merchant, preparation_area__isnull=False
        ).count()
        unassigned_count = MenuItem.objects.filter(
            merchant=merchant, preparation_area__isnull=True, requires_preparation=True
        ).count()
        total_items = MenuItem.objects.filter(merchant=merchant).count()

        return Response({
            "preparation_routing_enabled": merchant.preparation_routing_enabled,
            "areas": PreparationAreaSerializer(areas, many=True).data,
            "stats": {
                "total_menu_items": total_items,
                "assigned_items": assigned_count,
                "unassigned_items": unassigned_count,
            },
        })

    # PATCH
    enabled = request.data.get("preparation_routing_enabled")
    if enabled is None:
        return Response({"error": "preparation_routing_enabled is required."}, status=400)

    if enabled:
        # Auto-set first active area as default if none is default
        has_default = PreparationArea.objects.filter(
            merchant=merchant, is_active=True, is_default=True
        ).exists()
        if not has_default:
            first_area = (
                PreparationArea.objects
                .filter(merchant=merchant, is_active=True)
                .order_by("display_order")
                .first()
            )
            if first_area:
                first_area.is_default = True
                first_area.save(update_fields=["is_default"])

    merchant.preparation_routing_enabled = bool(enabled)
    merchant.save(update_fields=["preparation_routing_enabled", "updated_at"])

    _audit(
        merchant,
        PosAuditLog.ACTION_ORDER_UPDATE,
        user=request.user,
        entity_type="preparation_settings",
        metadata={"enabled": enabled},
    )

    return Response({
        "preparation_routing_enabled": merchant.preparation_routing_enabled,
    })
