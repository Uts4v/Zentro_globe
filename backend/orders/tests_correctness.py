"""
Correctness regression tests for order views hardening:
- Pagination caps on order list endpoints (limit is bounded server-side)
- Tenant scoping: merchants only ever see their own orders
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem


class OrderListCorrectnessTests(TestCase):
    def setUp(self):
        self.user_model = get_user_model()

        self.customer_user = self.user_model.objects.create_user(
            username="cust", email="cust@example.com", password="Pass123!",
            role="customer",
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Test Customer",
        )

        self.merchant_user_a = self.user_model.objects.create_user(
            username="merch-a", email="a@example.com", password="Pass123!",
            role="merchant",
        )
        self.merchant_a = MerchantProfile.objects.create(
            user=self.merchant_user_a, business_name="Merchant A",
            slug="merchant-a", is_open=True,
        )
        self.merchant_user_b = self.user_model.objects.create_user(
            username="merch-b", email="b@example.com", password="Pass123!",
            role="merchant",
        )
        self.merchant_b = MerchantProfile.objects.create(
            user=self.merchant_user_b, business_name="Merchant B",
            slug="merchant-b", is_open=True,
        )

    def test_my_orders_pagination_is_capped(self):
        for _ in range(205):
            Order.objects.create(
                customer=self.customer, merchant=self.merchant_a,
                total_amount=100, subtotal=100,
                status=Order.STATUS_COMPLETED,
                order_type=Order.ORDER_TYPE_REGULAR,
            )

        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.get("/api/orders/my-orders/?limit=1000")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 200)

    def test_store_orders_scoped_to_merchant(self):
        for i in range(5):
            Order.objects.create(
                customer=self.customer, merchant=self.merchant_a,
                total_amount=100, subtotal=100,
                status=Order.STATUS_CONFIRMED,
                order_type=Order.ORDER_TYPE_REGULAR,
            )
        for i in range(3):
            Order.objects.create(
                customer=self.customer, merchant=self.merchant_b,
                total_amount=100, subtotal=100,
                status=Order.STATUS_CONFIRMED,
                order_type=Order.ORDER_TYPE_REGULAR,
            )

        client = APIClient()
        client.force_authenticate(user=self.merchant_user_a)
        resp = client.get("/api/orders/store-orders/?limit=200")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 5)
        self.assertTrue(all(o["merchant_id"] == self.merchant_a.id for o in resp.data))

    def test_my_orders_scoped_to_customer(self):
        other_user = self.user_model.objects.create_user(
            username="other", email="other@example.com", password="Pass123!",
            role="customer",
        )
        other = CustomerProfile.objects.create(user=other_user, full_name="Other")
        Order.objects.create(
            customer=self.customer, merchant=self.merchant_a,
            total_amount=100, subtotal=100,
            status=Order.STATUS_CONFIRMED,
            order_type=Order.ORDER_TYPE_REGULAR,
        )
        Order.objects.create(
            customer=other, merchant=self.merchant_a,
            total_amount=100, subtotal=100,
            status=Order.STATUS_CONFIRMED,
            order_type=Order.ORDER_TYPE_REGULAR,
        )

        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.get("/api/orders/my-orders/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 1)

    def test_create_order_bulk_creates_items(self):
        item = MenuItem.objects.create(
            merchant=self.merchant_a, name="Latte", price=250,
            is_available=True, loyalty_reward=True, points_per_item=1,
        )
        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.post("/api/orders/create/", {
            "merchant_id": self.merchant_a.id,
            "items": [
                {"menu_item_id": item.id, "quantity": 2},
                {"menu_item_id": item.id, "quantity": 1},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(OrderItem.objects.count(), 2)
