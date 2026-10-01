"""
merchants/table_views.py — Tables & Areas.

A TABLE AREA is where customers sit (Main Dining, Bar, Rooftop…). Merchants
name their own areas; tables belong to an area. This is separate from
preparation areas (where food and drinks are made).

Rules kept here:
  * The QR token belongs to the table. Renaming or moving a table, or
    renaming its area, never changes the token (only the explicit
    "regenerate QR" action does).
  * Nothing with history is hard-deleted: tables with orders and areas with
    tables are switched off instead.
  * Everything is scoped to the acting merchant. In staff mode the
    employee's assigned areas also filter what they see (pos.rbac).
"""

from django.db import transaction
from django.db.models import Max
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import MerchantProfile, MerchantTable, TableArea

DEFAULT_AREA_NAME = "Main Area"
MAX_BULK_TABLES = 200
OPEN_ORDER_STATUSES = ("pending", "confirmed", "preparing", "ready")


def _merchant_or_403(request):
    try:
        return request.user.merchant_profile, None
    except (AttributeError, MerchantProfile.DoesNotExist):
        return None, Response({"error": "No merchant profile found for this user."}, status=403)


def _audit(request, merchant, action, entity_type, entity_id, **metadata):
    from pos import rbac
    from pos.models import PosAuditLog

    PosAuditLog.objects.create(
        merchant=merchant, user=request.user, worker=rbac.request_worker(request, merchant),
        action=action, entity_type=entity_type, entity_id=str(entity_id), metadata=metadata,
    )


def default_area(merchant) -> TableArea:
    """The area new tables land in when none is chosen."""
    area = TableArea.objects.filter(merchant=merchant, is_active=True).order_by("display_order", "id").first()
    if area is None:
        area, _ = TableArea.objects.get_or_create(merchant=merchant, name=DEFAULT_AREA_NAME)
        if not area.is_active:
            area.is_active = True
            area.save(update_fields=["is_active", "updated_at"])
    return area


def _next_table_number(merchant) -> int:
    return (MerchantTable.objects.filter(merchant=merchant).aggregate(m=Max("table_number"))["m"] or 0) + 1


def _open_orders(table_ids):
    from orders.models import Order

    return Order.objects.filter(table_id__in=table_ids, status__in=OPEN_ORDER_STATUSES)


class TableSerializer(serializers.ModelSerializer):
    area_name = serializers.CharField(source="area.name", read_only=True, default="")

    class Meta:
        model = MerchantTable
        fields = [
            "id", "name", "table_number", "public_token", "is_active",
            "area", "area_name", "seats", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "public_token", "created_at", "updated_at"]
        extra_kwargs = {"table_number": {"required": False}, "area": {"required": False}}

    def validate_table_number(self, value):
        if value <= 0:
            raise serializers.ValidationError("table_number must be greater than zero.")
        return value

    def validate_seats(self, value):
        if value < 1 or value > 500:
            raise serializers.ValidationError("Seats must be between 1 and 500.")
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the table a name.")
        return value


class AreaSerializer(serializers.ModelSerializer):
    table_count = serializers.SerializerMethodField()
    tables = serializers.SerializerMethodField()

    class Meta:
        model = TableArea
        fields = ["id", "name", "display_order", "is_active", "table_count", "tables"]

    def _tables(self, obj):
        allowed = self.context.get("table_ids")
        tables = [t for t in obj.tables.all()]
        if allowed is not None:
            tables = [t for t in tables if t.id in allowed]
        return sorted(tables, key=lambda t: t.table_number)

    def get_table_count(self, obj):
        return sum(1 for t in self._tables(obj) if t.is_active)

    def get_tables(self, obj):
        return TableSerializer(self._tables(obj), many=True).data


def _name_taken(merchant, name, exclude_id=None):
    qs = MerchantTable.objects.filter(merchant=merchant, name__iexact=name)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.exists()


def _bulk_names(prefix, count, start):
    return [f"{prefix}{n}" for n in range(start, start + count)]


def _parse_bulk(data, *, require_count=False):
    """(count, prefix, start, seats) or raises ValueError with a plain message."""
    def whole(key, default, lo, hi, label):
        raw = data.get(key, default)
        if raw in (None, ""):
            raw = default
        try:
            value = int(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{label} must be a whole number.")
        if value < lo or value > hi:
            raise ValueError(f"{label} must be between {lo} and {hi}.")
        return value

    count = whole("table_count", 0, 1 if require_count else 0, MAX_BULK_TABLES, "Number of tables")
    start = whole("start_number", 1, 0, 100000, "Starting number")
    seats = whole("seats", 4, 1, 500, "Seats per table")
    prefix = str(data.get("prefix") or "").strip()[:20]
    if count and not prefix:
        raise ValueError("Add a table prefix, like T or B.")
    return count, prefix, start, seats


def _create_tables(merchant, area, count, prefix, start, seats):
    names = _bulk_names(prefix, count, start)
    taken = set(
        MerchantTable.objects.filter(merchant=merchant, name__in=names).values_list("name", flat=True)
    )
    if taken:
        shown = ", ".join(sorted(taken)[:5])
        raise ValueError(f"These table names are already used: {shown}. Choose another prefix or starting number.")
    number = _next_table_number(merchant)
    tables = [
        MerchantTable(merchant=merchant, area=area, name=name, table_number=number + i, seats=seats)
        for i, name in enumerate(names)
    ]
    MerchantTable.objects.bulk_create(tables)
    return tables


def _visible_area_ids(request, merchant):
    """Areas the acting employee works in; None = all (owner, managers)."""
    from pos import rbac

    return rbac.allowed_area_ids(rbac.request_worker(request, merchant))


# ── Areas ─────────────────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def table_areas(request):
    """GET list areas with their tables · POST create an area (optionally with tables)."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied

    if request.method == "GET":
        areas = TableArea.objects.filter(merchant=merchant).prefetch_related("tables")
        if request.query_params.get("active") == "1":
            areas = areas.filter(is_active=True)
        visible = _visible_area_ids(request, merchant)
        if visible is not None:
            areas = areas.filter(id__in=visible)
        unassigned = MerchantTable.objects.filter(merchant=merchant, area__isnull=True)
        return Response({
            "areas": AreaSerializer(areas, many=True).data,
            "unassigned": TableSerializer(unassigned, many=True).data if visible is None else [],
        })

    name = str(request.data.get("name") or "").strip()[:100]
    if not name:
        return Response({"error": "Give the area a name."}, status=400)
    if TableArea.objects.filter(merchant=merchant, name__iexact=name).exists():
        return Response({"error": f"You already have an area called “{name}”."}, status=400)
    try:
        count, prefix, start, seats = _parse_bulk(request.data)
        with transaction.atomic():
            area = TableArea.objects.create(
                merchant=merchant, name=name,
                display_order=TableArea.objects.filter(merchant=merchant).count(),
            )
            if count:
                _create_tables(merchant, area, count, prefix, start, seats)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    _audit(request, merchant, "table_area_create", "table_area", area.id, name=name, tables=count)
    area = TableArea.objects.prefetch_related("tables").get(pk=area.pk)
    return Response(AreaSerializer(area).data, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def table_areas_reorder(request):
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    order = request.data.get("order")
    if not isinstance(order, list):
        return Response({"error": "order must be a list of area ids."}, status=400)
    for index, area_id in enumerate(order):
        TableArea.objects.filter(merchant=merchant, id=area_id).update(display_order=index)
    return Response({"ok": True})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def table_area_detail(request, pk):
    """PATCH rename / reorder / switch on-off · DELETE remove an empty area."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    area = TableArea.objects.filter(merchant=merchant, pk=pk).first()
    if area is None:
        return Response({"error": "Area not found."}, status=404)

    if request.method == "DELETE":
        if area.tables.exists():
            return Response(
                {"error": "This area still has tables. Move them to another area first, or turn the area off."},
                status=400,
            )
        area.delete()
        _audit(request, merchant, "table_area_update", "table_area", pk, event="deleted", name=area.name)
        return Response(status=204)

    changes = {}
    if "name" in request.data:
        name = str(request.data.get("name") or "").strip()[:100]
        if not name:
            return Response({"error": "Give the area a name."}, status=400)
        if TableArea.objects.filter(merchant=merchant, name__iexact=name).exclude(pk=area.pk).exists():
            return Response({"error": f"You already have an area called “{name}”."}, status=400)
        if name != area.name:
            changes["name"] = [area.name, name]
            area.name = name
    if "display_order" in request.data:
        try:
            area.display_order = max(int(request.data["display_order"]), 0)
        except (TypeError, ValueError):
            return Response({"error": "display_order must be a whole number."}, status=400)
    if "is_active" in request.data:
        active = bool(request.data["is_active"])
        if not active and area.is_active:
            # Never switch off an area that still has tables in use.
            active_tables = list(area.tables.filter(is_active=True).values_list("id", flat=True))
            if active_tables:
                if _open_orders(active_tables).exists():
                    return Response(
                        {"error": "Some tables in this area have open orders. Close those orders first."},
                        status=400,
                    )
                return Response(
                    {"error": f"This area still has {len(active_tables)} table(s). "
                              "Move them to another area or turn them off first."},
                    status=400,
                )
        if active != area.is_active:
            changes["is_active"] = [area.is_active, active]
            area.is_active = active
    area.save()
    if changes:
        _audit(request, merchant, "table_area_update", "table_area", area.id, **changes)
    area = TableArea.objects.prefetch_related("tables").get(pk=area.pk)
    return Response(AreaSerializer(area).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def table_area_add_tables(request, pk):
    """POST add more tables to an area (count, prefix, start_number, seats)."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    area = TableArea.objects.filter(merchant=merchant, pk=pk).first()
    if area is None:
        return Response({"error": "Area not found."}, status=404)
    try:
        count, prefix, start, seats = _parse_bulk(request.data, require_count=True)
        with transaction.atomic():
            tables = _create_tables(merchant, area, count, prefix, start, seats)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    _audit(request, merchant, "table_area_update", "table_area", area.id, event="tables_added", tables=count)
    return Response(TableSerializer(tables, many=True).data, status=201)


# ── Tables ────────────────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def tables(request):
    """GET list tables · POST create one table."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied

    if request.method == "GET":
        qs = MerchantTable.objects.filter(merchant=merchant).select_related("area").order_by("table_number")
        area_id = request.query_params.get("area")
        if area_id:
            qs = qs.filter(area_id=area_id)
        visible = _visible_area_ids(request, merchant)
        if visible is not None:
            qs = qs.filter(area_id__in=visible)
        return Response(TableSerializer(qs, many=True).data)

    serializer = TableSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data
    area = data.get("area")
    if area is not None and area.merchant_id != merchant.id:
        return Response({"error": "Area not found."}, status=400)
    number = data.get("table_number")
    if number is None:
        number = _next_table_number(merchant)
    elif MerchantTable.objects.filter(merchant=merchant, table_number=number).exists():
        return Response({"error": f"Table number {number} already exists."}, status=400)
    if _name_taken(merchant, data["name"]):
        return Response({"error": f"You already have a table called “{data['name']}”."}, status=400)
    table = serializer.save(merchant=merchant, area=area or default_area(merchant), table_number=number)
    return Response(TableSerializer(table).data, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def table_detail(request, pk):
    """PATCH rename, move to another area, change seats, switch on/off.

    The QR token is never touched here.
    """
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    table = MerchantTable.objects.filter(pk=pk, merchant=merchant).select_related("area").first()
    if table is None:
        return Response({"error": "Table not found."}, status=404)
    visible = _visible_area_ids(request, merchant)
    if visible is not None and table.area_id not in visible:
        return Response({"error": "You don't have access to this table."}, status=403)

    serializer = TableSerializer(table, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data

    number = data.get("table_number")
    if number is not None and number != table.table_number and MerchantTable.objects.filter(
        merchant=merchant, table_number=number
    ).exclude(pk=pk).exists():
        return Response({"error": f"Table number {number} already exists."}, status=400)
    if "name" in data and _name_taken(merchant, data["name"], exclude_id=table.pk):
        return Response({"error": f"You already have a table called “{data['name']}”."}, status=400)
    new_area = data.get("area", table.area)
    if "area" in data:
        if new_area is None:
            return Response({"error": "Choose an area for this table."}, status=400)
        if new_area.merchant_id != merchant.id:
            return Response({"error": "Area not found."}, status=400)
    if data.get("is_active") is False and table.is_active and _open_orders([table.id]).exists():
        return Response({"error": "This table has an open order. Close the order first."}, status=400)

    old_area = table.area
    table = serializer.save()  # public_token is read-only: the QR never changes here
    if "area" in data and (old_area.id if old_area else None) != table.area_id:
        _audit(
            request, merchant, "table_move", "table", table.id, table=table.name,
            from_area=old_area.name if old_area else "", to_area=table.area.name,
        )
    return Response(TableSerializer(table).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def table_delete(request, pk):
    """Remove a table. Tables with order history are switched off, not deleted."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    table = MerchantTable.objects.filter(pk=pk, merchant=merchant).first()
    if table is None:
        return Response({"error": "Table not found."}, status=404)
    if _open_orders([table.id]).exists():
        return Response({"error": "This table has an open order. Close the order first."}, status=400)
    from orders.models import Order

    if Order.objects.filter(table=table).exists():
        table.is_active = False
        table.save(update_fields=["is_active", "updated_at"])
        return Response({"result": "hidden"})
    table.delete()
    return Response(status=204)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def tables_generate(request):
    """POST bulk-generate tables (older clients). New tables join the default area."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    count = request.data.get("count")
    name_prefix = request.data.get("name_prefix", "Table")
    if not isinstance(count, int) or count < 1 or count > MAX_BULK_TABLES:
        return Response({"error": "Count must be an integer between 1 and 200."}, status=400)
    with transaction.atomic():
        area = default_area(merchant)
        first = _next_table_number(merchant)
        created = [
            MerchantTable(merchant=merchant, area=area, name=f"{name_prefix} {first + i}", table_number=first + i)
            for i in range(count)
        ]
        MerchantTable.objects.bulk_create(created)
    return Response(TableSerializer(created, many=True).data, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def table_regenerate_qr(request, pk):
    """POST explicitly replace a table's QR token (the only way it changes)."""
    merchant, denied = _merchant_or_403(request)
    if denied:
        return denied
    table = MerchantTable.objects.filter(pk=pk, merchant=merchant).first()
    if table is None:
        return Response({"error": "Table not found."}, status=404)
    table.regenerate_token()
    return Response(TableSerializer(table).data)
