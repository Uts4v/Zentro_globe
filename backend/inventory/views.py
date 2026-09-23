"""
inventory/views.py

Mounted at /api/inventory/ — merchant-dashboard API.

Convention follows the rest of the backend: function-based @api_view views
with IsAuthenticated, resolving the acting merchant from the request and
enforcing tenant scoping on every object.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import F, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import (
    InventoryAdjustment,
    InventoryAuditLog,
    InventoryCategory,
    InventoryCountSchedule,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    InventoryReceiving,
    InventoryTransfer,
    InventoryWasteRecord,
    PurchaseOrder,
    StockCount,
    Supplier,
    UnitOfMeasure,
)
from .permissions import IsMerchantOrSuperuser, InvPerm, can_inventory, view_cost_allowed
from .serializers import (
    AdjustmentSerializer,
    AuditLogSerializer,
    CategorySerializer,
    CountCreateSerializer,
    CountLineSerializer,
    CountUpsertSerializer,
    InventoryItemCreateSerializer,
    InventoryItemSerializer,
    InventorySettingsSerializer,
    LocationSerializer,
    MovementSerializer,
    OverviewSerializer,
    POReceiveSerializer,
    PurchaseOrderSerializer,
    ReceivingCreateSerializer,
    ReceivingSerializer,
    ScheduleSerializer,
    StockCountSerializer,
    SupplierSerializer,
    TransferCreateSerializer,
    TransferSerializer,
    UnitSerializer,
    WasteFilterSerializer,
    WasteRecordSerializer,
    POCreateSerializer,
)
from . import services
from .services import (
    InventoryMovementService,
    PurchaseOrderService,
    StockCountService,
    seed_merchant_reference_data,
    stock_status,
    suggested_order_qty,
    validate_merchant,
)


def _merchant(request):
    try:
        return request.user.merchant_profile
    except Exception:
        return None


def _merchant_or_403(request):
    merchant = _merchant(request)
    if merchant is None:
        return None
    return merchant


def _require_perm(request, perm):
    return can_inventory(request.user, perm)


@api_view(["GET"])
def inventory_root_view(request):
    """GET /api/inventory/ — capability + onboarding info."""
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    item_count = InventoryItem.objects.filter(
        merchant=merchant, archived=False
    ).count()
    return Response({
        "is_configured": item_count > 0,
        "item_count": item_count,
        "permissions": {p: _require_perm(request, p) for p in InvPerm.ALL},
        "count_approval_required": services.InventorySettings.for_merchant(merchant).require_count_approval,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Overview
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET"])
def overview(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    return Response(OverviewSerializer.build(merchant))


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def categories_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        qs = InventoryCategory.objects.filter(merchant=merchant).order_by(
            "display_order", "name"
        )
        return Response(CategorySerializer(qs, many=True).data)
    data = request.data
    name = (data.get("name") or "").strip()
    if not name:
        return Response({"detail": "Name is required."}, status=400)
    cat, created = InventoryCategory.objects.get_or_create(
        merchant=merchant, name=name,
        defaults={
            "display_order": InventoryCategory.objects.filter(merchant=merchant).count(),
        },
    )
    return Response(CategorySerializer(cat).data,
                    status=201 if created else 200)


@api_view(["PATCH"])
def category_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    cat = InventoryCategory.objects.filter(merchant=merchant, id=pk).first()
    if not cat:
        return Response({"detail": "Not found."}, status=404)
    if request.data.get("name"):
        cat.name = request.data["name"].strip()
    if "display_order" in request.data:
        cat.display_order = int(request.data["display_order"])
    if "is_active" in request.data:
        cat.is_active = bool(request.data["is_active"])
    cat.save()
    return Response(CategorySerializer(cat).data)


@api_view(["POST"])
def category_reorder_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    order = request.data.get("order", [])
    for idx, cat_id in enumerate(order):
        InventoryCategory.objects.filter(merchant=merchant, id=cat_id).update(
            display_order=idx
        )
    return Response({"ok": True})


@api_view(["GET", "POST"])
def locations_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        qs = InventoryLocation.objects.filter(merchant=merchant).order_by(
            "display_order", "name"
        )
        return Response(LocationSerializer(qs, many=True).data)
    name = (request.data.get("name") or "").strip()
    if not name:
        return Response({"detail": "Name is required."}, status=400)
    loc, created = InventoryLocation.objects.get_or_create(
        merchant=merchant, name=name,
        defaults={
            "display_order": InventoryLocation.objects.filter(merchant=merchant).count(),
        },
    )
    return Response(LocationSerializer(loc).data, status=201 if created else 200)


@api_view(["PATCH"])
def location_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    loc = InventoryLocation.objects.filter(merchant=merchant, id=pk).first()
    if not loc:
        return Response({"detail": "Not found."}, status=404)
    if request.data.get("name"):
        loc.name = request.data["name"].strip()
    if "display_order" in request.data:
        loc.display_order = int(request.data["display_order"])
    if "is_active" in request.data:
        loc.is_active = bool(request.data["is_active"])
    loc.save()
    return Response(LocationSerializer(loc).data)


@api_view(["GET"])
def units_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    qs = UnitOfMeasure.objects.filter(Q(merchant__isnull=True) | Q(merchant=merchant))
    return Response(UnitSerializer(qs, many=True).data)


@api_view(["GET", "POST"])
def schedules_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = InventoryCountSchedule.objects.filter(merchant=merchant).order_by("name")
        return Response(ScheduleSerializer(qs, many=True).data)
    data = request.data
    days = data.get("frequency_days")
    if data.get("frequency_type") == "EVERY_N_DAYS" and not days:
        return Response({"detail": "frequency_days required for EVERY_N_DAYS."}, status=400)
    schedule = InventoryCountSchedule.objects.create(
        merchant=merchant,
        name=data.get("name") or "Count schedule",
        scope_type=data.get("scope_type", "ITEM"),
        item_id=data.get("item"),
        category_id=data.get("category"),
        location_id=data.get("location"),
        frequency_type=data.get("frequency_type", "EVERY_N_DAYS"),
        frequency_days=days or None,
        next_due_at=data.get("next_due_at") or timezone.now().date(),
        enabled=data.get("enabled", True),
    )
    # Immediate assignment: items matching the scope adopt next_due.
    _apply_schedule_to_items(merchant, schedule)
    return Response(ScheduleSerializer(schedule).data, status=201)


def _apply_schedule_to_items(merchant, schedule):
    qs = InventoryItem.objects.filter(merchant=merchant, archived=False)
    if schedule.scope_type == "ITEM" and schedule.item_id:
        qs = qs.filter(id=schedule.item_id)
    elif schedule.scope_type == "CATEGORY" and schedule.category_id:
        qs = qs.filter(category_id=schedule.category_id)
    elif schedule.scope_type == "LOCATION" and schedule.location_id:
        qs = qs.filter(default_location_id=schedule.location_id)
    for item in qs:
        if item.next_count_due is None or (schedule.next_due_at and schedule.next_due_at < item.next_count_due):
            item.next_count_due = schedule.next_due_at or timezone.now().date()
            item.count_schedule = schedule
            item.save(update_fields=["next_count_due", "count_schedule", "updated_at"])


@api_view(["PATCH", "DELETE"])
def schedule_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    schedule = InventoryCountSchedule.objects.filter(merchant=merchant, id=pk).first()
    if not schedule:
        return Response({"detail": "Not found."}, status=404)
    if request.method == "DELETE":
        schedule.enabled = False
        schedule.save(update_fields=["enabled", "updated_at"])
        return Response({"ok": True})
    for field in ("name", "frequency_type", "frequency_days", "next_due_at", "enabled"):
        if field in request.data:
            setattr(schedule, field, request.data[field])
    schedule.save()
    return Response(ScheduleSerializer(schedule).data)


# ─────────────────────────────────────────────────────────────────────────────
# Items & balances
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def items_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        return _item_list(request, merchant)
    return _item_create(request, merchant)


def _item_list(request, merchant):
    qs = InventoryItem.objects.filter(merchant=merchant, archived=False).select_related(
        "category", "default_location", "primary_supplier", "base_unit",
        "preferred_display_unit", "count_schedule",
    )
    # Filters
    q = (request.query_params.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(sku__icontains=q) | Q(barcode__icontains=q))
    item_type = request.query_params.get("type")
    if item_type:
        qs = qs.filter(item_type=item_type)
    category = request.query_params.get("category")
    if category:
        qs = qs.filter(category_id=category)
    location = request.query_params.get("location")
    if location:
        qs = qs.filter(
            Q(default_location_id=location)
            | Q(balances__location_id=location)
        ).distinct()
    supplier = request.query_params.get("supplier")
    if supplier:
        qs = qs.filter(primary_supplier_id=supplier)
    status_filter = request.query_params.get("status")
    # recent=false hides the balance prefetch cost
    include_balance = request.query_params.get("include_balance", "1") != "0"

    balances_by_item = {}
    if include_balance:
        balances = list(
            InventoryMovement.objects.none()  # placeholder to keep list import used
        )
        from .models import InventoryBalance
        all_balances = list(
            InventoryBalance.objects.filter(merchant=merchant).select_related("inventory_item")
        )
        for b in all_balances:
            balances_by_item.setdefault(b.inventory_item_id, []).append(b)

    items = list(qs.order_by("name"))
    # Status filter after aggregation
    if status_filter:
        filtered = []
        for item in items:
            qty = sum((b.on_hand for b in balances_by_item.get(item.id, [])), Decimal("0"))
            if stock_status(item, qty) == status_filter.upper():
                filtered.append(item)
        items = filtered

    payload = []
    for item in items:
        if include_balance:
            item._balance_map = {b.location_id: b for b in balances_by_item.get(item.id, [])}
        payload.append(InventoryItemSerializer(item).data)
    return Response({"results": payload, "count": len(payload)})


def _item_create(request, merchant):
    serializer = InventoryItemCreateSerializer(
        data=request.data,
        context={"merchant": merchant, "user": request.user},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    item = serializer.save()
    services.InventoryAuditLog.objects.create(
        merchant=merchant,
        user=request.user,
        action=services.InventoryAuditLog.ACTION_ITEM_CREATED,
        entity_type="item",
        entity_id=str(item.id),
        metadata={"name": item.name},
    )
    from .models import InventoryBalance
    item._balance_map = {
        b.location_id: b
        for b in InventoryBalance.objects.filter(inventory_item=item)
    }
    return Response(InventoryItemSerializer(item).data, status=201)


@api_view(["GET", "PATCH"])
def item_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    from .models import InventoryBalance
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).select_related(
        "category", "default_location", "primary_supplier", "base_unit",
        "preferred_display_unit", "count_schedule",
    ).first()
    if not item:
        return Response({"detail": "Not found."}, status=404)
    if request.method == "PATCH":
        data = request.data
        for field in (
            "name", "item_type", "category", "description", "sku", "barcode",
            "purchase_unit_label", "purchase_unit_conversion", "active",
            "par_level", "reorder_point", "critical_level", "primary_supplier",
            "preferred_display_unit",
        ):
            if field in data:
                if field == "category":
                    cat = InventoryCategory.objects.filter(merchant=merchant, id=data[field]).first()
                    if not cat:
                        return Response({"detail": "Unknown category."}, status=400)
                    item.category = cat
                elif field == "primary_supplier":
                    if data[field] is None:
                        item.primary_supplier = None
                    else:
                        sup = Supplier.objects.filter(merchant=merchant, id=data[field]).first()
                        if not sup:
                            return Response({"detail": "Unknown supplier."}, status=400)
                        item.primary_supplier = sup
                elif field in ("purchase_unit_conversion", "par_level", "reorder_point", "critical_level"):
                    value = data[field]
                    setattr(item, field, Decimal(value) if value not in (None, "") else None)
                else:
                    setattr(item, field, data[field])
        item.save()
        services.InventoryAuditLog.objects.create(
            merchant=merchant,
            user=request.user,
            action=services.InventoryAuditLog.ACTION_ITEM_UPDATED,
            entity_type="item",
            entity_id=str(item.id),
        )
    balances = list(InventoryBalance.objects.filter(inventory_item=item))
    item._balance_map = {b.location_id: b for b in balances}
    return Response(InventoryItemSerializer(item).data)


@api_view(["POST"])
def archive_item_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).first()
    if not item:
        return Response({"detail": "Not found."}, status=404)
    item.archived = True
    item.active = False
    item.save(update_fields=["archived", "active", "updated_at"])
    return Response({"ok": True})


@api_view(["GET"])
def item_movements_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).first()
    if not item:
        return Response({"detail": "Not found."}, status=404)
    qs = InventoryMovement.objects.filter(merchant=merchant, inventory_item=item).select_related(
        "inventory_item", "location", "performed_by"
    )
    qs = _date_range_filter(qs, request)
    page = _paged(request, qs)
    return Response({
        "results": MovementSerializer(page["items"], many=True).data,
        "count": page["count"],
        "total_count": qs.count(),
        "movement_total": _total_by_type(qs),
    })


@api_view(["GET"])
def movements_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    qs = InventoryMovement.objects.filter(merchant=merchant).select_related(
        "inventory_item", "location", "performed_by"
    )
    movement_type = request.query_params.get("movement_type")
    if movement_type:
        qs = qs.filter(movement_type=movement_type.upper())
    return _paged_response(request, qs, MovementSerializer)


@api_view(["POST"])
def reversal_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    movement = InventoryMovement.objects.filter(merchant=merchant, id=pk).first()
    if not movement:
        return Response({"detail": "Not found."}, status=404)
    movement = InventoryMovementService.reverse(
        merchant=merchant, movement=movement, performed_by=request.user
    )
    return Response(MovementSerializer(movement).data)


# ─────────────────────────────────────────────────────────────────────────────
# Waste / Adjustments
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def waste_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = InventoryWasteRecord.objects.filter(merchant=merchant).select_related(
            "inventory_item", "location", "performed_by"
        )
        from_date = request.query_params.get("from_date")
        to_date = request.query_params.get("to_date")
        if from_date:
            qs = qs.filter(created_at__date__gte=from_date)
        if to_date:
            qs = qs.filter(created_at__date__lte=to_date)
        if request.query_params.get("item"):
            qs = qs.filter(inventory_item_id=request.query_params["item"])
        if request.query_params.get("location"):
            qs = qs.filter(location_id=request.query_params["location"])
        if request.query_params.get("reason"):
            qs = qs.filter(reason=request.query_params["reason"])
        total_qty = Sum("quantity")
        return _paged_response(request, qs, WasteRecordSerializer, extra={
            "waste_total": qs.aggregate(t=total_qty)["t"] or 0,
        })
    serializer = WasteRecordSerializer(
        data=request.data,
        context={"merchant": merchant, "user": request.user,
                 "idempotency_key": request.data.get("idempotency_key")},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    record = serializer.save()
    return Response(WasteRecordSerializer(record).data, status=201)


@api_view(["GET", "POST"])
def adjustments_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = InventoryAdjustment.objects.filter(merchant=merchant).select_related(
            "inventory_item", "location", "performed_by"
        )
        return _paged_response(request, qs, AdjustmentSerializer)
    serializer = AdjustmentSerializer(
        data=request.data,
        context={"merchant": merchant, "user": request.user,
                 "idempotency_key": request.data.get("idempotency_key")},
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    adj = serializer.save()
    return Response(AdjustmentSerializer(adj).data, status=201)


# ─────────────────────────────────────────────────────────────────────────────
# Receiving
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def receiving_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = InventoryReceiving.objects.filter(merchant=merchant).select_related(
            "supplier", "location", "received_by"
        ).prefetch_related("lines__inventory_item")
        return _paged_response(request, qs, ReceivingSerializer)
    serializer = ReceivingCreateSerializer(
        data=request.data, context={"merchant": merchant, "user": request.user}
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    rec = serializer.save()
    return Response(ReceivingSerializer(rec).data, status=201)


@api_view(["GET"])
def receiving_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    rec = InventoryReceiving.objects.filter(merchant=merchant, id=pk).select_related(
        "supplier", "location", "received_by"
    ).prefetch_related("lines__inventory_item").first()
    if not rec:
        return Response({"detail": "Not found."}, status=404)
    return Response(ReceivingSerializer(rec).data)


# ─────────────────────────────────────────────────────────────────────────────
# Transfers
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def transfers_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = InventoryTransfer.objects.filter(merchant=merchant).select_related(
            "from_location", "to_location", "created_by"
        ).prefetch_related("lines__inventory_item")
        return _paged_response(request, qs, TransferSerializer)
    serializer = TransferCreateSerializer(
        data=request.data, context={"merchant": merchant, "user": request.user}
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    transfer = serializer.save()
    return Response(TransferSerializer(transfer).data, status=201)


@api_view(["POST"])
def transfer_complete_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    transfer = InventoryTransfer.objects.filter(merchant=merchant, id=pk).first()
    if not transfer:
        return Response({"detail": "Not found."}, status=404)
    try:
        InventoryMovementService.transfer(
            merchant=merchant,
            transfer=transfer,
            performed_by=request.user,
            idempotency_key=request.data.get("idempotency_key"),
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    transfer.refresh_from_db()
    return Response(TransferSerializer(transfer).data)


@api_view(["POST"])
def transfer_cancel_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    transfer = InventoryTransfer.objects.filter(merchant=merchant, id=pk).first()
    if not transfer:
        return Response({"detail": "Not found."}, status=404)
    if transfer.status in ("RECEIVED", "CANCELLED"):
        return Response({"detail": "Cannot cancel this transfer."}, status=400)
    transfer.status = "CANCELLED"
    transfer.save(update_fields=["status", "updated_at"])
    return Response(TransferSerializer(transfer).data)


# ─────────────────────────────────────────────────────────────────────────────
# Stock counts
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def counts_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = StockCount.objects.filter(merchant=merchant).prefetch_related("lines")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter.upper())
        return _paged_response(request, qs, StockCountSerializer)
    serializer = CountCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data
    location = None
    if data.get("location"):
        location = InventoryLocation.objects.filter(
            merchant=merchant, id=data["location"]
        ).first()
        if not location:
            return Response({"detail": "Unknown location."}, status=400)
    count = StockCountService.create_count(
        merchant=merchant,
        name=data["name"],
        location=location,
        item_ids=data.get("item_ids") or None,
        count_type=data.get("count_type") or "Stock Count",
        started_by=request.user,
        note=data.get("note") or "",
    )
    from .serializers import StockCountSerializer as SCS
    return Response(SCS(count).data, status=201)


@api_view(["GET"])
def count_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    count = StockCount.objects.filter(merchant=merchant, id=pk).prefetch_related(
        "lines__inventory_item", "lines__location"
    ).first()
    if not count:
        return Response({"detail": "Not found."}, status=404)
    return Response(StockCountSerializer(count).data)


@api_view(["POST"])
def count_line_upsert_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return Response({"detail": "Not found."}, status=404)
    serializer = CountUpsertSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        line = StockCountService.upsert_line(
            count=count,
            merchant=merchant,
            line_id=serializer.validated_data["line_id"],
            physical_quantity=serializer.validated_data.get("physical_quantity"),
            note=serializer.validated_data.get("note") or "",
            performed_by=request.user,
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(CountLineSerializer(line).data)


@api_view(["POST"])
def count_submit_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if not _require_perm(request, InvPerm.SUBMIT_COUNT):
        return Response({"detail": "Not permitted."}, status=403)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return Response({"detail": "Not found."}, status=404)
    try:
        result = StockCountService.submit(
            count=count, merchant=merchant, submitted_by=request.user
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    result.refresh_from_db()
    return Response(StockCountSerializer(result).data)


@api_view(["POST"])
def count_approve_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if not _require_perm(request, InvPerm.APPROVE_COUNT):
        return Response({"detail": "Not permitted."}, status=403)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return Response({"detail": "Not found."}, status=404)
    try:
        result = StockCountService.approve(
            count=count, merchant=merchant, approved_by=request.user
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    result.refresh_from_db()
    return Response(StockCountSerializer(result).data)


@api_view(["POST"])
def count_cancel_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return Response({"detail": "Not found."}, status=404)
    try:
        count = StockCountService.cancel(
            count=count, merchant=merchant, cancelled_by=request.user
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(StockCountSerializer(count).data)


# ─────────────────────────────────────────────────────────────────────────────
# Suppliers
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def suppliers_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = Supplier.objects.filter(merchant=merchant, archived=False).prefetch_related(
            "item_mappings__inventory_item"
        )
        active_only = request.query_params.get("active", "1") == "1"
        if active_only:
            qs = qs.filter(is_active=True)
        return Response(SupplierSerializer(qs, many=True).data)
    serializer = SupplierSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    sup = serializer.save(merchant=merchant)
    return Response(SupplierSerializer(sup).data, status=201)


@api_view(["GET", "PATCH", "DELETE"])
def supplier_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    sup = Supplier.objects.filter(merchant=merchant, id=pk).first()
    if not sup:
        return Response({"detail": "Not found."}, status=404)
    if request.method == "DELETE":
        sup.archived = True
        sup.is_active = False
        sup.save(update_fields=["archived", "is_active", "updated_at"])
        return Response({"ok": True})
    serializer = SupplierSerializer(sup, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    sup = serializer.save()
    services.InventoryAuditLog.objects.create(
        merchant=merchant,
        user=request.user,
        action=services.InventoryAuditLog.ACTION_SUPPLIER_EDIT,
        entity_type="supplier",
        entity_id=str(sup.id),
    )
    return Response(SupplierSerializer(sup).data)


@api_view(["POST"])
def supplier_mapping_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    sup = Supplier.objects.filter(merchant=merchant, id=pk).first()
    if not sup:
        return Response({"detail": "Not found."}, status=404)
    from .models import SupplierItem
    item = InventoryItem.objects.filter(
        merchant=merchant, id=request.data.get("inventory_item")
    ).first()
    if not item:
        return Response({"detail": "Unknown item."}, status=400)
    mapping, _ = SupplierItem.objects.update_or_create(
        supplier=sup,
        inventory_item=item,
        defaults={
            "supplier_sku": request.data.get("supplier_sku", ""),
            "purchase_unit_label": request.data.get("purchase_unit_label", ""),
            "purchase_unit_conversion": request.data.get("purchase_unit_conversion"),
            "latest_unit_cost": request.data.get("latest_unit_cost"),
            "preferred": request.data.get("preferred", False),
            "minimum_quantity": request.data.get("minimum_quantity"),
            "lead_time_days": request.data.get("lead_time_days"),
        },
    )
    sup.refresh_from_db()
    return Response(SupplierSerializer(sup).data)


# ─────────────────────────────────────────────────────────────────────────────
# Purchase orders
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
def purchase_orders_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    if request.method == "GET":
        qs = PurchaseOrder.objects.filter(merchant=merchant).select_related(
            "supplier", "delivery_location", "created_by"
        ).prefetch_related("lines__inventory_item")
        po_status = request.query_params.get("status")
        if po_status:
            qs = qs.filter(status=po_status.upper())
        return _paged_response(request, qs, PurchaseOrderSerializer)
    serializer = POCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data
    supplier = Supplier.objects.filter(merchant=merchant, id=data["supplier"]).first()
    if not supplier:
        return Response({"detail": "Unknown supplier."}, status=400)
    location = InventoryLocation.objects.filter(
        merchant=merchant, id=data["delivery_location"]
    ).first()
    if not location:
        return Response({"detail": "Unknown delivery location."}, status=400)
    try:
        po = PurchaseOrderService.create(
            merchant=merchant,
            supplier=supplier,
            delivery_location=location,
            lines=data["lines"],
            expected_date=data.get("expected_date"),
            notes=data.get("notes") or "",
            created_by=request.user,
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(PurchaseOrderSerializer(po).data, status=201)


@api_view(["GET", "PATCH"])
def purchase_order_detail_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    po = PurchaseOrder.objects.filter(merchant=merchant, id=pk).select_related(
        "supplier", "delivery_location", "created_by"
    ).prefetch_related("lines__inventory_item").first()
    if not po:
        return Response({"detail": "Not found."}, status=404)
    if request.method == "PATCH":
        if request.data.get("status") == "CANCELLED":
            po.status = "CANCELLED"
            po.save(update_fields=["status", "updated_at"])
        if request.data.get("status") == "SEND":
            po.status = "SENT"
            po.save(update_fields=["status", "updated_at"])
    return Response(PurchaseOrderSerializer(po).data)


@api_view(["POST"])
def purchase_order_receive_view(request, pk):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    po = PurchaseOrder.objects.filter(merchant=merchant, id=pk).first()
    if not po:
        return Response({"detail": "Not found."}, status=404)
    serializer = POReceiveSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    location = None
    if serializer.validated_data.get("location"):
        location = InventoryLocation.objects.filter(
            merchant=merchant, id=serializer.validated_data["location"]
        ).first()
        if not location:
            return Response({"detail": "Unknown location."}, status=400)
    try:
        updated = PurchaseOrderService.receive_lines(
            merchant=merchant,
            po=po,
            received_map=serializer.validated_data["received"],
            location=location,
            performed_by=request.user,
            idempotency_key=serializer.validated_data.get("idempotency_key"),
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=400)
    return Response(PurchaseOrderSerializer(updated).data)


# ─────────────────────────────────────────────────────────────────────────────
# Reports
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET"])
def reports_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    report = request.query_params.get("report", "movements")
    if report == "movements":
        return _report_movements(request, merchant)
    if report == "variance":
        return _report_variance(request, merchant)
    if report == "waste":
        return _report_waste(request, merchant)
    if report == "purchasing":
        return _report_purchasing(request, merchant)
    if report == "stock":
        return _report_stock(request, merchant)
    if report == "low-stock":
        return _report_low_stock(request, merchant)
    if report == "count-history":
        return _report_count_history(request, merchant)
    return Response({"detail": "Unknown report."}, status=400)


def _report_stock(request, merchant):
    from .models import InventoryBalance
    include_cost = view_cost_allowed(request.user)
    balances = list(
        InventoryBalance.objects.filter(merchant=merchant).select_related(
            "inventory_item__base_unit", "inventory_item__category", "location"
        )
    )
    rows = []
    aggregate = {}
    for b in balances:
        item = b.inventory_item
        aggregate.setdefault(item.id, {"qty": Decimal("0"), "value": Decimal("0")})
        aggregate[item.id]["qty"] += b.on_hand
        aggregate[item.id]["value"] += b.on_hand * b.avg_cost
        rows.append({
            "item": item.name,
            "category": item.category.name if item.category else "",
            "location": b.location.name,
            "on_hand": b.on_hand,
            "unit": item.base_unit.code,
            "par": item.par_level,
            "reorder_point": item.reorder_point,
            "status": stock_status(item, b.on_hand),
            "stock_value": b.on_hand * b.avg_cost if include_cost else None,
            "last_count": item.last_count_at,
            "next_count": item.next_count_due,
        })
    return Response({"rows": rows, "include_cost": include_cost})


def _report_low_stock(request, merchant):
    from .models import InventoryBalance
    balances = list(
        InventoryBalance.objects.filter(merchant=merchant).select_related(
            "inventory_item", "location"
        )
    )
    by_item = {}
    for b in balances:
        by_item.setdefault(b.inventory_item_id, Decimal("0"))
        by_item[b.inventory_item_id] += b.on_hand
    items = list(
        InventoryItem.objects.filter(merchant=merchant, active=True, archived=False)
        .select_related("base_unit", "default_location")
    )
    rows = []
    for item in items:
        qty = by_item.get(item.id, Decimal("0"))
        if stock_status(item, qty) in ("LOW", "CRITICAL", "OUT"):
            rows.append({
                "id": item.id,
                "name": item.name,
                "available": qty,
                "unit": item.base_unit.code,
                "par": item.par_level,
                "reorder_point": item.reorder_point,
                "status": stock_status(item, qty),
                "suggested_order": suggested_order_qty(item, qty),
            })
    rows.sort(key=lambda r: (r["status"] != "OUT", r["status"] != "CRITICAL"))
    return Response({"results": rows})


def _report_movements(request, merchant):
    qs = InventoryMovement.objects.filter(merchant=merchant).select_related(
        "inventory_item", "location", "performed_by"
    )
    qs = _date_range_filter(qs, request)
    movement_type = request.query_params.get("movement_type")
    if movement_type:
        qs = qs.filter(movement_type=movement_type.upper())
    items = _paged(request, qs)
    return Response({
        "results": MovementSerializer(items["items"], many=True).data,
        "count": items["count"],
        "total_count": qs.count(),
    })


def _report_variance(request, merchant):
    """Stock variance report from COUNT_RECONCILIATION movements."""
    from .models import StockCountLine, CountStatus
    qs = StockCount.objects.filter(merchant=merchant, status=CountStatus.APPROVED)
    from_date = request.query_params.get("from_date")
    to_date = request.query_params.get("to_date")
    if from_date:
        qs = qs.filter(approved_at__date__gte=from_date)
    if to_date:
        qs = qs.filter(approved_at__date__lte=to_date)
    rows = []
    for count in qs:
        for line in count.lines.select_related("inventory_item", "location").filter(
            physical_quantity__isnull=False
        ):
            if line.difference is None or line.difference == 0:
                continue
            value_diff = abs(line.difference) * (line.inventory_item.balances.first().avg_cost if line.inventory_item.balances.first() else 0)
            rows.append({
                "item": line.inventory_item.name,
                "book": line.book_quantity,
                "physical": line.physical_quantity,
                "difference": line.difference,
                "difference_pct": _pct(line.book_quantity, line.difference),
                "value_difference": value_diff if view_cost_allowed(request.user) else None,
                "count": count.name,
                "counted_at": count.approved_at or count.submitted_at,
            })
    return Response({"results": rows})


def _pct(book, diff):
    if not book:
        return None
    return str((diff / book * 100).quantize(Decimal("0.1")))


def _report_waste(request, merchant):
    qs = InventoryWasteRecord.objects.filter(merchant=merchant).select_related(
        "inventory_item", "location", "performed_by"
    )
    qs = _date_range_filter(qs, request)
    item = request.query_params.get("item")
    location = request.query_params.get("location")
    reason = request.query_params.get("reason")
    if item:
        qs = qs.filter(inventory_item_id=item)
    if location:
        qs = qs.filter(location_id=location)
    if reason:
        qs = qs.filter(reason=reason)
    rows = [
        {
            "id": w.id,
            "item": w.inventory_item.name,
            "location": w.location.name,
            "quantity": w.quantity,
            "unit": w.inventory_item.base_unit.code,
            "reason": w.get_reason_display(),
            "note": w.note,
            "cost": (w.quantity * w.per_unit_cost).quantize(Decimal("0.01")) if w.per_unit_cost else None,
            "performed_by": w.performed_by.get_full_name() or (w.performed_by.email if w.performed_by else ""),
            "created_at": w.created_at,
        }
        for w in qs
    ]
    total = sum(r["cost"] for r in rows if r["cost"]) if view_cost_allowed(request.user) else None
    return Response({"results": rows, "total_cost": total, "include_cost": view_cost_allowed(request.user)})


def _report_purchasing(request, merchant):
    qs = PurchaseOrder.objects.filter(merchant=merchant).select_related(
        "supplier", "delivery_location", "created_by"
    ).prefetch_related("lines")
    from_date = request.query_params.get("from_date")
    to_date = request.query_params.get("to_date")
    if from_date:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date:
        qs = qs.filter(created_at__date__lte=to_date)
    rows = [
        {
            "id": po.id,
            "po_number": po.po_number,
            "supplier": po.supplier.name,
            "status": po.status,
            "created_at": po.created_at,
            "expected_date": po.expected_date,
            "total": po.total_amount,
            "lines": po.lines.count(),
        }
        for po in qs[:500]
    ]
    return Response({"results": rows})


def _report_count_history(request, merchant):
    from .models import StockCountLine
    qs = StockCountLine.objects.filter(
        stock_count__merchant=merchant,
        physical_quantity__isnull=False,
    ).select_related("inventory_item", "stock_count", "location")
    item = request.query_params.get("item")
    if item:
        qs = qs.filter(inventory_item_id=item)
    rows = [
        {
            "item": line.inventory_item.name,
            "book": line.book_quantity,
            "physical": line.physical_quantity,
            "difference": line.difference,
            "unit": line.inventory_item.base_unit.code,
            "location": line.location.name,
            "count": line.stock_count.name,
            "counted_at": line.stock_count.approved_at or line.stock_count.submitted_at,
        }
        for line in qs.order_by("-id")[:500]
    ]
    return Response({"results": rows})


@api_view(["GET"])
def audit_log_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    qs = InventoryAuditLog.objects.filter(merchant=merchant).select_related("user")
    return _paged_response(request, qs, AuditLogSerializer)


# ─────────────────────────────────────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "PATCH"])
def settings_view(request):
    merchant = _merchant_or_403(request)
    if merchant is None:
        return Response({"detail": "No merchant profile."}, status=403)
    settings_obj = services.InventorySettings.for_merchant(merchant)
    if request.method == "PATCH":
        serializer = InventorySettingsSerializer(settings_obj, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        settings_obj = serializer.save()
        services.InventoryAuditLog.objects.create(
            merchant=merchant,
            user=request.user,
            action=services.InventoryAuditLog.ACTION_SETTINGS_UPDATED,
            entity_type="settings",
            entity_id=str(settings_obj.id),
        )
    return Response(InventorySettingsSerializer(settings_obj).data)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _date_range_filter(qs, request):
    from_date = request.query_params.get("from_date")
    to_date = request.query_params.get("to_date")
    if from_date:
        qs = qs.filter(created_at__date__gte=from_date)
    if to_date:
        qs = qs.filter(created_at__date__lte=to_date)
    return qs


def _paged(request, qs):
    per_page = int(request.query_params.get("per_page", 50))
    per_page = min(max(per_page, 1), 200)
    try:
        page = int(request.query_params.get("page", 1))
    except ValueError:
        page = 1
    page = max(page, 1)
    offset = (page - 1) * per_page
    items = qs[offset: offset + per_page]
    return {"items": list(items), "count": qs.count()}


def _paged_response(request, qs, serializer_cls, extra=None):
    page = _paged(request, qs)
    data = {
        "results": serializer_cls(page["items"], many=True).data,
        "count": page["count"],
    }
    if extra:
        data.update(extra)
    return Response(data)


def _total_by_type(qs):
    from .models import InventoryMovement
    return {
        "inbound": qs.filter(quantity_change__gt=0).aggregate(t=Sum("quantity_change"))["t"] or 0,
        "outbound": qs.filter(quantity_change__lt=0).aggregate(t=Sum("quantity_change"))["t"] or 0,
    }