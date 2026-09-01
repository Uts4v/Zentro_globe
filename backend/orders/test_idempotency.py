"""
H-4 regression tests — customer order idempotency via client_mutation_id.

Run with: python manage.py test orders.test_idempotency

Verifies that resubmitting the same authenticated customer order with the
same client_mutation_id returns the existing order instead of creating a
duplicate.
"""

import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from orders.models import Order, OrderItem
from merchants.models import MerchantProfile, MenuItem


class OrderIdempotencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer_user = get_user_model().objects.create_user(
            username="idem-cust", email="idem-cust@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Idem Customer",
        )
        self.client.force_authenticate(user=self.customer_user)
        self.merchant_user = get_user_model().objects.create_user(
            username="idem-m", email="idem-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Idem Cafe", slug="idem-cafe",
            is_open=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=200, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )

    def _payload(self, mid):
        return {
            "merchant_id": self.merchant.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 2}],
            "client_mutation_id": str(mid),
        }

    def test_repeated_mutation_returns_existing_order(self):
        mid = uuid.uuid4()
        first = self.client.post("/api/orders/create/", self._payload(mid), format="json")
        self.assertEqual(first.status_code, 201, first.data)
        order_id = first.data["id"]

        second = self.client.post("/api/orders/create/", self._payload(mid), format="json")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["id"], order_id)

        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(OrderItem.objects.filter(order__id=order_id).count(), 1)

    def test_different_mutation_creates_distinct_order(self):
        first = self.client.post(
            "/api/orders/create/", self._payload(uuid.uuid4()), format="json"
        )
        second = self.client.post(
            "/api/orders/create/", self._payload(uuid.uuid4()), format="json"
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.data["id"], second.data["id"])
        self.assertEqual(Order.objects.count(), 2)

    def test_without_mutation_id_still_creates_order(self):
        resp = self.client.post(
            "/api/orders/create/",
            {
                "merchant_id": self.merchant.id,
                "items": [{"menu_item_id": self.item.id, "quantity": 1}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Order.objects.count(), 1)

    def test_mutation_scoped_to_customer(self):
        # A different customer's identical mutation id must not collide.
        mid = uuid.uuid4()
        first = self.client.post("/api/orders/create/", self._payload(mid), format="json")
        self.assertEqual(first.status_code, 201, first.data)

        other_user = get_user_model().objects.create_user(
            username="idem-cust2", email="idem-cust2@test.com", password="Pass123!", role="customer"
        )
        other = CustomerProfile.objects.create(user=other_user, full_name="Other")
        other_client = APIClient()
        other_client.force_authenticate(user=other_user)
        second = other_client.post("/api/orders/create/", self._payload(mid), format="json")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(first.data["id"], second.data["id"])
        self.assertEqual(Order.objects.count(), 2)