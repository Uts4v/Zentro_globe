"""
H-9 regression tests — order lifecycle events are audited.

Run with: python manage.py test orders.test_audit

Verifies that order status changes and cancellations write an entry to the
shared PosAuditLog (money-moving / state-changing actions traceable).
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from pos.models import PosAuditLog
from orders.models import Order, OrderItem
from merchants.models import MerchantProfile, MenuItem


class OrderAuditTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user = get_user_model().objects.create_user(
            username="audit-m", email="audit-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Audit Cafe", slug="audit-cafe",
            is_open=True,
        )
        self.customer_user = get_user_model().objects.create_user(
            username="audit-c", email="audit-c@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(user=self.customer_user, full_name="AuditC")
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=200, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.order = Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status=Order.STATUS_CONFIRMED, order_type="regular",
            subtotal=200, total_amount=200, points_earned=5,
        )
        OrderItem.objects.create(
            order=self.order, menu_item=self.item, name="Latte", quantity=1,
            price=200, subtotal=200,
        )

    def test_status_change_is_audited(self):
        PosAuditLog.objects.all().delete()
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.patch(
            f"/api/orders/{self.order.id}/update-status/",
            {"status": "completed"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry = PosAuditLog.objects.filter(
            merchant=self.merchant, action="order_status_change", entity_type="order",
        ).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.metadata["to"], "completed")
        self.assertEqual(entry.metadata["points_awarded"], 5)

    def test_cancellation_is_audited(self):
        PosAuditLog.objects.all().delete()
        pending = Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status=Order.STATUS_PENDING, order_type="regular",
            subtotal=100, total_amount=100,
        )
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.patch(
            f"/api/orders/{pending.id}/cancel/",
            {"reason": "changed_my_mind"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry = PosAuditLog.objects.filter(
            merchant=self.merchant, action="order_cancelled", entity_type="order",
        ).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.metadata["by"], "customer")