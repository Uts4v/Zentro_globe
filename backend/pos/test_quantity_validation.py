"""
C-5 regression tests — item quantity validation across all order paths.

Run with: python manage.py test pos.test_quantity_validation

Every order-creation path (POS, table-QR, customer create, guest create,
add-items) must reject non-integer, negative, zero, and absurdly large
quantities via the shared `config.order_utils.parse_quantity` validator.
"""

import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from decimal import Decimal
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from merchants.models import MerchantProfile, MenuItem, MerchantTable
from orders.models import Order, OrderItem
from pos.models import ShiftWorker, PosDevice

from config.order_utils import (
    parse_quantity,
    QuantityValidationError,
    MIN_ITEM_QUANTITY,
    MAX_ITEM_QUANTITY,
)


class ParseQuantityUnitTests(TestCase):
    def test_valid_integer_accepted(self):
        self.assertEqual(parse_quantity(2), 2)
        self.assertEqual(parse_quantity(1), 1)
        self.assertEqual(parse_quantity(999), 999)

    def test_whole_number_floats_and_decimals_accepted(self):
        self.assertEqual(parse_quantity(3.0), 3)
        self.assertEqual(parse_quantity(Decimal("4.0")), 4)
        self.assertEqual(parse_quantity(Decimal("4")), 4)

    def test_numeric_strings_accepted(self):
        self.assertEqual(parse_quantity("3"), 3)
        self.assertEqual(parse_quantity(" 5 "), 5)

    def test_default_used_when_value_is_none(self):
        self.assertEqual(parse_quantity(None, default=1), 1)

    def test_missing_value_without_default_rejected(self):
        with self.assertRaises(QuantityValidationError):
            parse_quantity(None)

    def test_rejects_zero_and_negatives(self):
        for bad in (0, -1, -100, "0", "-2"):
            with self.subTest(bad=bad):
                with self.assertRaises(QuantityValidationError):
                    parse_quantity(bad)

    def test_rejects_quantity_beyond_max(self):
        for bad in (1000, 123456, "1000"):
            with self.subTest(bad=bad):
                with self.assertRaises(QuantityValidationError):
                    parse_quantity(bad)

    def test_rejects_fractional_values(self):
        for bad in (2.5, "2.5", Decimal("2.5")):
            with self.subTest(bad=bad):
                with self.assertRaises(QuantityValidationError):
                    parse_quantity(bad)

    def test_rejects_non_numeric_values(self):
        for bad in ("abc", "quantity", [], {}, None):
            with self.subTest(bad=bad):
                with self.assertRaises(QuantityValidationError):
                    parse_quantity(bad)

    def test_rejects_bool(self):
        with self.assertRaises(QuantityValidationError):
            parse_quantity(True)
        with self.assertRaises(QuantityValidationError):
            parse_quantity(False)

    def test_boundary_constants(self):
        self.assertEqual(MIN_ITEM_QUANTITY, 1)
        self.assertEqual(MAX_ITEM_QUANTITY, 999)


class PosOrderQuantityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user, self.merchant = self._make_merchant()
        self.client.force_authenticate(user=self.merchant_user)
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Momo", price=250, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till-1", device_token_hash="x", is_active=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", role="cashier",
            pin_hash="hashed",
        )

    @staticmethod
    def _make_merchant():
        user = get_user_model().objects.create_user(
            username="c5-pos", email="c5-pos@test.com", password="Pass123!", role="merchant"
        )
        merchant = MerchantProfile.objects.create(
            user=user, business_name="C5 Cafe", slug="c5-pos",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            table_ordering_enabled=True,
        )
        return user, merchant

    def _payload(self, quantity):
        return {
            "items": [{"menu_item_id": self.item.id, "quantity": quantity}],
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": str(uuid.uuid4()),
        }

    def _post(self, quantity):
        return self.client.post("/api/pos/order/create/", self._payload(quantity), format="json")

    def test_invalid_quantities_rejected_by_pos(self):
        for bad in (0, -3, 2.5, "abc", 1000, True, False):
            with self.subTest(bad=bad):
                resp = self._post(bad)
                self.assertEqual(resp.status_code, 400, resp.data)
                self.assertEqual(Order.objects.count(), 0)

    def test_missing_quantity_defaults_to_one(self):
        payload = {
            "items": [{"menu_item_id": self.item.id}],
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": str(uuid.uuid4()),
        }
        resp = self.client.post("/api/pos/order/create/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        item = OrderItem.objects.get()
        self.assertEqual(item.quantity, 1)

    def test_numeric_string_and_boundary_accepted_by_pos(self):
        resp = self._post("2")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(OrderItem.objects.get().quantity, 2)
        OrderItem.objects.all().delete()
        resp = self._post(999)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(OrderItem.objects.get().quantity, 999)


class TableOrderQuantityTests(TestCase):
    def setUp(self):
        self.anon = APIClient()
        _, self.merchant = PosOrderQuantityTests._make_merchant()
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Chowmein", price=150, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="T1", table_number=1,
            public_token="tok-abc", is_active=True,
        )

    def _post(self, quantity):
        return self.anon.post(
            f"/api/pos/table/{self.table.public_token}/order/",
            {"items": [{"menu_item_id": self.item.id, "quantity": quantity}]},
            format="json",
        )

    def test_invalid_quantities_rejected_by_table_order(self):
        for bad in (0, -3, 2.5, "abc", 1000, True, False):
            with self.subTest(bad=bad):
                resp = self._post(bad)
                self.assertEqual(resp.status_code, 400, resp.data)
                self.assertEqual(Order.objects.count(), 0)

    def test_valid_quantity_creates_order(self):
        resp = self._post(3)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(OrderItem.objects.get().quantity, 3)


class CustomerCreateQuantityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer_user = get_user_model().objects.create_user(
            username="c5-cust", email="c5-cust@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="C5 Customer",
        )
        self.client.force_authenticate(user=self.customer_user)
        _, self.merchant = PosOrderQuantityTests._make_merchant()
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Thukpa", price=200, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )

    def test_invalid_quantities_rejected_by_customer_create(self):
        # True coerces to 1 in DRF's IntegerField — only the C-5 guard catches it.
        for bad in (1000, True, False, 0, -2, 2.5):
            with self.subTest(bad=bad):
                resp = self.client.post(
                    "/api/orders/create/",
                    {"merchant_id": self.merchant.id,
                     "items": [{"menu_item_id": self.item.id, "quantity": bad}]},
                    format="json",
                )
                self.assertEqual(resp.status_code, 400, resp.data)


class GuestCreateQuantityTests(TestCase):
    def setUp(self):
        self.anon = APIClient()
        _, self.merchant = PosOrderQuantityTests._make_merchant()
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Pizza", price=300, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="T2", table_number=2,
            public_token="tok-guest", is_active=True,
        )

    def test_invalid_quantities_rejected_by_guest_create(self):
        for bad in (1000, True, False, 0, -2, 2.5):
            with self.subTest(bad=bad):
                resp = self.anon.post(
                    "/api/orders/guest-create/",
                    {"merchant_id": self.merchant.id,
                     "table_token": self.table.public_token,
                     "guest_session_id": "sess-1",
                     "items": [{"menu_item_id": self.item.id, "quantity": bad}]},
                    format="json",
                )
                self.assertEqual(resp.status_code, 400, resp.data)


class AddItemsQuantityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.customer_user = get_user_model().objects.create_user(
            username="c5-add", email="c5-add@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(user=self.customer_user, full_name="C5")
        self.client.force_authenticate(user=self.customer_user)
        _, self.merchant = PosOrderQuantityTests._make_merchant()
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Kebab", price=100, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.order = Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status="pending", order_type="regular", subtotal=100,
            total_amount=100,
        )

    def test_invalid_quantities_rejected_by_add_items(self):
        for bad in (1000, True, False, 0, -2, 2.5):
            with self.subTest(bad=bad):
                resp = self.client.post(
                    f"/api/orders/{self.order.id}/add-items/",
                    {"items": [{"menu_item_id": self.item.id, "quantity": bad}]},
                    format="json",
                )
                self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(OrderItem.objects.count(), 0)

    def test_valid_quantity_added(self):
        resp = self.client.post(
            f"/api/orders/{self.order.id}/add-items/",
            {"items": [{"menu_item_id": self.item.id, "quantity": 4}]},
            format="json",
        )
        self.assertEqual(resp.status_code in (200, 201), True, resp.data)
        self.assertEqual(OrderItem.objects.get().quantity, 4)