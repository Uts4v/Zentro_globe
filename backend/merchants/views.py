# merchants/views.py
"""
Endpoints:
  GET    /api/merchants/                              — list all merchants (public)
  GET    /api/merchants/nearby/                       — nearby merchants (public)
  GET    /api/merchants/<id>/                         — merchant detail (public)
  GET    /api/merchants/slug/<slug>/                  — merchant by slug (public)
  GET    /api/merchants/me/                           — authenticated merchant's own profile
  PATCH  /api/merchants/me/update/                    — update own profile
  GET    /api/merchants/<id>/menu/                    — public menu for a merchant
  GET    /api/merchants/menu-items/                   — merchant's own items
  GET    /api/merchants/menu-items/my-items/          — merchant's own items (all)
  POST   /api/merchants/menu-items/                   — merchant creates item
  GET    /api/merchants/menu-items/<id>/              — item detail
  PATCH  /api/merchants/menu-items/<id>/              — merchant updates item
  DELETE /api/merchants/menu-items/<id>/              — merchant deletes item
  PATCH  /api/merchants/menu-items/<id>/toggle-availability/
  GET    /api/merchants/analytics/                    — merchant analytics summary
"""

import io
import base64
import math
import os
import uuid as uuid_module
from datetime import date, datetime, timedelta, time as dt_time
from zoneinfo import ZoneInfo

import qrcode
try:
    import pymupdf as fitz
except ImportError:  # older pymupdf versions expose the classic `fitz` alias
    import fitz
from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db.models import Avg, Count, Min, Sum
from django.db.models.functions import ExtractHour, TruncDate
from django.http import FileResponse, HttpResponse, JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.clickjacking import xframe_options_exempt

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import MerchantProfile, MenuItem, MerchantTable
from .serializers import (
    MenuItemSerializer,
    MerchantProfileSerializer,
    MerchantPublicSerializer,
    MerchantDiscoverySerializer,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_merchant(user) -> MerchantProfile:
    try:
        return user.merchant_profile
    except MerchantProfile.DoesNotExist:
        raise PermissionError("No merchant profile found for this user.")


def _generate_qr(slug: str, request) -> str:
    """Generate a base64 QR code PNG pointing to the public merchant page."""
    frontend_url = getattr(settings, "FRONTEND_URL", f"{request.scheme}://{request.get_host()}")
    customer_url = f"{frontend_url.rstrip('/')}/m/{slug}"
    qr_img = qrcode.make(customer_url)
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def _haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance between two lat/lng points, in kilometers."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


# ── Merchant profile ──────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([AllowAny])
def merchant_list(request):
    """GET /api/merchants/ — all approved merchants (public)."""
    data = cache.get_or_set(
        "zentro:merchants_list",
        lambda: MerchantPublicSerializer(
            MerchantProfile.objects.filter(is_approved=True).order_by("business_name"),
            many=True,
        ).data,
        120,
    )
    return Response(data)


@api_view(["GET"])
@permission_classes([AllowAny])
def merchant_discovery_nearby(request):
    """
    GET /api/merchants/nearby/?lat=<float>&lng=<float>
    Public discovery feed for the map + nearby list.
    """
    lat_param = request.query_params.get("lat")
    lng_param = request.query_params.get("lng")

    user_lat = user_lng = None
    if lat_param is not None and lng_param is not None:
        try:
            user_lat = float(lat_param)
            user_lng = float(lng_param)
        except ValueError:
            return Response(
                {"error": "lat and lng must be valid numbers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    merchants = MerchantProfile.objects.filter(is_approved=True)

    distances = {}
    if user_lat is not None and user_lng is not None:
        for m in merchants:
            if m.latitude is not None and m.longitude is not None:
                distances[m.id] = _haversine_km(
                    user_lat, user_lng, float(m.latitude), float(m.longitude)
                )
        merchants = sorted(merchants, key=lambda m: distances.get(m.id, float("inf")))
    else:
        merchants = merchants.order_by("business_name")

    serializer = MerchantDiscoverySerializer(
        merchants, many=True, context={"distances": distances}
    )
    return Response(serializer.data)


@api_view(["GET"])
@permission_classes([AllowAny])
def merchant_detail(request, pk):
    """GET /api/merchants/<id>/ — single merchant detail (public)."""
    try:
        merchant = MerchantProfile.objects.get(pk=pk)
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(
        cache.get_or_set(
            f"zentro:pk:{pk}",
            lambda: MerchantPublicSerializer(merchant).data,
            120,
        )
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def merchant_by_slug(request, slug):
    """GET /api/merchants/slug/<slug>/ — public merchant page by slug."""
    try:
        merchant = MerchantProfile.objects.get(slug=slug)
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(
        cache.get_or_set(
            f"zentro:slug:{slug}",
            lambda: MerchantPublicSerializer(merchant).data,
            120,
        )
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merchant_me(request):
    """GET /api/merchants/me/ — authenticated merchant's full profile."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)
    return Response(MerchantProfileSerializer(merchant).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def merchant_update(request):
    """PATCH /api/merchants/me/update/ — update authenticated merchant's profile."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    serializer = MerchantProfileSerializer(merchant, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    instance = serializer.save()

    # Auto-generate slug from business_name if slug still empty after save
    if not instance.slug and instance.business_name:
        base_slug = slugify(instance.business_name)
        slug = base_slug
        counter = 1
        while MerchantProfile.objects.filter(slug=slug).exclude(pk=instance.pk).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        instance.slug = slug
        instance.save(update_fields=["slug"])

    # Generate QR code once slug is set and no QR exists yet
    if instance.slug and not instance.qr_code:
        instance.qr_code = _generate_qr(instance.slug, request)
        instance.save(update_fields=["qr_code"])

    return Response(MerchantProfileSerializer(instance).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merchant_regenerate_qr(request):
    """POST /api/merchants/me/regenerate-qr/ — force-regenerate the merchant QR code."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    if not merchant.slug:
        return Response({"error": "Merchant slug not set."}, status=status.HTTP_400_BAD_REQUEST)

    merchant.qr_code = _generate_qr(merchant.slug, request)
    merchant.save(update_fields=["qr_code"])
    return Response({"qr_code": merchant.qr_code})


@api_view(["GET"])
@permission_classes([AllowAny])
def merchant_menu(request, pk):
    """GET /api/merchants/<id>/menu/ — public menu for a specific merchant."""
    try:
        merchant = MerchantProfile.objects.get(pk=pk)
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)
    items = merchant.menu_items.filter(is_available=True).order_by("category", "name")
    return Response(
        cache.get_or_set(
            f"zentro:menu:{pk}",
            lambda: MenuItemSerializer(items, many=True).data,
            120,
        )
    )


# ── Menu items ────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_menu_items(request):
    """GET /api/merchants/menu-items/my-items/ — merchant's full menu (all items)."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    items = MenuItem.objects.filter(merchant=merchant).order_by("category", "name")
    return Response(MenuItemSerializer(items, many=True).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def menu_item_list_create(request):
    """
    GET  /api/merchants/menu-items/ — merchant's items
    POST /api/merchants/menu-items/ — create new item
    """
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        items = MenuItem.objects.filter(merchant=merchant).order_by("category", "name")
        return Response(MenuItemSerializer(items, many=True).data)

    serializer = MenuItemSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save(merchant=merchant)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def menu_item_detail(request, pk):
    """
    GET    /api/merchants/menu-items/<id>/
    PATCH  /api/merchants/menu-items/<id>/
    DELETE /api/merchants/menu-items/<id>/
    """
    try:
        item = MenuItem.objects.get(pk=pk)
    except MenuItem.DoesNotExist:
        return Response({"error": "Menu item not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(MenuItemSerializer(item).data)

    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    if item.merchant != merchant:
        return Response(
            {"error": "You can only edit your own menu items."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "DELETE":
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = MenuItemSerializer(item, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    return Response(serializer.data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def toggle_availability(request, pk):
    """PATCH /api/merchants/menu-items/<id>/toggle-availability/"""
    try:
        item = MenuItem.objects.get(pk=pk)
    except MenuItem.DoesNotExist:
        return Response({"error": "Menu item not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    if item.merchant != merchant:
        return Response({"error": "Not your item."}, status=status.HTTP_403_FORBIDDEN)

    item.is_available = not item.is_available
    item.save(update_fields=["is_available", "updated_at"])
    return Response(MenuItemSerializer(item).data)


# ── Analytics ─────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merchant_analytics(request):
    """GET /api/merchants/analytics/?days=30
    or  /api/merchants/analytics/?date_from=2025-01-01&date_to=2025-01-31

    Returns a rich analytics summary computed in the merchant's local timezone:
    KPIs, filled daily series, today/yesterday, hourly velocity, status /
    fulfillment / type / source / payment breakdowns, top items & customers,
    new vs returning customers and loyalty stats.
    """
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    raw_date_from = request.query_params.get("date_from")
    raw_date_to = request.query_params.get("date_to")

    try:
        days = max(1, min(int(request.query_params.get("days", 30)), 90))
    except (TypeError, ValueError):
        days = 30

    from orders.models import Order, OrderItem

    tz = ZoneInfo(merchant.timezone or "Asia/Kathmandu")
    now_local = timezone.localtime(timezone.now(), tz)
    local_today = now_local.date()

    day_start = lambda d: datetime.combine(d, dt_time.min).replace(tzinfo=tz)

    today_start = day_start(local_today)
    yesterday_start = today_start - timedelta(days=1)

    # Support explicit date_from / date_to or fall back to days parameter.
    d_from = d_to = None
    if raw_date_from and raw_date_to:
        try:
            d_from = date.fromisoformat(str(raw_date_from))
            d_to = date.fromisoformat(str(raw_date_to))
        except (TypeError, ValueError) as exc:
            import logging
            logging.warning("merchant_analytics: failed to parse date_from=%r date_to=%r: %s", raw_date_from, raw_date_to, exc)
            d_from = d_to = None

    if d_from is not None and d_to is not None:
        period_start = day_start(d_from)
        period_end = day_start(d_to) + timedelta(days=1)
        days = max(1, (d_to - d_from).days + 1)
    else:
        period_start = today_start - timedelta(days=days - 1)
        period_end = today_start + timedelta(days=1)

    # Heavy aggregation below — serve a short-lived cache when possible.
    analytics_key = f"zentro:analytics:{merchant.id}:{days}:{d_from or ''}:{d_to or ''}"
    cached = cache.get(analytics_key)
    if cached is not None:
        return Response(cached)

    # Non-cancelled orders define revenue/orders; cancelled orders are excluded.
    orders_qs = Order.objects.filter(
        merchant=merchant,
        created_at__gte=period_start,
        created_at__lt=period_end,
    ).exclude(status=Order.STATUS_CANCELLED)

    agg = orders_qs.aggregate(
        total_revenue=Sum("total_amount"),
        total_orders=Count("id"),
        avg_order_value=Avg("total_amount"),
    )

    # ── Daily series (every calendar day in the period, zeros filled) ─────────
    daily_rows = (
        orders_qs
        .annotate(date=TruncDate("created_at", tzinfo=tz))
        .values("date")
        .annotate(revenue=Sum("total_amount"), orders=Count("id"))
    )
    daily_map = {r["date"]: r for r in daily_rows}
    daily_revenue = []
    for i in range(days):
        d = period_start.date() + timedelta(days=i)
        row = daily_map.get(d) or {}
        daily_revenue.append({
            "date": str(d),
            "revenue": float(row.get("revenue") or 0),
            "orders": int(row.get("orders") or 0),
        })

    def _day_summary(start):
        sub = orders_qs.filter(created_at__gte=start, created_at__lt=start + timedelta(days=1))
        s = sub.aggregate(revenue=Sum("total_amount"), orders=Count("id"))
        return {"revenue": float(s["revenue"] or 0), "orders": int(s["orders"] or 0)}

    today = _day_summary(today_start)
    yesterday = _day_summary(yesterday_start)

    # ── Hourly velocity (today) + busiest hours (whole period) ────────────────
    def _hourly_series(qs):
        rows = (
            qs
            .annotate(hour=ExtractHour("created_at", tzinfo=tz))
            .values("hour")
            .annotate(count=Count("id"))
        )
        counts = {r["hour"]: int(r["count"]) for r in rows}
        return [{"hour": h, "count": counts.get(h, 0)} for h in range(24)]

    hourly_velocity = _hourly_series(
        orders_qs.filter(created_at__gte=today_start, created_at__lt=today_start + timedelta(days=1))
    )
    busiest_hours = _hourly_series(orders_qs)

    # ── Top items ─────────────────────────────────────────────────────────────
    top_items = (
        OrderItem.objects
        .filter(order__merchant=merchant, order__created_at__gte=period_start, order__created_at__lt=period_end)
        .exclude(order__status=Order.STATUS_CANCELLED)
        .values("name")
        .annotate(total_qty=Sum("quantity"), total_revenue=Sum("subtotal"))
        .order_by("-total_qty")[:10]
    )

    # ── Top customers ─────────────────────────────────────────────────────────
    top_customers = (
        orders_qs
        .exclude(customer=None)
        .values("customer__full_name", "customer__user__email")
        .annotate(order_count=Count("id"), total_spent=Sum("total_amount"))
        .order_by("-order_count", "-total_spent")[:10]
    )

    # ── Status breakdown (all statuses, including cancelled) ──────────────────
    status_rows = (
        Order.objects
        .filter(merchant=merchant, created_at__gte=period_start, created_at__lt=period_end)
        .values("status")
        .annotate(count=Count("id"))
    )
    status_map = {r["status"]: int(r["count"]) for r in status_rows}
    orders_by_status = {code: status_map.get(code, 0) for code, _ in Order.STATUS_CHOICES}

    def _breakdown(field, choices):
        rows = (
            orders_qs
            .values(field)
            .annotate(count=Count("id"))
        )
        counts = {r[field]: int(r["count"]) for r in rows}
        return {code: counts.get(code, 0) for code, _ in choices}

    orders_by_fulfillment = _breakdown("fulfillment_type", Order.FULFILLMENT_CHOICES)
    orders_by_type = _breakdown("order_type", Order.ORDER_TYPE_CHOICES)
    orders_by_source = _breakdown("source", Order.SOURCE_CHOICES)

    payment_rows = (
        orders_qs
        .exclude(payment_method="")
        .values("payment_method")
        .annotate(count=Count("id"), amount=Sum("total_amount"))
        .order_by("-amount")
    )
    orders_by_payment = [
        {
            "method": r["payment_method"],
            "count": int(r["count"]),
            "revenue": float(r["amount"] or 0),
        }
        for r in payment_rows
    ]

    # ── Customer health ───────────────────────────────────────────────────────
    customer_orders = orders_qs.exclude(customer=None)
    total_customers = customer_orders.values("customer").distinct().count()
    new_customers = (
        customer_orders
        .values("customer")
        .annotate(first=Min("created_at"))
        .filter(first__gte=period_start)
        .count()
    )
    returning_customers = max(total_customers - new_customers, 0)
    guest_orders = orders_qs.filter(customer=None).count()

    # ── Weekly comparison ─────────────────────────────────────────────────────
    week_start = local_today - timedelta(days=local_today.weekday())
    prev_week_start = week_start - timedelta(days=7)

    def _week_summary(start):
        s = orders_qs.filter(created_at__gte=day_start(start), created_at__lt=day_start(start) + timedelta(days=7)).aggregate(
            revenue=Sum("total_amount"), orders=Count("id")
        )
        return {"revenue": float(s["revenue"] or 0), "orders": int(s["orders"] or 0)}

    weekly = {
        "this_week": _week_summary(week_start),
        "last_week": _week_summary(prev_week_start),
    }

    # ── Loyalty ───────────────────────────────────────────────────────────────
    from loyalty.models import CustomerMerchantWallet, PointTransaction, Redemption

    active_members = CustomerMerchantWallet.objects.filter(merchant=merchant).count()
    points_issued = (
        PointTransaction.objects
        .filter(
            merchant=merchant,
            created_at__gte=period_start,
            created_at__lt=period_end,
            transaction_type__in=["EARNED", "MISSION_BONUS"],
        )
        .aggregate(total=Sum("points"))["total"] or 0
    )
    rewards_redeemed = Redemption.objects.filter(
        reward__merchant=merchant,
        created_at__gte=period_start,
        created_at__lt=period_end,
    ).count()
    punch_cards_redeemed = Order.objects.filter(
        merchant=merchant,
        created_at__gte=period_start,
        created_at__lt=period_end,
        order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
    ).count()

    data = {
        "period_days": days,
        "total_revenue": float(agg["total_revenue"] or 0),
        "total_orders": agg["total_orders"] or 0,
        "avg_order_value": round(float(agg["avg_order_value"] or 0), 2),
        "today": today,
        "yesterday": yesterday,
        "daily_revenue": daily_revenue,
        "hourly_velocity": hourly_velocity,
        "busiest_hours": busiest_hours,
        "top_items": list(top_items),
        "top_customers": [
            {
                "name": c["customer__full_name"] or c["customer__user__email"],
                "order_count": c["order_count"],
                "total_spent": c["total_spent"],
            }
            for c in top_customers
        ],
        "orders_by_status": orders_by_status,
        "orders_by_fulfillment": orders_by_fulfillment,
        "orders_by_type": orders_by_type,
        "orders_by_source": orders_by_source,
        "orders_by_payment": orders_by_payment,
        "customers": {
            "total_customers": total_customers,
            "new_customers": new_customers,
            "returning_customers": returning_customers,
            "guest_orders": guest_orders,
        },
        "weekly": weekly,
        "loyalty": {
            "active_members": active_members,
            "points_issued": float(points_issued),
            "rewards_redeemed": rewards_redeemed,
            "punch_cards_redeemed": punch_cards_redeemed,
        },
    }
    cache.set(analytics_key, data, 120)
    return Response(data)


# ── Table management ──────────────────────────────────────────────────────────

from django.db import transaction as db_transaction
from rest_framework import serializers as _serializers


class _TableSerializer(_serializers.ModelSerializer):
    class Meta:
        model = MerchantTable
        fields = [
            "id", "name", "table_number", "public_token",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "public_token", "created_at", "updated_at"]


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merchant_tables(request):
    """GET /api/merchants/tables/ — list merchant's tables."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    tables = MerchantTable.objects.filter(merchant=merchant).order_by("table_number")
    return Response(_TableSerializer(tables, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merchant_tables_create(request):
    """POST /api/merchants/tables/ — create a single table."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    serializer = _TableSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Prevent duplicate table numbers
    table_number = serializer.validated_data["table_number"]
    if MerchantTable.objects.filter(merchant=merchant, table_number=table_number).exists():
        return Response(
            {"error": f"Table number {table_number} already exists."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer.save(merchant=merchant)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def merchant_table_detail(request, pk):
    """PATCH /api/merchants/tables/{id}/ — update a table."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    try:
        table = MerchantTable.objects.get(pk=pk, merchant=merchant)
    except MerchantTable.DoesNotExist:
        return Response({"error": "Table not found."}, status=status.HTTP_404_NOT_FOUND)

    serializer = _TableSerializer(table, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    # Check for duplicate table number if changing
    new_number = serializer.validated_data.get("table_number")
    if new_number is not None and new_number != table.table_number:
        if MerchantTable.objects.filter(
            merchant=merchant, table_number=new_number
        ).exclude(pk=pk).exists():
            return Response(
                {"error": f"Table number {new_number} already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    serializer.save()
    return Response(serializer.data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def merchant_table_delete(request, pk):
    """DELETE /api/merchants/tables/{id}/ — delete a table."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    try:
        table = MerchantTable.objects.get(pk=pk, merchant=merchant)
    except MerchantTable.DoesNotExist:
        return Response({"error": "Table not found."}, status=status.HTTP_404_NOT_FOUND)

    table.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merchant_tables_generate(request):
    """POST /api/merchants/tables/generate/ — bulk-generate tables."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    count = request.data.get("count")
    name_prefix = request.data.get("name_prefix", "Table")

    if not isinstance(count, int) or count < 1 or count > 200:
        return Response(
            {"error": "Count must be an integer between 1 and 200."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Find the highest existing table number
    max_number = (
        MerchantTable.objects.filter(merchant=merchant)
        .order_by("-table_number")
        .values_list("table_number", flat=True)
        .first()
    ) or 0

    with db_transaction.atomic():
        tables = []
        for i in range(1, count + 1):
            num = max_number + i
            name = f"{name_prefix} {num}"
            tables.append(
                MerchantTable(
                    merchant=merchant,
                    name=name,
                    table_number=num,
                )
            )
        MerchantTable.objects.bulk_create(tables)

    return Response(
        _TableSerializer(tables, many=True).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merchant_table_regenerate_qr(request, pk):
    """POST /api/merchants/tables/{id}/regenerate-qr/ — regenerate QR token."""
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    try:
        table = MerchantTable.objects.get(pk=pk, merchant=merchant)
    except MerchantTable.DoesNotExist:
        return Response({"error": "Table not found."}, status=status.HTTP_404_NOT_FOUND)

    table.regenerate_token()
    return Response(_TableSerializer(table).data)


# ── Public table resolution ───────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([AllowAny])
def public_resolve_table(request, slug, public_token):
    """
    GET /api/public/merchants/{slug}/tables/{public_token}/
    Resolves a public table QR token to merchant + table info.
    """
    try:
        merchant = MerchantProfile.objects.get(slug=slug, is_approved=True)
    except MerchantProfile.DoesNotExist:
        return Response(
            {"error": "Merchant not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    if not merchant.table_ordering_enabled:
        return Response(
            {"error": "Table ordering is not enabled for this merchant."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        table = MerchantTable.objects.get(
            public_token=public_token,
            merchant=merchant,
            is_active=True,
        )
    except MerchantTable.DoesNotExist:
        return Response(
            {"error": "Invalid or inactive table QR code."},
            status=status.HTTP_404_NOT_FOUND,
        )

    return Response({
        "merchant": {
            "id": merchant.id,
            "name": merchant.business_name,
            "slug": merchant.slug,
            "logo": merchant.logo_url,
        },
        "table": {
            "id": table.id,
            "name": table.name,
            "table_number": table.table_number,
            "public_token": table.public_token,
        },
    })


# ── PDF Menu ─────────────────────────────────────────────────────────────────

@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated])
def merchant_pdf_menu(request):
    """
    GET    /api/merchants/pdf-menu/             — fetch current PDF menu + QR info
    POST   /api/merchants/pdf-menu/             — upload/replace PDF menu (multipart, field="file")
    DELETE /api/merchants/pdf-menu/             — remove the PDF menu
    """
    try:
        merchant = _get_merchant(request.user)
    except PermissionError as e:
        return Response({"error": str(e)}, status=status.HTTP_403_FORBIDDEN)

    if not merchant.slug:
        return Response({"error": "Merchant slug not set."}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == "GET":
        return Response(_pdf_menu_payload(merchant, request))

    if request.method == "DELETE":
        if merchant.pdf_menu_url:
            _delete_pdf_menu_file(merchant.pdf_menu_url, merchant.pdf_menu_page_count)
        merchant.pdf_menu_url = ""
        merchant.pdf_menu_page_count = 0
        merchant.save(update_fields=["pdf_menu_url", "pdf_menu_page_count", "updated_at"])
        return Response(_pdf_menu_payload(merchant, request), status=status.HTTP_200_OK)

    # POST — upload/replace
    file = request.FILES.get("file")
    if not file:
        return Response({"error": "No file provided. Use multipart field 'file'."},
                        status=status.HTTP_400_BAD_REQUEST)

    content_type = (file.content_type or "").lower()
    if content_type != "application/pdf":
        return Response({"error": "Only PDF files are allowed."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Remove any previous PDF to avoid orphaned files
    if merchant.pdf_menu_url:
        _delete_pdf_menu_file(merchant.pdf_menu_url, merchant.pdf_menu_page_count)

    filename = f"menus/{uuid_module.uuid4().hex}.pdf"
    saved_path = default_storage.save(filename, ContentFile(file.read()))
    file_url = request.build_absolute_uri(settings.MEDIA_URL + saved_path)

    merchant.pdf_menu_url = file_url
    merchant.pdf_menu_page_count = _render_pdf_menu_pages(saved_path, request, merchant)
    merchant.save(update_fields=["pdf_menu_url", "pdf_menu_page_count", "updated_at"])

    return Response(_pdf_menu_payload(merchant, request), status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([AllowAny])
def public_pdf_menu(request, slug, public_token):
    """
    GET /api/merchants/public/{slug}/pdf-menu/{public_token}/
    Public resolution for a PDF-menu QR code. Returns the merchant + PDF URL,
    or a friendly error when no PDF has been uploaded yet.
    """
    try:
        merchant = MerchantProfile.objects.get(slug=slug, is_approved=True)
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if merchant.pdf_menu_token != public_token:
        return Response({"error": "Invalid or expired PDF menu QR code."},
                        status=status.HTTP_404_NOT_FOUND)

    if not merchant.pdf_menu_url:
        return Response({
            "merchant": {
                "id": merchant.id,
                "name": merchant.business_name,
                "slug": merchant.slug,
                "logo": merchant.logo_url,
            },
            "has_pdf": False,
            "pdf_url": None,
            "pages": [],
        }, status=status.HTTP_200_OK)

    return Response({
        "merchant": {
            "id": merchant.id,
            "name": merchant.business_name,
            "slug": merchant.slug,
            "logo": merchant.logo_url,
            "address": merchant.address,
            "phone": merchant.phone,
        },
        "has_pdf": True,
        "pdf_url": _pdf_menu_file_url(request, merchant),
        "pages": [
            {"index": i, "url": url}
            for i, url in enumerate(_pdf_menu_page_urls(request, merchant))
        ],
    })


@xframe_options_exempt
def public_pdf_menu_file(request, slug, public_token):
    """
    GET /api/merchants/public/{slug}/pdf-menu/{public_token}/file/
    Streams the merchant's PDF menu so the browser can embed it in a frame
    (X-Frame-Options is stripped via xframe_options_exempt). Requires the
    QR token so files aren't publicly enumerable.
    """
    try:
        merchant = MerchantProfile.objects.get(slug=slug, is_approved=True)
    except MerchantProfile.DoesNotExist:
        return JsonResponse({"error": "Merchant not found."}, status=404)

    if merchant.pdf_menu_token != public_token:
        return JsonResponse({"error": "Invalid or expired PDF menu QR code."}, status=404)

    if not merchant.pdf_menu_url:
        return JsonResponse({"error": "No PDF menu uploaded yet."}, status=404)

    rel = merchant.pdf_menu_url.split(settings.MEDIA_URL, 1)[1] if settings.MEDIA_URL in merchant.pdf_menu_url else None
    if not rel:
        return JsonResponse({"error": "PDF file missing."}, status=404)

    try:
        pdf_file = default_storage.open(rel)
    except FileNotFoundError:
        return JsonResponse({"error": "PDF file missing."}, status=404)

    if request.GET.get("download"):
        response = FileResponse(pdf_file, content_type="application/pdf")
        response["Content-Disposition"] = "attachment; filename=menu.pdf"
    else:
        response = FileResponse(pdf_file, content_type="application/pdf")
        response["Content-Disposition"] = "inline; filename=menu.pdf"
    response["Cache-Control"] = "public, max-age=86400"
    return response


def _pdf_menu_file_url(request, merchant) -> str:
    """Absolute URL of the embeddable PDF streaming endpoint."""
    if not merchant.pdf_menu_url:
        return None
    return request.build_absolute_uri(
        reverse("public-pdf-menu-file", kwargs={
            "slug": merchant.slug,
            "public_token": merchant.pdf_menu_token,
        })
    )


def _render_pdf_menu_pages(pdf_rel_path, request, merchant):
    """
    Render the merchant's PDF menu into per-page JPEG images (scaled ~2x / ~144dpi)
    so phones can view the menu inline like a photo gallery — avoiding the browser's
    PDF 'Open' prompt on iOS. Returns the number of pages rendered (0 on failure).
    """
    try:
        opened = default_storage.open(pdf_rel_path, "rb")
    except FileNotFoundError:
        return 0

    base_name = pdf_rel_path[:-4] if pdf_rel_path.endswith(".pdf") else pdf_rel_path
    count = 0
    try:
        with fitz.open(stream=opened.read(), filetype="pdf") as doc:
            count = doc.page_count
            matrix = fitz.Matrix(2.0, 2.0)  # ~144dpi for crisp text on phones
            for i in range(count):
                pix = doc.load_page(i).get_pixmap(matrix=matrix)
                default_storage.save(f"{base_name}_p{i}.jpg", ContentFile(pix.tobytes("jpeg")))
    except Exception:
        # Never break the upload if rendering fails — the PDF embed remains as a fallback.
        return 0
    finally:
        opened.close()
    return count


def _pdf_menu_page_urls(request, merchant):
    """Absolute URLs of the image-rendered pages of the merchant's PDF menu."""
    if not merchant.pdf_menu_url or merchant.pdf_menu_page_count <= 0:
        return []
    rel = merchant.pdf_menu_url.split(settings.MEDIA_URL, 1)[1] if settings.MEDIA_URL in merchant.pdf_menu_url else None
    if not rel or not rel.endswith(".pdf"):
        return []
    base = rel[:-4]
    return [
        request.build_absolute_uri(f"{settings.MEDIA_URL}{base}_p{i}.jpg")
        for i in range(merchant.pdf_menu_page_count)
    ]


def _pdf_menu_payload(merchant, request):
    frontend_url = getattr(settings, "FRONTEND_URL", f"{request.scheme}://{request.get_host()}")
    pdf_menu_page_url = f"{frontend_url.rstrip('/')}/m/{merchant.slug}/pdf-menu/{merchant.pdf_menu_token}"
    return {
        "has_pdf": bool(merchant.pdf_menu_url),
        "pdf_url": _pdf_menu_file_url(request, merchant) or None,
        "pdf_menu_token": merchant.pdf_menu_token,
        "pdf_menu_page_url": pdf_menu_page_url,
    }


def _delete_pdf_menu_file(file_url, page_count=0):
    """Best-effort removal of a previously stored PDF menu file and its rendered pages."""
    try:
        if file_url and settings.MEDIA_URL in file_url:
            rel = file_url.split(settings.MEDIA_URL, 1)[1]
            default_storage.delete(rel)
            if rel.endswith(".pdf") and page_count > 0:
                base = rel[:-4]
                default_storage.delete([f"{base}_p{i}.jpg" for i in range(page_count)])
    except Exception:
        pass