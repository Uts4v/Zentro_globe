"""
pos/reporting_views.py — Centralized reporting, analytics, fiscal reports, and export endpoints.

Mounted at /api/pos/reports/...
"""

import io
import csv
from datetime import datetime, date, timedelta, time as dt_time
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Sum, Count, Q, Avg, F, DecimalField
from django.db.models.functions import TruncDate
from django.http import HttpResponse, JsonResponse
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem
from .models import PosPayment, PosDiscount, PosCashMovement, ReportHistory
from .permissions import IsMerchantUser, IsPosEnabled


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_merchant(request):
    try:
        return request.user.merchant_profile
    except (AttributeError, MerchantProfile.DoesNotExist):
        return None


def _parse_date_param(value, default=None):
    """Parse a YYYY-MM-DD date string."""
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return default


def _merchant_tz(merchant):
    return ZoneInfo(merchant.timezone or "Asia/Kathmandu")


def _date_range(request, merchant):
    """Extract date_from / date_to from query params, defaulting to last 30 days."""
    tz = _merchant_tz(merchant)
    now_local = timezone.localtime(timezone.now(), tz)
    default_from = (now_local - timedelta(days=29)).date()
    default_to = now_local.date()

    date_from = _parse_date_param(request.query_params.get("date_from"), default_from)
    date_to = _parse_date_param(request.query_params.get("date_to"), default_to)
    return date_from, date_to


def _build_base_qs(merchant, date_from, date_to, extra_filters=None):
    """Build the base Order queryset for a date range."""
    tz = _merchant_tz(merchant)
    start_dt = datetime.combine(date_from, dt_time.min).replace(tzinfo=tz)
    end_dt = datetime.combine(date_to + timedelta(days=1), dt_time.min).replace(tzinfo=tz)

    qs = Order.objects.filter(
        merchant=merchant,
        created_at__gte=start_dt,
        created_at__lt=end_dt,
    )

    if extra_filters:
        qs = qs.filter(**extra_filters)

    return qs


def _is_online_method(method):
    """Check if a payment method counts as 'online'."""
    return method in ("card", "bank_qr", "mobile_wallet")


def _get_tax_label(merchant):
    """Return the display label for the merchant's tax configuration."""
    if not merchant.tax_components:
        return ""
    names = [c.get("name", "Tax") for c in merchant.tax_components if c.get("rate", 0) > 0]
    return " + ".join(names) if names else ""


def _get_total_tax_rate(merchant):
    """Return the combined tax rate as a percentage."""
    if not merchant.tax_components:
        return 0
    return sum(float(c.get("rate", 0)) for c in merchant.tax_components if c.get("rate", 0) > 0)


# ══════════════════════════════════════════════════════════════════════════════
# SALES REPORT
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def sales_report(request):
    """
    GET /api/pos/reports/sales/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&payment_method=...

    Returns a comprehensive sales report.
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    payment_filter = request.query_params.get("payment_method", "")
    category_filter = request.query_params.get("category", "")
    product_filter = request.query_params.get("product", "")

    # Non-cancelled orders for revenue
    qs = _build_base_qs(merchant, date_from, date_to)

    # Apply payment method filter
    if payment_filter:
        if payment_filter == "cash":
            qs = qs.filter(payment_method="cash")
        elif payment_filter == "online":
            qs = qs.exclude(payment_method__in=["cash", ""]).exclude(payment_method="")
        elif payment_filter in ("card", "bank_qr", "mobile_wallet", "credit", "debit"):
            qs = qs.filter(payment_method=payment_filter)

    active_qs = qs.exclude(status=Order.STATUS_CANCELLED)

    # ── Overview metrics ──────────────────────────────────────────────────────
    agg = active_qs.aggregate(
        total_sales=Sum("total_amount"),
        total_orders=Count("id"),
        avg_order=Avg("total_amount"),
        total_tax=Sum("tax_amount"),
        total_discount=Sum("discount_amount"),
        total_subtotal=Sum("subtotal"),
    )

    total_sales = float(agg["total_sales"] or 0)
    total_orders = int(agg["total_orders"] or 0)
    avg_order = float(agg["avg_order"] or 0)
    total_tax = float(agg["total_tax"] or 0)
    total_discount = float(agg["total_discount"] or 0)
    total_subtotal = float(agg["total_subtotal"] or 0)
    net_sales = total_sales - total_discount

    # ── Refunds ───────────────────────────────────────────────────────────────
    refund_qs = active_qs.filter(payment_status="refunded")
    refund_agg = refund_qs.aggregate(
        refund_count=Count("id"),
        refund_amount=Sum("total_amount"),
    )
    refund_count = int(refund_agg["refund_count"] or 0)
    refund_amount = float(refund_agg["refund_amount"] or 0)
    net_sales_after_refunds = net_sales - refund_amount

    # ── Unique customers ──────────────────────────────────────────────────────
    total_customers = active_qs.exclude(customer=None).values("customer").distinct().count()
    guest_orders = active_qs.filter(customer=None).count()

    # ── Cash vs Online ────────────────────────────────────────────────────────
    cash_qs = active_qs.filter(payment_method="cash")
    online_methods = ["card", "bank_qr", "mobile_wallet"]
    online_qs = active_qs.filter(payment_method__in=online_methods)

    cash_agg = cash_qs.aggregate(
        count=Count("id"),
        total=Sum("total_amount"),
    )
    online_agg = online_qs.aggregate(
        count=Count("id"),
        total=Sum("total_amount"),
    )

    cash_count = int(cash_agg["count"] or 0)
    cash_total = float(cash_agg["total"] or 0)
    online_count = int(online_agg["count"] or 0)
    online_total = float(online_agg["total"] or 0)

    cash_percentage = round((cash_total / total_sales * 100), 1) if total_sales > 0 else 0
    online_percentage = round((online_total / total_sales * 100), 1) if total_sales > 0 else 0

    # ── Payment method breakdown ──────────────────────────────────────────────
    payment_methods = (
        active_qs
        .exclude(payment_method="")
        .values("payment_method")
        .annotate(
            count=Count("id"),
            total=Sum("total_amount"),
        )
        .order_by("-total")
    )
    payment_breakdown = []
    for pm in payment_methods:
        amt = float(pm["total"] or 0)
        payment_breakdown.append({
            "method": pm["payment_method"],
            "count": int(pm["count"]),
            "amount": amt,
            "percentage": round((amt / total_sales * 100), 1) if total_sales > 0 else 0,
        })

    # ── Daily trend ───────────────────────────────────────────────────────────
    daily_rows = (
        active_qs
        .annotate(date=TruncDate("created_at", tzinfo=_merchant_tz(merchant)))
        .values("date")
        .annotate(
            revenue=Sum("total_amount"),
            orders=Count("id"),
            tax=Sum("tax_amount"),
            discount=Sum("discount_amount"),
        )
        .order_by("date")
    )
    daily_trend = [
        {
            "date": str(r["date"]),
            "revenue": float(r["revenue"] or 0),
            "orders": int(r["orders"]),
            "tax": float(r["tax"] or 0),
            "discount": float(r["discount"] or 0),
        }
        for r in daily_rows
    ]

    # ── Tax summary ───────────────────────────────────────────────────────────
    tax_label = _get_tax_label(merchant)
    total_tax_rate = _get_total_tax_rate(merchant)
    tax_enabled = merchant.tax_enabled

    # Taxable vs non-taxable
    taxable_sales = float(active_qs.exclude(tax_amount=0).aggregate(t=Sum("total_amount"))["t"] or 0)
    nontaxable_sales = float(active_qs.filter(tax_amount=0).aggregate(t=Sum("total_amount"))["t"] or 0)

    # ── Top items ─────────────────────────────────────────────────────────────
    item_filter = Q(order__in=active_qs)
    if category_filter:
        item_filter &= Q(order__items__name__isnull=False)
    if product_filter:
        item_filter &= Q(name__icontains=product_filter)

    top_items = (
        OrderItem.objects
        .filter(item_filter)
        .values("name")
        .annotate(
            quantity_sold=Sum("quantity"),
            revenue=Sum("subtotal"),
            order_count=Count("order", distinct=True),
        )
        .order_by("-revenue")[:20]
    )

    # ── Category breakdown ────────────────────────────────────────────────────
    # Get categories from menu items
    category_rows = (
        OrderItem.objects
        .filter(order__in=active_qs)
        .values("name")
        .annotate(
            quantity_sold=Sum("quantity"),
            revenue=Sum("subtotal"),
        )
        .order_by("-revenue")
    )

    # Group by menu item category if available
    menu_categories = {}
    for item in MenuItem.objects.filter(merchant=merchant).values("name", "category"):
        menu_categories[item["name"]] = item["category"]

    category_map = {}
    for row in category_rows:
        cat = menu_categories.get(row["name"], "Uncategorized")
        if cat not in category_map:
            category_map[cat] = {"name": cat, "quantity_sold": 0, "revenue": 0}
        category_map[cat]["quantity_sold"] += int(row["quantity_sold"] or 0)
        category_map[cat]["revenue"] += float(row["revenue"] or 0)

    categories = sorted(category_map.values(), key=lambda x: x["revenue"], reverse=True)

    # ── Refund details ────────────────────────────────────────────────────────
    refund_details = (
        active_qs
        .filter(payment_status="refunded")
        .values("payment_method")
        .annotate(count=Count("id"), total=Sum("total_amount"))
        .order_by("-total")
    )

    return Response({
        "date_from": str(date_from),
        "date_to": str(date_to),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "tax_enabled": tax_enabled,
        "tax_label": tax_label,
        "tax_rate": total_tax_rate,
        "overview": {
            "total_sales": total_sales,
            "net_sales": net_sales_after_refunds,
            "total_orders": total_orders,
            "total_customers": total_customers,
            "guest_orders": guest_orders,
            "avg_order_value": round(avg_order, 2),
            "total_tax": total_tax,
            "total_discount": total_discount,
            "total_subtotal": total_subtotal,
        },
        "refunds": {
            "count": refund_count,
            "amount": refund_amount,
            "details": [
                {"method": r["payment_method"], "count": int(r["count"]), "amount": float(r["total"] or 0)}
                for r in refund_details
            ],
        },
        "cash_online": {
            "cash": {
                "count": cash_count,
                "amount": cash_total,
                "percentage": cash_percentage,
            },
            "online": {
                "count": online_count,
                "amount": online_total,
                "percentage": online_percentage,
            },
        },
        "payment_methods": payment_breakdown,
        "tax_summary": {
            "tax_enabled": tax_enabled,
            "tax_label": tax_label,
            "tax_rate": total_tax_rate,
            "taxable_sales": taxable_sales,
            "nontaxable_sales": nontaxable_sales,
            "sales_with_tax": total_subtotal + total_tax,
            "sales_excluding_tax": total_subtotal,
            "tax_collected": total_tax,
            "refund_tax": float(
                active_qs.filter(payment_status="refunded")
                .aggregate(t=Sum("tax_amount"))["t"] or 0
            ),
            "net_tax": total_tax - float(
                active_qs.filter(payment_status="refunded")
                .aggregate(t=Sum("tax_amount"))["t"] or 0
            ),
        },
        "daily_trend": daily_trend,
        "top_items": [
            {
                "name": item["name"],
                "quantity_sold": int(item["quantity_sold"] or 0),
                "revenue": float(item["revenue"] or 0),
                "order_count": int(item["order_count"] or 0),
            }
            for item in top_items
        ],
        "categories": categories,
    })


# ══════════════════════════════════════════════════════════════════════════════
# FISCAL REPORT
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def fiscal_report(request):
    """
    GET /api/pos/reports/fiscal/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Returns a comprehensive fiscal report for the selected date range.
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    qs = _build_base_qs(merchant, date_from, date_to)
    active_qs = qs.exclude(status=Order.STATUS_CANCELLED)
    cancelled_qs = qs.filter(status=Order.STATUS_CANCELLED)

    # ── Core aggregates ───────────────────────────────────────────────────────
    agg = active_qs.aggregate(
        gross_sales=Sum("total_amount"),
        total_orders=Count("id"),
        avg_order=Avg("total_amount"),
        total_tax=Sum("tax_amount"),
        total_discount=Sum("discount_amount"),
        total_subtotal=Sum("subtotal"),
        total_service_charge=Sum("service_charge"),
    )

    gross_sales = float(agg["gross_sales"] or 0)
    total_orders = int(agg["total_orders"] or 0)
    avg_order = float(agg["avg_order"] or 0)
    total_tax = float(agg["total_tax"] or 0)
    total_discount = float(agg["total_discount"] or 0)
    total_subtotal = float(agg["total_subtotal"] or 0)
    total_service_charge = float(agg["total_service_charge"] or 0)

    net_sales = gross_sales - total_discount
    sales_before_tax = total_subtotal
    sales_including_tax = total_subtotal + total_tax
    sales_excluding_tax = total_subtotal

    # Taxable sales (orders that had tax applied)
    taxable_sales = float(active_qs.exclude(tax_amount=0).aggregate(t=Sum("total_amount"))["t"] or 0)

    # ── Cancelled/Voided ──────────────────────────────────────────────────────
    cancelled_count = cancelled_qs.count()
    cancelled_amount = float(cancelled_qs.aggregate(t=Sum("total_amount"))["t"] or 0)

    # ── Refunds ───────────────────────────────────────────────────────────────
    refund_qs = active_qs.filter(payment_status="refunded")
    refund_count = refund_qs.count()
    refund_amount = float(refund_qs.aggregate(t=Sum("total_amount"))["t"] or 0)
    refund_tax = float(refund_qs.aggregate(t=Sum("tax_amount"))["t"] or 0)

    # ── Payment breakdown ─────────────────────────────────────────────────────
    payment_data = (
        active_qs
        .exclude(payment_method="")
        .values("payment_method")
        .annotate(count=Count("id"), total=Sum("total_amount"))
        .order_by("-total")
    )

    cash_total = 0
    card_total = 0
    qr_total = 0
    wallet_total = 0
    credit_total = 0
    debit_total = 0
    other_total = 0
    payment_methods = []

    for pm in payment_data:
        method = pm["payment_method"]
        amt = float(pm["total"] or 0)
        cnt = int(pm["count"] or 0)

        entry = {
            "method": method,
            "count": cnt,
            "amount": amt,
            "percentage": round((amt / gross_sales * 100), 1) if gross_sales > 0 else 0,
        }
        payment_methods.append(entry)

        if method == "cash":
            cash_total = amt
        elif method == "card":
            card_total = amt
        elif method == "bank_qr":
            qr_total = amt
        elif method == "mobile_wallet":
            wallet_total = amt
        elif method == "credit":
            credit_total = amt
        elif method == "debit":
            debit_total = amt
        else:
            other_total += amt

    online_total = card_total + qr_total + wallet_total

    # ── Tax component breakdown ───────────────────────────────────────────────
    tax_label = _get_tax_label(merchant)
    total_tax_rate = _get_total_tax_rate(merchant)
    tax_components = merchant.tax_components or []

    # ── Cash summary ──────────────────────────────────────────────────────────
    cash_movements = PosCashMovement.objects.filter(
        shift__device__merchant=merchant,
        created_at__gte=datetime.combine(date_from, dt_time.min).replace(tzinfo=_merchant_tz(merchant)),
        created_at__lt=datetime.combine(date_to + timedelta(days=1), dt_time.min).replace(tzinfo=_merchant_tz(merchant)),
    )
    total_payins = float(cash_movements.filter(movement_type="payin").aggregate(t=Sum("amount"))["t"] or 0)
    total_payouts = float(cash_movements.filter(movement_type="payout").aggregate(t=Sum("amount"))["t"] or 0)
    total_cash_drops = float(cash_movements.filter(movement_type="cashdrop").aggregate(t=Sum("amount"))["t"] or 0)

    # ── Discount breakdown ────────────────────────────────────────────────────
    discount_rows = (
        active_qs
        .exclude(discount_amount=0)
        .values("discount_type")
        .annotate(count=Count("id"), total=Sum("discount_amount"))
    )
    discount_breakdown = [
        {"type": r["discount_type"] or "other", "count": int(r["count"]), "amount": float(r["total"] or 0)}
        for r in discount_rows
    ]

    # ── Daily trend ───────────────────────────────────────────────────────────
    daily_rows = (
        active_qs
        .annotate(date=TruncDate("created_at", tzinfo=_merchant_tz(merchant)))
        .values("date")
        .annotate(
            revenue=Sum("total_amount"),
            orders=Count("id"),
            tax=Sum("tax_amount"),
            discount=Sum("discount_amount"),
            subtotal=Sum("subtotal"),
        )
        .order_by("date")
    )
    daily_trend = [
        {
            "date": str(r["date"]),
            "revenue": float(r["revenue"] or 0),
            "orders": int(r["orders"]),
            "tax": float(r["tax"] or 0),
            "discount": float(r["discount"] or 0),
            "subtotal": float(r["subtotal"] or 0),
        }
        for r in daily_rows
    ]

    return Response({
        "date_from": str(date_from),
        "date_to": str(date_to),
        "generated_at": timezone.now().isoformat(),
        "merchant": {
            "name": merchant.business_name,
            "currency_code": merchant.currency_code,
            "currency_symbol": merchant.currency_symbol,
        },
        "fiscal_summary": {
            "gross_sales": gross_sales,
            "net_sales": net_sales,
            "sales_before_tax": sales_before_tax,
            "taxable_sales": taxable_sales,
            "sales_including_tax": sales_including_tax,
            "sales_excluding_tax": sales_excluding_tax,
            "tax_collected": total_tax,
            "tax_label": tax_label,
            "tax_rate": total_tax_rate,
            "tax_components": tax_components,
            "tax_enabled": merchant.tax_enabled,
            "discounts": total_discount,
            "discount_breakdown": discount_breakdown,
            "service_charge": total_service_charge,
            "refunds": refund_amount,
            "refund_tax": refund_tax,
            "refund_count": refund_count,
            "cancelled_orders": cancelled_count,
            "cancelled_amount": cancelled_amount,
            "total_transactions": total_orders,
            "total_orders": total_orders,
            "avg_order_value": round(avg_order, 2),
        },
        "payment_breakdown": {
            "cash": cash_total,
            "card": card_total,
            "bank_qr": qr_total,
            "mobile_wallet": wallet_total,
            "credit": credit_total,
            "debit": debit_total,
            "other": other_total,
            "online_total": online_total,
            "methods": payment_methods,
        },
        "cash_summary": {
            "cash_sales": cash_total,
            "cash_refunds": float(
                active_qs.filter(payment_method="cash", payment_status="refunded")
                .aggregate(t=Sum("total_amount"))["t"] or 0
            ),
            "net_cash": cash_total - float(
                active_qs.filter(payment_method="cash", payment_status="refunded")
                .aggregate(t=Sum("total_amount"))["t"] or 0
            ),
            "payins": total_payins,
            "payouts": total_payouts,
            "cash_drops": total_cash_drops,
        },
        "online_summary": {
            "online_sales": online_total,
            "online_refunds": float(
                active_qs.filter(payment_method__in=["card", "bank_qr", "mobile_wallet"], payment_status="refunded")
                .aggregate(t=Sum("total_amount"))["t"] or 0
            ),
            "net_online": online_total - float(
                active_qs.filter(payment_method__in=["card", "bank_qr", "mobile_wallet"], payment_status="refunded")
                .aggregate(t=Sum("total_amount"))["t"] or 0
            ),
            "card": card_total,
            "bank_qr": qr_total,
            "mobile_wallet": wallet_total,
        },
        "daily_trend": daily_trend,
    })


# ══════════════════════════════════════════════════════════════════════════════
# ITEM / PRODUCT ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def item_analytics(request):
    """
    GET /api/pos/reports/items/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&payment_method=...
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    payment_filter = request.query_params.get("payment_method", "")
    category_filter = request.query_params.get("category", "")

    active_qs = _build_base_qs(merchant, date_from, date_to).exclude(status=Order.STATUS_CANCELLED)

    # Build order set with payment filter
    if payment_filter:
        if payment_filter == "cash":
            active_qs = active_qs.filter(payment_method="cash")
        elif payment_filter == "online":
            active_qs = active_qs.filter(payment_method__in=["card", "bank_qr", "mobile_wallet"])
        elif payment_filter in ("card", "bank_qr", "mobile_wallet", "credit", "debit"):
            active_qs = active_qs.filter(payment_method=payment_filter)

    # Get menu item categories
    menu_categories = {}
    for item in MenuItem.objects.filter(merchant=merchant).values("name", "category"):
        menu_categories[item["name"]] = item["category"]

    # Item-level analytics
    items = (
        OrderItem.objects
        .filter(order__in=active_qs)
        .values("name")
        .annotate(
            quantity_sold=Sum("quantity"),
            revenue=Sum("subtotal"),
            order_count=Count("order", distinct=True),
        )
        .order_by("-revenue")
    )

    # Apply category filter
    if category_filter:
        items = [
            i for i in items
            if menu_categories.get(i["name"], "Uncategorized") == category_filter
        ]

    # Payment method breakdown per item
    result_items = []
    for item in items:
        item_name = item["name"]
        # Get payment breakdown for this specific item
        item_orders = active_qs.filter(items__name=item_name)
        pm_rows = (
            item_orders
            .exclude(payment_method="")
            .values("payment_method")
            .annotate(count=Count("id"), total=Sum("total_amount"))
            .order_by("-total")
        )

        payment_breakdown = [
            {"method": pm["payment_method"], "count": int(pm["count"]), "amount": float(pm["total"] or 0)}
            for pm in pm_rows
        ]

        result_items.append({
            "name": item_name,
            "category": menu_categories.get(item_name, "Uncategorized"),
            "quantity_sold": int(item["quantity_sold"] or 0),
            "revenue": float(item["revenue"] or 0),
            "order_count": int(item["order_count"] or 0),
            "payment_breakdown": payment_breakdown,
        })

    # Category aggregates
    category_map = {}
    for ri in result_items:
        cat = ri["category"]
        if cat not in category_map:
            category_map[cat] = {"name": cat, "quantity_sold": 0, "revenue": 0, "item_count": 0}
        category_map[cat]["quantity_sold"] += ri["quantity_sold"]
        category_map[cat]["revenue"] += ri["revenue"]
        category_map[cat]["item_count"] += 1

    categories = sorted(category_map.values(), key=lambda x: x["revenue"], reverse=True)

    total_items_sold = sum(ri["quantity_sold"] for ri in result_items)
    total_revenue = sum(ri["revenue"] for ri in result_items)

    # Get available categories for filter
    available_categories = sorted(set(menu_categories.values()) | {"Uncategorized"})

    return Response({
        "date_from": str(date_from),
        "date_to": str(date_to),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "total_items_sold": total_items_sold,
        "total_revenue": total_revenue,
        "items": result_items[:50],
        "categories": categories,
        "available_categories": available_categories,
    })


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENT ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def payment_analytics(request):
    """
    GET /api/pos/reports/payments/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    active_qs = _build_base_qs(merchant, date_from, date_to).exclude(status=Order.STATUS_CANCELLED)

    # Overall payment aggregates
    agg = active_qs.aggregate(
        total_sales=Sum("total_amount"),
        total_orders=Count("id"),
    )
    total_sales = float(agg["total_sales"] or 0)
    total_orders = int(agg["total_orders"] or 0)

    # Cash analytics
    cash_qs = active_qs.filter(payment_method="cash")
    cash_agg = cash_qs.aggregate(
        count=Count("id"),
        total=Sum("total_amount"),
        avg=Avg("total_amount"),
    )
    cash_refunds = float(
        cash_qs.filter(payment_status="refunded").aggregate(t=Sum("total_amount"))["t"] or 0
    )

    # Online analytics
    online_methods = ["card", "bank_qr", "mobile_wallet"]
    online_qs = active_qs.filter(payment_method__in=online_methods)
    online_agg = online_qs.aggregate(
        count=Count("id"),
        total=Sum("total_amount"),
        avg=Avg("total_amount"),
    )
    online_refunds = float(
        online_qs.filter(payment_status="refunded").aggregate(t=Sum("total_amount"))["t"] or 0
    )

    # Payment method breakdown
    pm_rows = (
        active_qs
        .exclude(payment_method="")
        .values("payment_method")
        .annotate(count=Count("id"), total=Sum("total_amount"), avg=Avg("total_amount"))
        .order_by("-total")
    )
    methods = []
    for pm in pm_rows:
        amt = float(pm["total"] or 0)
        refunds = float(
            active_qs.filter(payment_method=pm["payment_method"], payment_status="refunded")
            .aggregate(t=Sum("total_amount"))["t"] or 0
        )
        methods.append({
            "method": pm["payment_method"],
            "count": int(pm["count"]),
            "amount": amt,
            "average": float(pm["avg"] or 0),
            "percentage": round((amt / total_sales * 100), 1) if total_sales > 0 else 0,
            "refunds": refunds,
            "net": amt - refunds,
        })

    return Response({
        "date_from": str(date_from),
        "date_to": str(date_to),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "overview": {
            "total_sales": total_sales,
            "total_orders": total_orders,
        },
        "cash": {
            "count": int(cash_agg["count"] or 0),
            "amount": float(cash_agg["total"] or 0),
            "average": float(cash_agg["avg"] or 0),
            "percentage": round((float(cash_agg["total"] or 0) / total_sales * 100), 1) if total_sales > 0 else 0,
            "refunds": cash_refunds,
            "net": float(cash_agg["total"] or 0) - cash_refunds,
        },
        "online": {
            "count": int(online_agg["count"] or 0),
            "amount": float(online_agg["total"] or 0),
            "average": float(online_agg["avg"] or 0),
            "percentage": round((float(online_agg["total"] or 0) / total_sales * 100), 1) if total_sales > 0 else 0,
            "refunds": online_refunds,
            "net": float(online_agg["total"] or 0) - online_refunds,
        },
        "methods": methods,
    })


# ══════════════════════════════════════════════════════════════════════════════
# ENHANCED ANALYTICS (merchant-level with date range)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def enhanced_analytics(request):
    """
    GET /api/pos/reports/analytics/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD

    Enhanced analytics with all metrics from the spec.
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    qs = _build_base_qs(merchant, date_from, date_to)
    active_qs = qs.exclude(status=Order.STATUS_CANCELLED)

    agg = active_qs.aggregate(
        total_sales=Sum("total_amount"),
        total_orders=Count("id"),
        avg_order=Avg("total_amount"),
        total_tax=Sum("tax_amount"),
        total_discount=Sum("discount_amount"),
    )

    total_sales = float(agg["total_sales"] or 0)
    total_orders = int(agg["total_orders"] or 0)

    # ── Cash / Online ─────────────────────────────────────────────────────────
    cash_total = float(active_qs.filter(payment_method="cash").aggregate(t=Sum("total_amount"))["t"] or 0)
    online_total = float(active_qs.filter(payment_method__in=["card", "bank_qr", "mobile_wallet"]).aggregate(t=Sum("total_amount"))["t"] or 0)

    # ── Refunds ───────────────────────────────────────────────────────────────
    refund_amount = float(active_qs.filter(payment_status="refunded").aggregate(t=Sum("total_amount"))["t"] or 0)
    refund_count = active_qs.filter(payment_status="refunded").count()

    # ── Total items sold ──────────────────────────────────────────────────────
    total_items_sold = OrderItem.objects.filter(order__in=active_qs).aggregate(t=Sum("quantity"))["t"] or 0

    # ── Daily trend ───────────────────────────────────────────────────────────
    daily_rows = (
        active_qs
        .annotate(date=TruncDate("created_at", tzinfo=_merchant_tz(merchant)))
        .values("date")
        .annotate(revenue=Sum("total_amount"), orders=Count("id"))
        .order_by("date")
    )
    daily_trend = [
        {"date": str(r["date"]), "revenue": float(r["revenue"] or 0), "orders": int(r["orders"])}
        for r in daily_rows
    ]

    # ── Top items ─────────────────────────────────────────────────────────────
    top_items = list(
        OrderItem.objects
        .filter(order__in=active_qs)
        .values("name")
        .annotate(quantity_sold=Sum("quantity"), revenue=Sum("subtotal"))
        .order_by("-revenue")[:15]
    )

    # ── Payment method breakdown ──────────────────────────────────────────────
    payment_methods = list(
        active_qs
        .exclude(payment_method="")
        .values("payment_method")
        .annotate(count=Count("id"), revenue=Sum("total_amount"))
        .order_by("-revenue")
    )

    # ── Cancelled ─────────────────────────────────────────────────────────────
    cancelled_count = qs.filter(status=Order.STATUS_CANCELLED).count()

    return Response({
        "date_from": str(date_from),
        "date_to": str(date_to),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "tax_enabled": merchant.tax_enabled,
        "tax_label": _get_tax_label(merchant),
        "tax_rate": _get_total_tax_rate(merchant),
        "overview": {
            "total_sales": total_sales,
            "net_sales": total_sales - float(agg["total_discount"] or 0),
            "total_orders": total_orders,
            "total_customers": active_qs.exclude(customer=None).values("customer").distinct().count(),
            "avg_order_value": round(float(agg["avg_order"] or 0), 2),
            "total_tax": float(agg["total_tax"] or 0),
            "total_discount": float(agg["total_discount"] or 0),
            "cash_collected": cash_total,
            "online_collected": online_total,
            "refunds": refund_amount,
            "total_items_sold": int(total_items_sold),
            "cancelled_orders": cancelled_count,
        },
        "daily_trend": daily_trend,
        "top_items": [
            {"name": i["name"], "quantity_sold": int(i["quantity_sold"] or 0), "revenue": float(i["revenue"] or 0)}
            for i in top_items
        ],
        "payment_methods": [
            {"method": p["payment_method"], "count": int(p["count"]), "revenue": float(p["revenue"] or 0)}
            for p in payment_methods
        ],
    })


# ══════════════════════════════════════════════════════════════════════════════
# REPORT HISTORY
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def report_history(request):
    """GET /api/pos/reports/history/"""
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    reports = ReportHistory.objects.filter(merchant=merchant)[:50]
    return Response([
        {
            "id": r.id,
            "report_name": r.report_name,
            "report_type": r.report_type,
            "date_from": str(r.date_from) if r.date_from else None,
            "date_to": str(r.date_to) if r.date_to else None,
            "format": r.format,
            "generated_by": r.generated_by.get_full_name() if r.generated_by else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in reports
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def record_report_export(request):
    """POST /api/pos/reports/record-export/ — Record a report generation in history."""
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    report_name = request.data.get("report_name", "Report")
    report_type = request.data.get("report_type", "sales")
    date_from = _parse_date_param(request.data.get("date_from"))
    date_to = _parse_date_param(request.data.get("date_to"))
    fmt = request.data.get("format", "pdf")
    filters = request.data.get("filters", {})

    report = ReportHistory.objects.create(
        merchant=merchant,
        report_name=report_name,
        report_type=report_type,
        date_from=date_from,
        date_to=date_to,
        format=fmt,
        generated_by=request.user,
        filters=filters,
    )

    return Response({"id": report.id, "message": "Report recorded."}, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT — CSV/Spreadsheet (lightweight, no external deps)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def export_csv(request):
    """
    GET /api/pos/reports/export/csv/?date_from=...&date_to=...&type=sales|fiscal|items|payments

    Returns a CSV file download.
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    report_type = request.query_params.get("type", "sales")
    active_qs = _build_base_qs(merchant, date_from, date_to).exclude(status=Order.STATUS_CANCELLED)

    buf = io.StringIO()
    writer = csv.writer(buf)

    if report_type == "fiscal":
        writer.writerow(["Fiscal Report", f"{merchant.business_name}"])
        writer.writerow(["Period", f"{date_from} to {date_to}"])
        writer.writerow(["Currency", f"{merchant.currency_code} ({merchant.currency_symbol})"])
        writer.writerow([])

        agg = active_qs.aggregate(
            gross=Sum("total_amount"), tax=Sum("tax_amount"),
            discount=Sum("discount_amount"), subtotal=Sum("subtotal"),
            count=Count("id"),
        )
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Gross Sales", f"{float(agg['gross'] or 0):.2f}"])
        writer.writerow(["Total Orders", agg["count"] or 0])
        writer.writerow(["Tax Collected", f"{float(agg['tax'] or 0):.2f}"])
        writer.writerow(["Discounts", f"{float(agg['discount'] or 0):.2f}"])
        writer.writerow(["Net Sales", f"{float(agg['gross'] or 0) - float(agg['discount'] or 0):.2f}"])
        writer.writerow([])

        writer.writerow(["Payment Method", "Transactions", "Amount"])
        for pm in active_qs.exclude(payment_method="").values("payment_method").annotate(c=Count("id"), t=Sum("total_amount")):
            writer.writerow([pm["payment_method"], pm["c"], f"{float(pm['t'] or 0):.2f}"])

    elif report_type == "items":
        writer.writerow(["Item Sales Report", f"{merchant.business_name}"])
        writer.writerow(["Period", f"{date_from} to {date_to}"])
        writer.writerow([])

        writer.writerow(["Item Name", "Quantity Sold", "Revenue", "Order Count"])
        for item in (
            OrderItem.objects.filter(order__in=active_qs)
            .values("name")
            .annotate(qty=Sum("quantity"), rev=Sum("subtotal"), oc=Count("order", distinct=True))
            .order_by("-rev")
        ):
            writer.writerow([item["name"], item["qty"], f"{float(item['rev'] or 0):.2f}", item["oc"]])

    elif report_type == "payments":
        writer.writerow(["Payment Report", f"{merchant.business_name}"])
        writer.writerow(["Period", f"{date_from} to {date_to}"])
        writer.writerow([])

        writer.writerow(["Payment Method", "Transactions", "Amount", "% of Total"])
        total = float(active_qs.aggregate(t=Sum("total_amount"))["t"] or 0) or 1
        for pm in active_qs.exclude(payment_method="").values("payment_method").annotate(c=Count("id"), t=Sum("total_amount")).order_by("-t"):
            amt = float(pm["t"] or 0)
            writer.writerow([pm["payment_method"], pm["c"], f"{amt:.2f}", f"{amt/total*100:.1f}%"])

    else:  # sales
        writer.writerow(["Sales Report", f"{merchant.business_name}"])
        writer.writerow(["Period", f"{date_from} to {date_to}"])
        writer.writerow(["Currency", f"{merchant.currency_code} ({merchant.currency_symbol})"])
        writer.writerow([])

        agg = active_qs.aggregate(
            total=Sum("total_amount"), tax=Sum("tax_amount"),
            discount=Sum("discount_amount"), count=Count("id"),
        )
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Total Sales", f"{float(agg['total'] or 0):.2f}"])
        writer.writerow(["Total Orders", agg["count"] or 0])
        writer.writerow(["Tax Collected", f"{float(agg['tax'] or 0):.2f}"])
        writer.writerow(["Discounts", f"{float(agg['discount'] or 0):.2f}"])
        writer.writerow([])

        writer.writerow(["Date", "Revenue", "Orders", "Tax", "Discount"])
        for d in (
            active_qs
            .annotate(date=TruncDate("created_at", tzinfo=_merchant_tz(merchant)))
            .values("date")
            .annotate(rev=Sum("total_amount"), c=Count("id"), tax=Sum("tax_amount"), disc=Sum("discount_amount"))
            .order_by("date")
        ):
            writer.writerow([str(d["date"]), f"{float(d['rev'] or 0):.2f}", d["c"], f"{float(d['tax'] or 0):.2f}", f"{float(d['disc'] or 0):.2f}"])

    # Build response
    output = buf.getvalue()
    response = HttpResponse(output, content_type="text/csv")
    filename = f"{report_type}_report_{date_from}_to_{date_to}.csv"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'

    # Record in history
    ReportHistory.objects.create(
        merchant=merchant,
        report_name=f"{report_type.title()} Report ({date_from} to {date_to})",
        report_type=report_type if report_type in dict(ReportHistory.REPORT_TYPE_CHOICES) else "sales",
        date_from=date_from,
        date_to=date_to,
        format="xlsx",
        generated_by=request.user,
        filters={"type": report_type, "date_from": str(date_from), "date_to": str(date_to)},
    )

    return response


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT — PDF (HTML-based, no external deps)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def export_pdf(request):
    """
    GET /api/pos/reports/export/pdf/?date_from=...&date_to=...&type=sales|fiscal|items|payments

    Returns an HTML file that can be printed/saved as PDF from the browser.
    """
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    date_from, date_to = _date_range(request, merchant)
    report_type = request.query_params.get("type", "sales")
    active_qs = _build_base_qs(merchant, date_from, date_to).exclude(status=Order.STATUS_CANCELLED)
    sym = merchant.currency_symbol or "Rs"

    agg = active_qs.aggregate(
        total=Sum("total_amount"), tax=Sum("tax_amount"),
        discount=Sum("discount_amount"), subtotal=Sum("subtotal"),
        count=Count("id"), avg=Avg("total_amount"),
    )

    tax_label = _get_tax_label(merchant) or "Tax"
    total_tax_rate = _get_total_tax_rate(merchant)

    # Build HTML
    html_parts = []
    html_parts.append(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{report_type.title()} Report — {merchant.business_name}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 40px; color: #1a1a1a; font-size: 13px; }}
h1 {{ font-size: 22px; margin-bottom: 4px; }}
h2 {{ font-size: 16px; color: #555; margin-top: 28px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }}
.meta {{ color: #777; font-size: 12px; margin-bottom: 20px; }}
table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }}
th {{ background: #f7f7f7; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }}
.total {{ font-weight: 700; background: #f0f0f0; }}
.metric {{ display: inline-block; margin-right: 30px; margin-bottom: 12px; }}
.metric .label {{ font-size: 11px; color: #777; text-transform: uppercase; }}
.metric .value {{ font-size: 20px; font-weight: 700; }}
</style></head><body>
<h1>{merchant.business_name}</h1>
<p class="meta">{report_type.title()} Report &middot; {date_from} to {date_to} &middot; Currency: {merchant.currency_code} ({sym})</p>
<p class="meta">Tax: {tax_label} {total_tax_rate}% &middot; Generated: {timezone.now().strftime('%Y-%m-%d %H:%M')}</p>
""")

    # Summary metrics
    total = float(agg["total"] or 0)
    discount = float(agg["discount"] or 0)
    tax = float(agg["tax"] or 0)
    html_parts.append("<div>")
    html_parts.append(f'<div class="metric"><div class="label">Total Sales</div><div class="value">{sym} {total:,.2f}</div></div>')
    html_parts.append(f'<div class="metric"><div class="label">Orders</div><div class="value">{agg["count"] or 0}</div></div>')
    html_parts.append(f'<div class="metric"><div class="label">Avg Order</div><div class="value">{sym} {float(agg["avg"] or 0):,.2f}</div></div>')
    html_parts.append(f'<div class="metric"><div class="label">{tax_label}</div><div class="value">{sym} {tax:,.2f}</div></div>')
    html_parts.append(f'<div class="metric"><div class="label">Discounts</div><div class="value">{sym} {discount:,.2f}</div></div>')
    html_parts.append(f'<div class="metric"><div class="label">Net Sales</div><div class="value">{sym} {total - discount:,.2f}</div></div>')
    html_parts.append("</div>")

    # Payment breakdown table
    html_parts.append("<h2>Payment Breakdown</h2>")
    html_parts.append("<table><tr><th>Method</th><th>Transactions</th><th>Amount</th><th>%</th></tr>")
    for pm in active_qs.exclude(payment_method="").values("payment_method").annotate(c=Count("id"), t=Sum("total_amount")).order_by("-t"):
        amt = float(pm["t"] or 0)
        pct = (amt / total * 100) if total > 0 else 0
        html_parts.append(f"<tr><td>{pm['payment_method'].replace('_', ' ').title()}</td><td>{pm['c']}</td><td>{sym} {amt:,.2f}</td><td>{pct:.1f}%</td></tr>")
    html_parts.append("</table>")

    # Tax summary
    html_parts.append(f"<h2>{tax_label} Summary</h2>")
    taxable = float(active_qs.exclude(tax_amount=0).aggregate(t=Sum("total_amount"))["t"] or 0)
    nontaxable = float(active_qs.filter(tax_amount=0).aggregate(t=Sum("total_amount"))["t"] or 0)
    html_parts.append("<table><tr><th>Metric</th><th>Value</th></tr>")
    html_parts.append(f"<tr><td>Tax Enabled</td><td>{'Yes' if merchant.tax_enabled else 'No'}</td></tr>")
    html_parts.append(f"<tr><td>Tax Type & Rate</td><td>{tax_label} {total_tax_rate}%</td></tr>")
    html_parts.append(f"<tr><td>Taxable Sales</td><td>{sym} {taxable:,.2f}</td></tr>")
    html_parts.append(f"<tr><td>Non-Taxable Sales</td><td>{sym} {nontaxable:,.2f}</td></tr>")
    html_parts.append(f"<tr><td>Tax Collected</td><td>{sym} {tax:,.2f}</td></tr>")
    html_parts.append(f"<tr><td>Sales Including Tax</td><td>{sym} {float(agg['subtotal'] or 0) + tax:,.2f}</td></tr>")
    html_parts.append(f"<tr><td>Sales Excluding Tax</td><td>{sym} {float(agg['subtotal'] or 0):,.2f}</td></tr>")
    html_parts.append("</table>")

    # Top items
    if report_type in ("sales", "fiscal", "items"):
        html_parts.append("<h2>Top Items</h2>")
        html_parts.append("<table><tr><th>Item</th><th>Qty Sold</th><th>Revenue</th></tr>")
        for item in (
            OrderItem.objects.filter(order__in=active_qs)
            .values("name")
            .annotate(qty=Sum("quantity"), rev=Sum("subtotal"))
            .order_by("-rev")[:15]
        ):
            html_parts.append(f"<tr><td>{item['name']}</td><td>{item['qty']}</td><td>{sym} {float(item['rev'] or 0):,.2f}</td></tr>")
        html_parts.append("</table>")

    # Daily trend
    html_parts.append("<h2>Daily Trend</h2>")
    html_parts.append("<table><tr><th>Date</th><th>Revenue</th><th>Orders</th><th>Tax</th></tr>")
    for d in (
        active_qs
        .annotate(date=TruncDate("created_at", tzinfo=_merchant_tz(merchant)))
        .values("date")
        .annotate(rev=Sum("total_amount"), c=Count("id"), tax=Sum("tax_amount"))
        .order_by("date")
    ):
        html_parts.append(f"<tr><td>{d['date']}</td><td>{sym} {float(d['rev'] or 0):,.2f}</td><td>{d['c']}</td><td>{sym} {float(d['tax'] or 0):,.2f}</td></tr>")
    html_parts.append("</table>")

    html_parts.append("</body></html>")
    html = "\n".join(html_parts)

    response = HttpResponse(html, content_type="text/html")
    filename = f"{report_type}_report_{date_from}_to_{date_to}.html"
    response["Content-Disposition"] = f'attachment; filename="{filename}"'

    # Record in history
    ReportHistory.objects.create(
        merchant=merchant,
        report_name=f"{report_type.title()} Report ({date_from} to {date_to})",
        report_type=report_type if report_type in dict(ReportHistory.REPORT_TYPE_CHOICES) else "sales",
        date_from=date_from,
        date_to=date_to,
        format="pdf",
        generated_by=request.user,
        filters={"type": report_type, "date_from": str(date_from), "date_to": str(date_to)},
    )

    return response
