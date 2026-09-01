"""
H-7 regression tests — customer order responses do not leak POS internals.

Run with: python manage.py test orders.test_customer_order_serializer

The authenticated customer's my_orders response must NOT include POS-internal
fields (processed_by_worker, worker_name, pos_device, cash_shift,
client_mutation_id, version).
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from orders.models import Order, OrderItem
from merchants.models import MerchantProfile, MenuItem


class CustomerOrderSerializerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer_user = get_user_model().objects.create_user(
            username="h7-cust", email="h7-cust@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="H7 Customer",
        )
        self.client.force_authenticate(user=self.customer_user)
        self.merchant_user = get_user_model().objects.create_user(
            username="h7-m", email="h7-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="H7 Cafe", slug="h7-cafe",
            is_open=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=200, is_available=True,
        )
        self.order = Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status=Order.STATUS_PENDING, order_type="regular",
            subtotal=400, total_amount=424,
        )
        OrderItem.objects.create(
            order=self.order, menu_item=self.item, name="Latte", quantity=2,
            price=200, subtotal=400,
        )

    def test_my_orders_excludes_pos_internal_fields(self):
        resp = self.client.get("/api/orders/my-orders/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 1)
        row = resp.data[0]
        # POS-internal fields must not leak to the customer.
        for field in (
            "processed_by_worker", "worker_name", "pos_device", "cash_shift",
            "client_mutation_id", "version",
        ):
            self.assertNotIn(field, row, f"sensitive field leaked: {field}")
        # Public customer-facing fields still present.
        self.assertIn("id", row)
        self.assertIn("status", row)
        self.assertIn("total_amount", row)
        self.assertIn("items", row)
        self.assertEqual(row["items"][0]["quantity"], 2)