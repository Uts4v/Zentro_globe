from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum, Count, Avg
from django.db.models.functions import TruncDate
from django.utils import timezone

from .registry import tool_registry
from ..exceptions import AIToolPermissionDenied

SALES_TOOLS = {}


def get_sales_summary(*, merchant, days: int = 30, **kwargs):
    from orders.models import Order
    since = timezone.now() - timedelta(days=days)
    qs = Order.objects.filter(
        merchant=merchant, created_at__gte=since,
    ).exclude(status=Order.STATUS_CANCELLED)
    agg = qs.aggregate(
        total_revenue=Sum("total_amount"),
        total_orders=Count("id"),
        avg_value=Avg("total_amount"),
    )
    return {
        "period_days": days,
        "total_revenue": float(agg["total_revenue"] or 0),
        "total_orders": agg["total_orders"] or 0,
        "average_order_value": round(float(agg["avg_value"] or 0), 2),
    }


def get_top_products(*, merchant, days: int = 30, limit: int = 10, **kwargs):
    from orders.models import OrderItem
    from django.db.models import Sum as Sum2
    since = timezone.now() - timedelta(days=days)
    items = (
        OrderItem.objects
        .filter(order__merchant=merchant, order__created_at__gte=since)
        .exclude(order__status="cancelled")
        .values("name")
        .annotate(total_qty=Sum2("quantity"), revenue=Sum2("subtotal"))
        .order_by("-total_qty")[:limit]
    )
    return list(items)


def get_order_summary(*, merchant, days: int = 30, **kwargs):
    from orders.models import Order
    since = timezone.now() - timedelta(days=days)
    qs = Order.objects.filter(merchant=merchant, created_at__gte=since)
    total = qs.count()
    by_status = {}
    for s in Order.STATUS_CHOICES:
        code = s[0]
        count = qs.filter(status=code).count()
        if count:
            by_status[code] = count
    return {
        "total_orders": total,
        "by_status": by_status,
        "period_days": days,
    }


def get_loyalty_summary(*, merchant, days: int = 30, **kwargs):
    from loyalty.models import CustomerMerchantWallet, PointTransaction, CustomerPunchCard, Redemption
    since = timezone.now() - timedelta(days=days)
    wallets = CustomerMerchantWallet.objects.filter(merchant=merchant)
    points_issued = PointTransaction.objects.filter(
        merchant=merchant, created_at__gte=since,
        transaction_type__in=["EARNED", "MISSION_BONUS"],
    ).aggregate(total=Sum("points"))["total"] or 0
    redemptions = Redemption.objects.filter(
        reward__merchant=merchant, created_at__gte=since,
    ).count()
    return {
        "active_members": wallets.count(),
        "points_issued_last_30d": float(points_issued),
        "rewards_redeemed_last_30d": redemptions,
    }


def get_customer_summary(*, merchant, days: int = 30, **kwargs):
    from orders.models import Order
    from django.db.models import Count as C
    since = timezone.now() - timedelta(days=days)
    orders = Order.objects.filter(
        merchant=merchant, created_at__gte=since,
    ).exclude(status=Order.STATUS_CANCELLED)
    with_customer = orders.exclude(customer=None)
    new = with_customer.filter(
        customer__orders__created_at__gte=since,
    ).distinct().count()
    return {
        "total_customers_ordered": with_customer.values("customer").distinct().count(),
        "new_customers": new,
        "guest_orders": orders.filter(customer=None).count(),
        "total_orders": orders.count(),
    }


def register_sales_tools():
    tool_registry.register(
        get_sales_summary,
        name="get_sales_summary",
        description="Get sales revenue and order totals. Use for any question about revenue, sales, earnings, or income. Pass days=1 for today's revenue, days=7 for this week, days=30 for this month (default). Returns total_revenue, total_orders, average_order_value.",
        parameters={
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of past days to include (use 1 for today, 7 for this week, 30 for this month)", "default": 30},
            },
            "required": ["days"],
        },
    )
    tool_registry.register(
        get_top_products,
        name="get_top_products",
        description="Get best-selling menu items ranked by quantity sold. Use for questions about popular items, top products, or best sellers.",
        parameters={
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of past days to look back", "default": 30},
                "limit": {"type": "integer", "description": "Maximum number of products to return", "default": 10},
            },
        },
    )
    tool_registry.register(
        get_order_summary,
        name="get_order_summary",
        description="Get order counts broken down by status (completed, pending, cancelled, etc.). Use for questions about order volume or status distribution.",
        parameters={
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of past days to include", "default": 30},
            },
        },
    )
    tool_registry.register(
        get_loyalty_summary,
        name="get_loyalty_summary",
        description="Get loyalty program metrics: active members, points issued, rewards redeemed. Use for questions about loyalty program performance.",
        parameters={
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of past days to include", "default": 30},
            },
        },
    )
    tool_registry.register(
        get_customer_summary,
        name="get_customer_summary",
        description="Get customer activity: total customers, new customers, guest orders. Use for questions about customer counts or new vs returning customers.",
        parameters={
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of past days to include", "default": 30},
            },
        },
    )
