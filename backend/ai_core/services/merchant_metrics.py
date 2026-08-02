from datetime import timedelta, date, datetime

from django.db.models import Sum, Count, Avg
from django.utils import timezone


def build_merchant_metrics(merchant, report_date: date | None = None) -> dict:
    from orders.models import Order, OrderItem

    today = report_date or timezone.now().date()
    today_start = timezone.make_aware(
        datetime.combine(today, datetime.min.time())
    )
    prev_start = today_start - timedelta(days=1)

    orders_qs = Order.objects.filter(merchant=merchant)
    today_orders = orders_qs.filter(created_at__gte=today_start).exclude(
        status=Order.STATUS_CANCELLED
    )
    prev_orders = orders_qs.filter(
        created_at__gte=prev_start, created_at__lt=today_start,
    ).exclude(status=Order.STATUS_CANCELLED)

    today_agg = today_orders.aggregate(
        revenue=Sum("total_amount"), count=Count("id"), avg=Avg("total_amount"),
    )
    prev_agg = prev_orders.aggregate(
        revenue=Sum("total_amount"), count=Count("id"), avg=Avg("total_amount"),
    )

    today_rev = float(today_agg["revenue"] or 0)
    prev_rev = float(prev_agg["revenue"] or 0)
    growth = round(((today_rev - prev_rev) / prev_rev * 100), 2) if prev_rev else 0

    top_items = (
        OrderItem.objects
        .filter(order__in=today_orders)
        .values("name")
        .annotate(qty=Sum("quantity"), rev=Sum("subtotal"))
        .order_by("-qty")[:5]
    )

    from loyalty.models import CustomerMerchantWallet, PointTransaction, Redemption

    active_members = CustomerMerchantWallet.objects.filter(
        merchant=merchant,
    ).count()
    points_issued = PointTransaction.objects.filter(
        merchant=merchant, created_at__gte=today_start,
    ).aggregate(total=Sum("points"))["total"] or 0
    redemptions = Redemption.objects.filter(
        reward__merchant=merchant, created_at__gte=today_start,
    ).count()

    return {
        "period": {
            "start": str(prev_start.date()),
            "end": str(today),
        },
        "sales": {
            "today": today_rev,
            "previous_period": prev_rev,
            "growth_percent": growth,
            "order_count": today_agg["count"] or 0,
            "average_order_value": round(float(today_agg["avg"] or 0), 2),
        },
        "top_products": [
            {"name": i["name"], "quantity": i["qty"], "revenue": float(i["rev"])}
            for i in top_items
        ],
        "loyalty": {
            "active_members": active_members,
            "points_issued_today": float(points_issued),
            "rewards_redeemed_today": redemptions,
        },
        "operations": {
            "cancelled_today": orders_qs.filter(
                created_at__gte=today_start, status=Order.STATUS_CANCELLED,
            ).count(),
        },
    }
