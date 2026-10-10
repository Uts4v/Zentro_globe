"""
Reporting correctness fixes.

Run with: python manage.py test pos.test_reporting_fixes

Covers:
- enhanced_analytics net_sales nets out refunds (matches sales_report)
- the report "online" payment filter is non-cash (includes credit/debit)
- item analytics category attribution uses the menu_item FK, not item name
- item analytics payment breakdown uses a constant number of queries
"""

from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem


class ReportingFixesTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username="rep-m", email="rep-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="Rep Cafe", slug="rep-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            timezone="Asia/Kathmandu",
        )
        self.client.force_authenticate(user=self.user)
        tz = ZoneInfo(self.merchant.timezone or "Asia/Kathmandu")
        self.today = timezone.localtime(timezone.now(), tz).date()

    def _params(self, **extra):
        base = {"date_from": str(self.today), "date_to": str(self.today)}
        base.update(extra)
        return base

    def _order(self, total, *, discount=0, method="cash", payment_status="paid"):
        return Order.objects.create(
            merchant=self.merchant,
            status=Order.STATUS_COMPLETED,
            payment_status=payment_status,
            payment_method=method,
            total_amount=Decimal(str(total)),
            subtotal=Decimal(str(total)),
            discount_amount=Decimal(str(discount)),
            tax_amount=Decimal("0"),
        )

    def _order_with_item(self, name, total, *, method="cash", menu_item=None):
        order = self._order(total, method=method)
        OrderItem.objects.create(
            order=order, menu_item=menu_item, name=name,
            price=Decimal(str(total)), quantity=1, subtotal=Decimal(str(total)),
        )
        return order

    def test_enhanced_analytics_net_sales_nets_refunds(self):
        self._order(100, discount=10)
        self._order(50, payment_status="refunded")

        resp = self.client.get("/api/pos/reports/analytics/", self._params())
        self.assertEqual(resp.status_code, 200, resp.data)
        ov = resp.data["overview"]
        self.assertEqual(Decimal(str(ov["total_sales"])), Decimal("150"))
        self.assertEqual(Decimal(str(ov["refunds"])), Decimal("50"))
        # 150 gross - 10 discount - 50 refunds
        self.assertEqual(Decimal(str(ov["net_sales"])), Decimal("90"))

    def test_sales_report_and_analytics_net_sales_agree(self):
        self._order(100, discount=10)
        self._order(50, payment_status="refunded")

        sales = self.client.get("/api/pos/reports/sales/", self._params())
        analytics = self.client.get("/api/pos/reports/analytics/", self._params())
        self.assertEqual(sales.status_code, 200, sales.data)
        self.assertEqual(analytics.status_code, 200, analytics.data)
        self.assertEqual(
            Decimal(str(sales.data["overview"]["net_sales"])),
            Decimal(str(analytics.data["overview"]["net_sales"])),
        )

    def test_sales_report_online_filter_includes_credit(self):
        self._order(30, method="credit")
        self._order(70, method="cash")

        resp = self.client.get("/api/pos/reports/sales/", self._params(payment_method="online"))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(str(resp.data["overview"]["total_sales"])), Decimal("30"))

    def test_item_analytics_online_filter_includes_credit(self):
        self._order_with_item("Credit Line", 30, method="credit")
        self._order_with_item("Cash Line", 70, method="cash")

        resp = self.client.get("/api/pos/reports/items/", self._params(payment_method="online"))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(str(resp.data["total_revenue"])), Decimal("30"))
        self.assertEqual([i["name"] for i in resp.data["items"]], ["Credit Line"])

    def test_item_category_uses_menu_item_fk_not_name(self):
        item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=Decimal("80"),
            category="Drinks", status=MenuItem.STATUS_ACTIVE, is_available=True,
        )
        # Line name intentionally differs from the menu item name.
        self._order_with_item("Latte (Large)", 80, menu_item=item)

        resp = self.client.get("/api/pos/reports/items/", self._params())
        self.assertEqual(resp.status_code, 200, resp.data)
        cats = {i["name"]: i["category"] for i in resp.data["items"]}
        self.assertEqual(cats.get("Latte (Large)"), "Drinks")
        self.assertIn("Drinks", resp.data["available_categories"])

    def test_item_analytics_query_count_does_not_grow_with_items(self):
        item = MenuItem.objects.create(
            merchant=self.merchant, name="Base", price=Decimal("10"),
            category="Snacks", status=MenuItem.STATUS_ACTIVE, is_available=True,
        )
        for n in range(3):
            self._order_with_item(f"Item {n}", 10, menu_item=item)

        with CaptureQueriesContext(connection) as first:
            self.client.get("/api/pos/reports/items/", self._params())
        queries_for_three = len(first)

        for n in range(6):
            self._order_with_item(f"Extra {n}", 10, menu_item=item)

        with CaptureQueriesContext(connection) as second:
            self.client.get("/api/pos/reports/items/", self._params())

        self.assertEqual(len(second), queries_for_three)
