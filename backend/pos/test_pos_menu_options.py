"""
Regression guards for the POS screen with variants and modifiers.

The cashier path had the same blind spot as the customer table-QR path, but it
failed in two independent ways:

  1. `/pos/menu-snapshot/` listed products without their option groups, so the
     grid had no way to know that "Latte" needed a size before adding it.
  2. Even with a menu to read, the order-create endpoint is priced from the
     submitted selections, so a cart line that omitted them would be rejected
     (required group) or billed as the unconfigured base variant.

These tests pin both halves of that contract.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import (
    MerchantProfile,
    MenuItem,
    MenuOption,
    MenuOptionGroup,
)
from orders.models import Order, OrderItem, OrderItemOption
from pos.models import PosDevice


def _group(merchant, item, name, kind, **kwargs):
    return MenuOptionGroup.objects.create(
        merchant=merchant, menu_item=item, name=name, kind=kind, **kwargs
    )


class PosMenuSnapshotOptionTests(TestCase):
    """The offline/bootstrap snapshot the POS grid renders must carry groups."""

    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="pos-menu", email="pos-menu@test.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="POS Cafe", slug="pos-cafe",
            is_approved=True, is_open=True, onboarding_complete=True,
            pos_enabled=True, tax_rate_percent=0,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=250, category="Drinks",
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        self.size = _group(
            self.merchant, self.item, "Size", MenuOptionGroup.KIND_VARIANT,
            required=True, min_select=1, max_select=1,
        )
        self.small = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Small", price=200,
        )
        self.large = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Large", price=300,
        )
        self.extras = _group(
            self.merchant, self.item, "Extras", MenuOptionGroup.KIND_MODIFIER,
            required=False, min_select=0, max_select=2,
        )
        # Modifiers are priced by delta; variants carry an absolute price.
        self.cream = MenuOption.objects.create(
            group=self.extras, merchant=self.merchant, name="Cream", price_delta=30,
        )
        self.client.force_authenticate(self.user)

    def _snapshot(self):
        response = self.client.get("/api/pos/menu/snapshot/")
        self.assertEqual(response.status_code, 200, getattr(response, "data", response.content))
        return response.data

    def _latte(self, payload):
        for entries in payload["categories"].values():
            for entry in entries:
                if entry["id"] == self.item.id:
                    return entry
        self.fail("Latte missing from POS menu snapshot")

    def test_snapshot_includes_option_groups(self):
        """The grid must be able to see that this product needs a size."""
        latte = self._latte(self._snapshot())
        self.assertIn("groups", latte)
        by_name = {group["name"]: group for group in latte["groups"]}
        self.assertEqual(set(by_name), {"Size", "Extras"})

    def test_snapshot_group_flags_match_the_model(self):
        latte = self._latte(self._snapshot())
        by_name = {group["name"]: group for group in latte["groups"]}
        self.assertEqual(by_name["Size"]["kind"], MenuOptionGroup.KIND_VARIANT)
        self.assertTrue(by_name["Size"]["required"])
        self.assertEqual(by_name["Size"]["min_select"], 1)
        self.assertEqual(by_name["Size"]["max_select"], 1)
        self.assertFalse(by_name["Extras"]["required"])
        self.assertEqual(by_name["Extras"]["max_select"], 2)

    def test_snapshot_options_carry_their_prices(self):
        """The "from" price the grid displays is built from these numbers."""
        latte = self._latte(self._snapshot())
        size = next(g for g in latte["groups"] if g["name"] == "Size")
        options = {option["name"]: option for option in size["options"]}
        self.assertEqual(set(options), {"Small", "Large"})
        self.assertEqual(Decimal(options["Small"]["price"]), Decimal("200"))
        self.assertEqual(Decimal(options["Large"]["price"]), Decimal("300"))

    def test_item_without_groups_gets_an_empty_list(self):
        """A missing key would break the frontend's `item.groups ?? []` check."""
        plain = MenuItem.objects.create(
            merchant=self.merchant, name="Water", price=50, category="Drinks",
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        payload = self._snapshot()
        entry = next(
            item
            for items in payload["categories"].values()
            for item in items
            if item["id"] == plain.id
        )
        self.assertEqual(entry["groups"], [])

    def test_snapshot_does_not_leak_another_merchants_groups(self):
        other_user = get_user_model().objects.create_user(
            username="pos-other", email="pos-other@test.com", password="Pass123!",
            role="merchant",
        )
        other = MerchantProfile.objects.create(
            user=other_user, business_name="Rival", slug="rival",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        rival_item = MenuItem.objects.create(
            merchant=other, name="Rival Latte", price=999,
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        _group(other, rival_item, "Rival Size", MenuOptionGroup.KIND_VARIANT)

        latte = self._latte(self._snapshot())
        self.assertNotIn(
            "Rival Size", {group["name"] for group in latte["groups"]},
        )

    def test_snapshot_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/pos/menu/snapshot/").status_code, 401)


class PosBootstrapMenuOptionTests(TestCase):
    """
    The live POS grid is fed by `auth/bootstrap`, not by `menu/snapshot`.

    Regression: both bootstrap endpoints built their own inline menu payload
    without option groups, so the cashier grid had no way to know a product
    needed a size. Tapping it added a bare line and order creation then failed
    with "Chicken Lolipop: Choose one option for Big cup." — with no picker
    anywhere on screen to fix it.
    """

    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="pos-boot", email="pos-boot@test.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="Boot Cafe", slug="boot-cafe",
            is_approved=True, is_open=True, onboarding_complete=True,
            pos_enabled=True,
        )
        self.device, self.device_token = PosDevice.register(self.merchant, "Till 1")
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Chicken Lolipop", price=350,
            category="Snacks", is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        self.cup = _group(
            self.merchant, self.item, "Big cup", MenuOptionGroup.KIND_VARIANT,
            required=True, min_select=1, max_select=1,
        )
        self.regular = MenuOption.objects.create(
            group=self.cup, merchant=self.merchant, name="Regular", price=300,
        )
        self.large = MenuOption.objects.create(
            group=self.cup, merchant=self.merchant, name="Large", price=380,
        )
        self.client.force_authenticate(self.user)

    def _menu(self, response):
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        return response.data["menu"]["categories"]

    def _lollo(self, categories):
        for entries in categories.values():
            for entry in entries:
                if entry["id"] == self.item.id:
                    return entry
        self.fail("Chicken Lolipop missing from POS bootstrap menu")

    def test_jwt_bootstrap_carries_option_groups(self):
        response = self.client.post(
            "/api/pos/auth/bootstrap/", {"device_id": self.device.id}, format="json",
        )
        entry = self._lollo(self._menu(response))
        self.assertIn("groups", entry)
        group = next(g for g in entry["groups"] if g["name"] == "Big cup")
        self.assertTrue(group["required"])
        self.assertEqual(
            {o["name"] for o in group["options"]}, {"Regular", "Large"},
        )

    def test_device_bootstrap_carries_option_groups(self):
        """Token-auth bootstrap (used on page refresh) must match the JWT one."""
        response = self.client.get(
            "/api/pos/auth/device-bootstrap/",
            HTTP_X_POS_DEVICE_ID=str(self.device.id),
            HTTP_X_POS_DEVICE_TOKEN=self.device_token,
        )
        entry = self._lollo(self._menu(response))
        self.assertIn("groups", entry)
        self.assertTrue(any(g["name"] == "Big cup" for g in entry["groups"]))

    def test_bootstrap_hides_inactive_groups(self):
        self.cup.is_active = False
        self.cup.save()
        response = self.client.post(
            "/api/pos/auth/bootstrap/", {"device_id": self.device.id}, format="json",
        )
        entry = self._lollo(self._menu(response))
        self.assertEqual(entry["groups"], [])

    def test_bootstrap_carries_payment_config(self):
        """Tenders and the payment QR must reach the till, not just settings."""
        self.merchant.accepted_payment_methods = ["cash", "bank_qr"]
        self.merchant.payment_methods_configured = True
        self.merchant.payment_method_labels = {"bank_qr": "Fonepay QR"}
        self.merchant.payment_qr_enabled = True
        self.merchant.payment_qr_url = "https://cdn.example.com/qr.png"
        self.merchant.save()

        response = self.client.post(
            "/api/pos/auth/bootstrap/", {"device_id": self.device.id}, format="json",
        )
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        settings = response.data["pos_settings"]
        self.assertIn("bank_qr", settings["accepted_payment_methods"])
        self.assertIsNotNone(settings["payment_qr"])
        self.assertEqual(settings["payment_qr"]["url"], "https://cdn.example.com/qr.png")
        labels = {m["key"]: m["label"] for m in settings["payment_methods"]}
        self.assertEqual(labels["bank_qr"], "Fonepay QR")
        # `tax_enabled` was missing from the old hand-rolled copy.
        self.assertIn("tax_enabled", settings)

    def test_bootstrap_never_leaks_another_merchants_groups(self):
        other_user = get_user_model().objects.create_user(
            username="pos-boot-o", email="pos-boot-o@test.com", password="Pass123!",
            role="merchant",
        )
        other = MerchantProfile.objects.create(
            user=other_user, business_name="Rival", slug="rival",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        rival = MenuItem.objects.create(
            merchant=other, name="Rival Wings", price=999,
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        _group(other, rival, "Rival Cup", MenuOptionGroup.KIND_VARIANT)

        response = self.client.post(
            "/api/pos/auth/bootstrap/", {"device_id": self.device.id}, format="json",
        )
        entry = self._lollo(self._menu(response))
        self.assertNotIn("Rival Cup", {g["name"] for g in entry["groups"]})


class PosOrderSelectionsTests(TestCase):
    """Order creation must price and snapshot exactly what the cashier chose."""

    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            username="pos-order", email="pos-order@test.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="Order Cafe", slug="order-cafe",
            is_approved=True, is_open=True, onboarding_complete=True,
            pos_enabled=True, tax_rate_percent=0,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=250,
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )
        self.size = _group(
            self.merchant, self.item, "Size", MenuOptionGroup.KIND_VARIANT,
            required=True, min_select=1, max_select=1,
        )
        self.small = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Small", price=200,
        )
        self.large = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Large", price=300,
        )
        self.extras = _group(
            self.merchant, self.item, "Extras", MenuOptionGroup.KIND_MODIFIER,
            required=False, min_select=0, max_select=2,
        )
        self.cream = MenuOption.objects.create(
            group=self.extras, merchant=self.merchant, name="Cream", price_delta=30,
        )
        self.client.force_authenticate(self.user)

    def _create(self, items, **overrides):
        payload = {
            "merchant_id": self.merchant.id,
            "items": items,
            "fulfillment_type": "takeaway",
        }
        payload.update(overrides)
        return self.client.post("/api/pos/order/create/", payload, format="json")

    def test_selected_variant_is_priced_and_snapshotted(self):
        response = self._create([{
            "menu_item_id": self.item.id,
            "quantity": 1,
            "selections": [
                {"group_id": self.size.id, "option_id": self.large.id},
                {"group_id": self.extras.id, "option_id": self.cream.id},
            ],
            "special_instructions": "Extra hot",
        }])
        self.assertEqual(response.status_code, 201, response.data)

        order = Order.objects.get(id=response.data["id"])
        # Large (300) + Cream (30), not the 250 base price.
        self.assertEqual(order.subtotal, Decimal("330"))
        self.assertEqual(order.total_amount, Decimal("330"))

        line = OrderItem.objects.get(order=order)
        # Unit price carries the variant (300) plus the modifier delta (30).
        self.assertEqual(line.price, Decimal("330"))
        self.assertEqual(line.special_instructions, "Extra hot")
        options = set(
            OrderItemOption.objects.filter(order_item=line)
            .values_list("option_name", flat=True)
        )
        self.assertEqual(options, {"Large", "Cream"})

    def test_missing_required_group_is_rejected(self):
        """A cart line that dropped its selections must not silently price."""
        response = self._create([{"menu_item_id": self.item.id, "quantity": 1}])
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("Size", str(response.data))
        self.assertEqual(Order.objects.count(), 0)

    def test_client_sent_price_is_ignored(self):
        response = self._create([{
            "menu_item_id": self.item.id,
            "quantity": 1,
            "price": "1.00",
            "subtotal": "1.00",
            "selections": [
                {"group_id": self.size.id, "option_id": self.large.id},
            ],
        }])
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.subtotal, Decimal("300"))

    def test_two_configurations_stay_two_lines(self):
        response = self._create([
            {
                "menu_item_id": self.item.id,
                "quantity": 1,
                "selections": [
                    {"group_id": self.size.id, "option_id": self.small.id},
                ],
            },
            {
                "menu_item_id": self.item.id,
                "quantity": 1,
                "selections": [
                    {"group_id": self.size.id, "option_id": self.large.id},
                ],
            },
        ])
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.items.count(), 2)
        self.assertEqual(order.subtotal, Decimal("500"))

    def test_quantity_multiplies_the_configured_price(self):
        response = self._create([{
            "menu_item_id": self.item.id,
            "quantity": 3,
            "selections": [
                {"group_id": self.size.id, "option_id": self.large.id},
            ],
        }])
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.items.get().quantity, 3)
        self.assertEqual(order.subtotal, Decimal("900"))

    def test_staff_free_order_records_the_configuration(self):
        """A comp order is free, but the kitchen still needs to know the size."""
        response = self._create([{
            "menu_item_id": self.item.id,
            "quantity": 1,
            "selections": [
                {"group_id": self.size.id, "option_id": self.large.id},
            ],
        }], order_type="staff_comp")
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(id=response.data["id"])
        self.assertEqual(order.subtotal, Decimal("0"))
        line = OrderItem.objects.get(order=order)
        self.assertEqual(line.price, Decimal("0"))
        self.assertIn(
            "Large",
            set(OrderItemOption.objects.filter(order_item=line)
                .values_list("option_name", flat=True)),
        )
