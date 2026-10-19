"""
Custom (ad-hoc) POS items: a one-off line with a manual price, no menu item.

Run with: python manage.py test pos.test_custom_items
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from merchants.models import MenuItem, MerchantProfile, MerchantTable
from orders.models import Order
from orders.pricing import PricingError
from orders.pricing.items import price_custom_line
from orders.serializers import CreateOrderItemSerializer, OrderItemSerializer
from pos import rbac
from pos.models import ShiftWorker

User = get_user_model()
D = Decimal


class CustomLinePricingTests(SimpleTestCase):
    def row(self, **overrides):
        base = {"is_custom": True, "name": "Off-menu special", "price": "350.00", "quantity": 2}
        base.update(overrides)
        return base

    def test_prices_from_the_request(self):
        priced = price_custom_line(self.row())
        self.assertIsNone(priced.item_fields["menu_item"])
        self.assertTrue(priced.item_fields["is_custom"])
        self.assertEqual(priced.item_fields["name"], "Off-menu special")
        self.assertEqual(priced.item_fields["price"], D("350.00"))
        self.assertEqual(priced.item_fields["subtotal"], D("700.00"))
        self.assertEqual(priced.item_fields["tax_class"], "standard")
        self.assertEqual(priced.points, 0)
        self.assertIsNone(priced.line.menu_item_id)

    def test_quantity_defaults_to_one(self):
        priced = price_custom_line(self.row(quantity=None))
        self.assertEqual(priced.item_fields["quantity"], 1)

    def test_free_line_is_charged_nothing(self):
        priced = price_custom_line(self.row(is_free=True), allow_free=True)
        self.assertEqual(priced.item_fields["price"], D("0"))
        self.assertEqual(priced.item_fields["subtotal"], D("0"))
        self.assertEqual(priced.item_fields["list_unit_price"], D("350.00"))
        self.assertTrue(priced.item_fields["is_complimentary"])
        self.assertEqual(priced.item_fields["complimentary_value"], D("700.00"))

    def test_staff_comp_is_charged_nothing_without_complimentary_flag(self):
        priced = price_custom_line(self.row(), staff_comp=True)
        self.assertEqual(priced.item_fields["price"], D("0"))
        self.assertFalse(priced.item_fields.get("is_complimentary", False))

    def test_rejections(self):
        cases = [
            self.row(name=""),
            self.row(name="   "),
            self.row(price=None),
            self.row(price=""),
            self.row(price="not-a-number"),
            self.row(price="-1"),
            self.row(price="100000000"),
            self.row(quantity=0),
            self.row(selections=[{"group_id": 1, "option_id": 2}]),
        ]
        for row in cases:
            with self.subTest(row=row):
                with self.assertRaises(PricingError) as ctx:
                    price_custom_line(row)
                self.assertEqual(ctx.exception.code, "invalid_custom_item")


class CustomItemEndpointTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(
            username="custom-owner", email="custom-owner@test.com",
            password="Pass123!", role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.owner, business_name="Custom Cafe", slug="custom-cafe",
            is_approved=True, is_open=True, onboarding_complete=True,
            pos_enabled=True, table_ordering_enabled=True,
            allow_pickup=True, allow_dine_in=True,
            tax_enabled=False, currency_code="NPR", currency_symbol="Rs",
        )
        self.latte = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=200, is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="Table 1", table_number=1,
            public_token="custom-tok", is_active=True,
        )
        roles = rbac.ensure_default_roles(self.merchant)
        self.cashier = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Cashier", pin_hash="x",
            role=ShiftWorker.ROLE_CASHIER, staff_role=roles[rbac.ROLE_CASHIER],
            is_active=True,
        )
        self.manager = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Manager", pin_hash="x",
            role=ShiftWorker.ROLE_MANAGER, staff_role=roles[rbac.ROLE_MANAGER],
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def custom_item(self, **overrides):
        item = {"is_custom": True, "name": "Off-menu", "price": "350.00", "quantity": 2}
        item.update(overrides)
        return item

    def create_order(self, items, **extra):
        return self.client.post(
            "/api/pos/order/create/",
            {"items": items, "fulfillment_type": "pickup", **extra},
            format="json",
        )

    def test_pos_creates_a_custom_only_order(self):
        resp = self.create_order([self.custom_item()])
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(pk=resp.data["id"])
        item = order.items.get()
        self.assertTrue(item.is_custom)
        self.assertIsNone(item.menu_item_id)
        self.assertEqual(item.name, "Off-menu")
        self.assertEqual(item.price, D("350.00"))
        self.assertEqual(item.subtotal, D("700.00"))

    def test_pos_creates_a_mixed_order(self):
        resp = self.create_order([
            {"menu_item_id": self.latte.id, "quantity": 1},
            self.custom_item(),
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.items.count(), 2)
        self.assertEqual(order.items.filter(is_custom=True).count(), 1)
        self.assertEqual(order.subtotal, D("900.00"))

    def test_cashier_cannot_add_custom_items(self):
        resp = self.create_order([self.custom_item()], worker_id=str(self.cashier.id))
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data.get("required_permission"), "items.custom")
        self.assertFalse(Order.objects.exists())

    def test_manager_can_add_custom_items(self):
        resp = self.create_order([self.custom_item()], worker_id=str(self.manager.id))
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_cashier_still_creates_normal_orders(self):
        resp = self.create_order(
            [{"menu_item_id": self.latte.id, "quantity": 1}],
            worker_id=str(self.cashier.id),
        )
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_customer_qr_order_rejects_custom_items(self):
        resp = APIClient().post(
            f"/api/pos/table/{self.table.public_token}/order/",
            {"items": [self.custom_item()]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_merchant_can_append_a_custom_item(self):
        created = self.create_order([{"menu_item_id": self.latte.id, "quantity": 1}])
        self.assertEqual(created.status_code, 201, created.data)
        order = Order.objects.get(pk=created.data["id"])

        resp = self.client.post(
            f"/api/orders/{order.id}/add-items/",
            {"items": [self.custom_item(quantity=1)]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(order.items.filter(is_custom=True).count(), 1)

    def test_order_item_serializer_exposes_custom_flag(self):
        created = self.create_order([self.custom_item()])
        order = Order.objects.get(pk=created.data["id"])
        data = OrderItemSerializer(order.items.get()).data
        self.assertTrue(data["is_custom"])


class CustomItemSerializerTests(SimpleTestCase):
    def test_custom_is_refused_without_the_endpoint_opt_in(self):
        serializer = CreateOrderItemSerializer(data={
            "is_custom": True, "name": "Off-menu", "price": "10.00", "quantity": 1,
        })
        self.assertFalse(serializer.is_valid())
        self.assertIn("is_custom", serializer.errors)

    def test_custom_is_accepted_with_the_opt_in(self):
        serializer = CreateOrderItemSerializer(
            data={"is_custom": True, "name": "Off-menu", "price": "10.00", "quantity": 1},
            context={"allow_custom": True},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_custom_requires_name_and_price(self):
        for payload in (
            {"is_custom": True, "price": "10.00", "quantity": 1},
            {"is_custom": True, "name": "Off-menu", "quantity": 1},
        ):
            with self.subTest(payload=payload):
                serializer = CreateOrderItemSerializer(
                    data=payload, context={"allow_custom": True},
                )
                self.assertFalse(serializer.is_valid())

    def test_normal_line_still_requires_a_menu_item(self):
        serializer = CreateOrderItemSerializer(data={"quantity": 1})
        self.assertFalse(serializer.is_valid())
        self.assertIn("menu_item_id", serializer.errors)
