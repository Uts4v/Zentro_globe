from datetime import datetime, timedelta, time as dt_time
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from orders.models import Order


class AnalyticsEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = get_user_model().objects.create_user(
            username="analytics-m",
            email="analytics-m@test.com",
            password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=user,
            business_name="Analytics Cafe",
            slug="analytics-cafe",
            is_open=True,
            onboarding_complete=True,
            timezone="Asia/Kathmandu",
        )
        self.client.force_authenticate(user=user)
        self.tz = ZoneInfo("Asia/Kathmandu")
        now_local = timezone.localtime(timezone.now(), self.tz)
        self.today_start = datetime.combine(
            now_local.date(), dt_time.min
        ).replace(tzinfo=self.tz)

    def _make_order(
        self,
        *,
        status,
        total,
        created_at,
        fulfillment="pickup",
        order_type="regular",
        source="pos_online",
        payment_method="cash",
    ):
        order = Order.objects.create(
            merchant=self.merchant,
            status=status,
            total_amount=total,
            fulfillment_type=fulfillment,
            order_type=order_type,
            source=source,
            payment_method=payment_method,
        )
        order.created_at = created_at
        order.save(update_fields=["created_at"])
        return order

    def test_analytics_shape_and_values(self):
        self._make_order(
            status="completed",
            total=1000.0,
            created_at=self.today_start + timedelta(minutes=30),
        )
        self._make_order(
            status="pending",
            total=500.0,
            created_at=self.today_start + timedelta(hours=3),
        )
        self._make_order(
            status="completed",
            total=250.0,
            created_at=self.today_start - timedelta(minutes=30),
        )
        self._make_order(
            status="cancelled",
            total=999.0,
            created_at=self.today_start - timedelta(hours=1),
        )

        resp = self.client.get("/api/merchants/analytics/?days=30")
        self.assertEqual(resp.status_code, 200)
        data = resp.data

        # Cancelled orders are excluded from revenue/orders totals
        self.assertEqual(data["total_orders"], 3)
        self.assertEqual(float(data["total_revenue"]), 1750.0)

        # Today's summary uses the merchant's local day (Kathmandu)
        self.assertEqual(data["today"]["orders"], 2)
        self.assertEqual(float(data["today"]["revenue"]), 1500.0)

        # Daily series is zero-filled for every calendar day in the period
        self.assertEqual(len(data["daily_revenue"]), 30)
        self.assertEqual(len({d["date"] for d in data["daily_revenue"]}), 30)
        self.assertEqual(data["daily_revenue"][-1]["date"], str(self.today_start.date()))

        # Status breakdown includes cancelled orders
        self.assertEqual(data["orders_by_status"]["cancelled"], 1)
        self.assertEqual(data["orders_by_status"]["completed"], 2)

        # Breakdowns, hourly series and weekly/customer/loyalty keys present
        self.assertEqual(data["orders_by_fulfillment"]["pickup"], 3)
        self.assertEqual(len(data["busiest_hours"]), 24)
        self.assertEqual(len(data["hourly_velocity"]), 24)
        self.assertIn("orders_by_type", data)
        self.assertIn("orders_by_source", data)
        self.assertIn("orders_by_payment", data)
        self.assertIn("customers", data)
        self.assertIn("weekly", data)
        self.assertIn("loyalty", data)

    def test_analytics_days_clamped_and_today_empty(self):
        resp = self.client.get("/api/merchants/analytics/?days=999")
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(data["period_days"], 90)
        self.assertEqual(len(data["daily_revenue"]), 90)
        self.assertEqual(data["today"]["orders"], 0)
        self.assertEqual(data["total_orders"], 0)
