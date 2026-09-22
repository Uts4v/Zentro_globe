"""
Tests for the variant/modifier (option group) menu system, server-side
authoritative pricing, structured order snapshots, and the public catalog.

Run with: python manage.py test merchants.test_menu_options orders.test_menu_options
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from config.menu_pricing import validate_and_price_line, LineValidationError
from merchants.models import MerchantProfile, MenuItem, MenuCategory, MenuOptionGroup, MenuOption
from orders.models import Order, OrderItem, OrderItemOption
from loyalty.models import TodaySpecial
from merchants.models import MerchantTable


def make_merchant(user, slug):
    return MerchantProfile.objects.create(
        user=user, business_name=slug.replace("-", " ").title(),
        slug=slug, is_approved=True, is_open=True,
    )


class OptionGroupPricingTests(TestCase):
    def setUp(self):
        u1 = get_user_model().objects.create_user(
            username="u1", email="u1@t.com", password="Pass123!", role="merchant"
        )
        u2 = get_user_model().objects.create_user(
            username="u2", email="u2@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(u1, "cafe-a")
        self.merchant2 = make_merchant(u2, "cafe-b")

        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Burger", price="250.00",
            category="Main", is_available=True,
        )
        self.size_group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Size",
            kind="variant", required=True, min_select=1, max_select=1, display_order=0,
        )
        self.small = MenuOption.objects.create(
            merchant=self.merchant, group=self.size_group, name="Small",
            price="200.00", display_order=0,
        )
        self.large = MenuOption.objects.create(
            merchant=self.merchant, group=self.size_group, name="Large",
            price="320.00", display_order=1,
        )
        self.extras = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Extras",
            kind="modifier", required=False, min_select=0, max_select=3, display_order=1,
        )
        self.cheese = MenuOption.objects.create(
            merchant=self.merchant, group=self.extras, name="Extra cheese",
            price_delta="50.00", display_order=0,
        )

        # Cross-merchant group/option for isolation tests.
        self.other_item = MenuItem.objects.create(
            merchant=self.merchant2, name="Other Pizza", price="100.00", category="Pizza",
        )
        self.other_opt = MenuOption.objects.create(
            merchant=self.merchant2, group=MenuOptionGroup.objects.create(
                merchant=self.merchant2, menu_item=self.other_item,
                name="Size", kind="variant", required=True,
            ),
            name="Large", price="140.00",
        )

    def _pair(self, group, option):
        return (group.id, option.id)

    def test_base_price_when_no_variant_price(self):
        self.small.price = None
        self.small.save()
        line = validate_and_price_line(
            self.item, 1, [self._pair(self.size_group, self.small)]
        )
        self.assertEqual(line.unit_price, Decimal("250.00"))
        self.assertEqual(line.subtotal, Decimal("250.00"))

    def test_variant_absolute_price_replaces_base(self):
        line = validate_and_price_line(
            self.item, 2, [self._pair(self.size_group, self.large)]
        )
        self.assertEqual(line.unit_price, Decimal("320.00"))
        self.assertEqual(line.subtotal, Decimal("640.00"))

    def test_modifier_delta_added_on_top(self):
        line = validate_and_price_line(
            self.item,
            1,
            [self._pair(self.size_group, self.small), self._pair(self.extras, self.cheese)],
        )
        self.assertEqual(line.unit_price, Decimal("250.00"))
        self.assertEqual(line.subtotal, Decimal("250.00"))

    def test_required_group_missing_is_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 1, [])
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 1, [self._pair(self.extras, self.cheese)])

    def test_variant_with_multiple_selections_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.item, 1,
                [self._pair(self.size_group, self.small), self._pair(self.size_group, self.large)],
            )

    def test_cross_merchant_option_rejected(self):
        # Option belongs to another merchant — must not validate for self.item.
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 1, [self._pair(self.size_group, self.other_opt)])

    def test_sold_out_item_rejected(self):
        self.item.is_available = False
        self.item.save()
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 1, [self._pair(self.size_group, self.small)])

    def test_archived_item_rejected(self):
        self.item.status = "archived"
        self.item.save()
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 1, [self._pair(self.size_group, self.small)])

    def test_bad_quantity_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, 0, [self._pair(self.size_group, self.small)])
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.item, "x", [self._pair(self.size_group, self.small)])

    def test_points_computed_when_loyalty_enabled(self):
        self.item.points_per_item = 7
        self.item.save()
        line = validate_and_price_line(self.item, 3, [self._pair(self.size_group, self.small)])
        self.assertEqual(line.points, 21)
        line = validate_and_price_line(
            self.item, 3, [self._pair(self.size_group, self.small)], loyalty_eligible=False
        )
        self.assertEqual(line.points, 0)


class OptionOrderFlowTests(TestCase):
    """End-to-end: create order with selections -> snapshot stored -> price correct."""

    def setUp(self):
        self.client = APIClient()
        user = get_user_model().objects.create_user(
            username="cust1", email="cust1@t.com", password="Pass123!", role="customer"
        )
        m_user = get_user_model().objects.create_user(
            username="m1", email="m1@t.com", password="Pass123!", role="merchant"
        )
        from accounts.models import CustomerProfile
        self.customer = CustomerProfile.objects.create(user=user, full_name="Yuri")
        self.merchant = make_merchant(m_user, "burgers-and-co")
        self.client.force_authenticate(user=user)

        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Combo", price="150.00", category="Main",
        )
        self.group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Pack",
            kind="variant", required=True,
        )
        self.opt_small = MenuOption.objects.create(
            merchant=self.merchant, group=self.group, name="Small", price="140.00",
        )
        MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Add",
            kind="modifier", max_select=2,
        )

    def test_create_order_with_selections_snapshots_options(self):
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant.id,
            "items": [{
                "menu_item_id": self.item.id,
                "quantity": 2,
                "selections": [{"group_id": self.group.id, "option_id": self.opt_small.id}],
                "special_instructions": "No onions",
            }],
            "fulfillment_type": "pickup",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(id=resp.data["id"])
        self.assertEqual(order.subtotal, Decimal("280.00"))

        oi = order.items.get()
        self.assertEqual(oi.price, Decimal("140.00"))
        self.assertEqual(oi.quantity, 2)
        self.assertEqual(oi.special_instructions, "No onions")
        snapshot = oi.options.get()
        self.assertEqual(snapshot.option_name, "Small")
        self.assertEqual(snapshot.group_name, "Pack")
        self.assertEqual(snapshot.kind, "variant")

    def test_preview_returns_authoritative_total_without_creating_order(self):
        resp = self.client.post("/api/orders/preview/", {
            "merchant_id": self.merchant.id,
            "items": [{
                "menu_item_id": self.item.id,
                "quantity": 1,
                "selections": [{"group_id": self.group.id, "option_id": self.opt_small.id}],
            }],
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(Decimal(resp.data["subtotal"]), Decimal("140.00"))
        self.assertEqual(len(resp.data["lines"]), 1)
        self.assertEqual(resp.data["lines"][0]["options"][0]["option_name"], "Small")

    def test_create_order_rejects_missing_required_group(self):
        resp = self.client.post("/api/orders/create/", {
            "merchant_id": self.merchant.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 1}],
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn("Pack", resp.data["error"])
        self.assertEqual(Order.objects.count(), 0)


class PublicCatalogTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        m_user = get_user_model().objects.create_user(
            username="cafem", email="cafem@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(m_user, "catalog-cafe")
        self.cat = MenuCategory.objects.create(merchant=self.merchant, name="Drinks", emoji="☕")
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Mocha", price="180.00",
            category="Drinks", category_ref=self.cat,
            status="active", is_available=True,
        )
        g = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Size", kind="variant", required=True,
        )
        self.big = MenuOption.objects.create(
            merchant=self.merchant, group=g, name="Big", price="220.00",
        )
        self.archived = MenuItem.objects.create(
            merchant=self.merchant, name="Old item", price="50.00", status="archived",
        )

    def test_catalog_excludes_archived_and_includes_groups(self):
        resp = self.client.get(f"/api/merchants/{self.merchant.id}/menu/catalog/")
        self.assertEqual(resp.status_code, 200, resp.data)
        names = [i["name"] for i in resp.data["items"]]
        self.assertIn("Mocha", names)
        self.assertNotIn("Old item", names)

        mocha = next(i for i in resp.data["items"] if i["name"] == "Mocha")
        self.assertEqual(mocha["from_price"], Decimal("220.00"))
        self.assertIs(mocha["is_available"], True)
        self.assertEqual(mocha["status"], "active")
        size_grp = mocha["groups"][0]
        self.assertEqual(size_grp["kind"], "variant")
        self.assertEqual(size_grp["options"][0]["price"], "220.00")

        cats = resp.data["categories"]
        self.assertEqual(cats[0]["name"], "Drinks")
        self.assertEqual(self.merchant.id, resp.data["merchant"]["id"])

    def test_catalog_search_and_category_filter(self):
        # Search
        resp = self.client.get(
            f"/api/merchants/{self.merchant.id}/menu/catalog/?q=moch"
        )
        self.assertEqual([i["name"] for i in resp.data["items"]], ["Mocha"])

        # Category filter
        resp = self.client.get(
            f"/api/merchants/{self.merchant.id}/menu/catalog/?category_id={self.cat.id}"
        )
        self.assertEqual([i["name"] for i in resp.data["items"]], ["Mocha"])

    def test_categories_backfilled_from_legacy_category_string(self):
        # A legacy item without category_ref still appears in the catalog,
        # grouped under its free-text category via the backfilled MenuCategory.
        legacy = MenuItem.objects.create(
            merchant=self.merchant, name="Legacy", price="10.00", category="Snacks", is_available=True,
        )
        # category_ref not set — item included, category name retained
        resp = self.client.get(f"/api/merchants/{self.merchant.id}/menu/catalog/")
        items = {i["name"]: i for i in resp.data["items"]}
        self.assertIn("Legacy", items)
        self.assertEqual(items["Legacy"]["category"], "Snacks")


class SpecialScheduleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        m_user = get_user_model().objects.create_user(
            username="specm", email="specm@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(m_user, "specials-bakery")
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Croissant", price="100.00",
        )

    def _special(self, **overrides):
        data = dict(
            merchant=self.merchant,
            title="Fresh Croissant",
            linked_menu_item=self.item,
            is_active=True,
        )
        data.update(overrides)
        return TodaySpecial.objects.create(**data)

    def test_scheduled_special_hidden_outside_window(self):
        now = timezone.now()
        past = self._special(ends_at=now - timezone.timedelta(hours=1))
        future = self._special(starts_at=now + timezone.timedelta(hours=2))
        active = self._special(starts_at=now - timezone.timedelta(hours=2), ends_at=now + timezone.timedelta(hours=2))

        resp = self.client.get(f"/api/loyalty/specials/{self.merchant.slug}/")
        self.assertEqual(resp.status_code, 200)
        ids = [s["id"] for s in resp.data]
        self.assertIn(active.id, ids)
        self.assertNotIn(past.id, ids)
        self.assertNotIn(future.id, ids)

    def test_default_cta_label_present(self):
        special = self._special()
        resp = self.client.get(f"/api/loyalty/specials/{self.merchant.slug}/")
        first = resp.data[0]
        self.assertEqual(first["id"], special.id)
        self.assertEqual(first["cta_label"], "Order now")


class PosTableOrderTests(TestCase):
    """QR table ordering: menu exposes options; order flow snapshots selections."""

    def setUp(self):
        self.client = APIClient()
        m_user = get_user_model().objects.create_user(
            username="tabm", email="tabm@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(m_user, "table-bites")
        self.merchant.table_ordering_enabled = True
        self.merchant.save()
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="Table 1", table_number=1,
        )
        c_user = get_user_model().objects.create_user(
            username="tabc", email="tabc@t.com", password="Pass123!", role="customer"
        )
        from accounts.models import CustomerProfile
        self.customer = CustomerProfile.objects.create(user=c_user, full_name="Zed")
        self.client.force_authenticate(user=c_user)

        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Nachos", price="200.00", category="Snacks",
        )
        self.group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Size",
            kind="variant", required=True,
        )
        self.big = MenuOption.objects.create(
            merchant=self.merchant, group=self.group, name="Big", price="260.00",
        )

    def test_table_menu_includes_option_groups(self):
        resp = self.client.get(f"/api/pos/table/{self.table.public_token}/menu/")
        self.assertEqual(resp.status_code, 200, resp.data)
        item = resp.data["categories"]["Snacks"][0]
        self.assertEqual(item["groups"][0]["name"], "Size")
        self.assertEqual(item["groups"][0]["options"][0]["price"], "260.00")

    def test_table_order_with_selection_stores_snapshot(self):
        resp = self.client.post(f"/api/pos/table/{self.table.public_token}/order/", {
            "items": [{
                "menu_item_id": self.item.id,
                "quantity": 1,
                "selections": [{"group_id": self.group.id, "option_id": self.big.id}],
            }],
            "customer_name": "Zed",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(merchant=self.merchant)
        self.assertEqual(order.subtotal, Decimal("260.00"))
        oi = order.items.get()
        self.assertEqual(oi.price, Decimal("260.00"))
        self.assertEqual(oi.options.get().option_name, "Big")

    def test_table_order_rejects_cross_merchant_option(self):
        other_m_user = get_user_model().objects.create_user(
            username="tabb", email="tabb@t.com", password="Pass123!", role="merchant"
        )
        other_merchant = make_merchant(other_m_user, "other-bites")
        other_item = MenuItem.objects.create(
            merchant=other_merchant, name="X", price="50.00",
        )
        other_opt = MenuOption.objects.create(
            merchant=other_merchant,
            group=MenuOptionGroup.objects.create(
                merchant=other_merchant, menu_item=other_item, name="Size", kind="variant", required=True,
            ),
            name="L", price="80.00",
        )
        resp = self.client.post(f"/api/pos/table/{self.table.public_token}/order/", {
            "items": [{
                "menu_item_id": self.item.id,
                "quantity": 1,
                "selections": [
                    {"group_id": other_item.option_groups.first().id, "option_id": other_opt.id},
                ],
            }],
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)


class MenuItemDiscountTests(TestCase):
    """Item-level discounts: pricing, Today's Special sync, and expiry guard."""

    def setUp(self):
        m_user = get_user_model().objects.create_user(
            username="discm", email="discm@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(m_user, "discount-cafe")
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price="200.00",
        )

    def _discount(self, discount_type, value, source=MenuItem.DISCOUNT_SOURCE_MANUAL):
        self.item.discount_type = discount_type
        self.item.discount_value = Decimal(value)
        self.item.discount_source = source
        self.item.save()
        self.item.refresh_from_db()
        return self.item

    def test_percentage_discount_applied_to_base_price(self):
        self._discount(MenuItem.DISCOUNT_PERCENTAGE, "15.00")
        line = validate_and_price_line(self.item, 1)
        self.assertEqual(line.unit_price, Decimal("170.00"))
        self.assertEqual(line.original_unit_price, Decimal("200.00"))
        self.assertEqual(line.unit_discount, Decimal("30.00"))

    def test_fixed_discount_applied_to_base_price(self):
        self._discount(MenuItem.DISCOUNT_FIXED, "50.00")
        line = validate_and_price_line(self.item, 2)
        self.assertEqual(line.unit_price, Decimal("150.00"))
        self.assertEqual(line.subtotal, Decimal("300.00"))
        self.assertEqual(line.unit_discount, Decimal("50.00"))

    def test_fixed_discount_never_goes_negative(self):
        self._discount(MenuItem.DISCOUNT_FIXED, "500.00")
        line = validate_and_price_line(self.item, 1)
        self.assertEqual(line.unit_price, Decimal("0.00"))
        self.assertEqual(line.unit_discount, Decimal("200.00"))

    def test_variant_absolute_price_is_not_discounted(self):
        self._discount(MenuItem.DISCOUNT_PERCENTAGE, "50.00")
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Size",
            kind="variant", required=True,
        )
        big = MenuOption.objects.create(
            merchant=self.merchant, group=group, name="Big", price="300.00",
        )
        line = validate_and_price_line(self.item, 1, [(group.id, big.id)])
        self.assertEqual(line.unit_price, Decimal("300.00"))

    def test_modifier_added_after_discount(self):
        self._discount(MenuItem.DISCOUNT_PERCENTAGE, "10.00")
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.item, name="Extras",
            kind="modifier", required=False, min_select=0, max_select=3,
        )
        shot = MenuOption.objects.create(
            merchant=self.merchant, group=group, name="Extra shot", price_delta="20.00",
        )
        line = validate_and_price_line(self.item, 1, [(group.id, shot.id)])
        self.assertEqual(line.unit_price, Decimal("200.00"))

    def test_special_discount_syncs_onto_linked_item(self):
        TodaySpecial.objects.create(
            merchant=self.merchant, title="Latte day", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_PERCENTAGE, discount_value=Decimal("25.00"),
            is_active=True,
        )
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_type, MenuItem.DISCOUNT_PERCENTAGE)
        self.assertEqual(self.item.discount_value, Decimal("25.00"))
        self.assertEqual(self.item.discount_source, MenuItem.DISCOUNT_SOURCE_SPECIAL)

        line = validate_and_price_line(self.item, 1)
        self.assertEqual(line.unit_price, Decimal("150.00"))

    def test_deleting_special_clears_synced_discount(self):
        special = TodaySpecial.objects.create(
            merchant=self.merchant, title="Latte day", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_FIXED, discount_value=Decimal("40.00"),
            is_active=True,
        )
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_type, MenuItem.DISCOUNT_FIXED)

        special.delete()
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_type, MenuItem.DISCOUNT_NONE)
        self.assertIsNone(self.item.discount_value)
        self.assertEqual(self.item.discount_source, MenuItem.DISCOUNT_SOURCE_MANUAL)

    def test_deactivating_special_clears_synced_discount(self):
        special = TodaySpecial.objects.create(
            merchant=self.merchant, title="Latte day", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_PERCENTAGE, discount_value=Decimal("10.00"),
            is_active=True,
        )
        special.is_active = False
        special.discount_type = TodaySpecial.DISCOUNT_NONE
        special.save()
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_type, MenuItem.DISCOUNT_NONE)

    def test_expired_special_discount_is_ignored_at_pricing(self):
        now = timezone.now()
        TodaySpecial.objects.create(
            merchant=self.merchant, title="Yesterday", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_PERCENTAGE, discount_value=Decimal("50.00"),
            is_active=True, ends_at=now - timezone.timedelta(hours=1),
        )
        self.item.refresh_from_db()
        # Persisted discount exists, but the window has passed.
        self.assertEqual(self.item.discount_type, MenuItem.DISCOUNT_PERCENTAGE)

        line = validate_and_price_line(self.item, 1)
        self.assertEqual(line.unit_price, Decimal("200.00"))
        self.assertEqual(line.unit_discount, Decimal("0.00"))

    def test_catalog_exposes_effective_discount(self):
        self._discount(MenuItem.DISCOUNT_PERCENTAGE, "20.00")
        client = APIClient()
        resp = client.get(f"/api/merchants/{self.merchant.id}/menu/catalog/")
        self.assertEqual(resp.status_code, 200, resp.data)
        latte = next(i for i in resp.data["items"] if i["name"] == "Latte")
        self.assertEqual(latte["discount_type"], "percentage")
        self.assertEqual(latte["discount_value"], "20.00")
        self.assertEqual(latte["discount_price"], Decimal("160.00"))
        self.assertEqual(latte["discount_amount"], Decimal("40.00"))

    def test_serializer_edit_flips_special_source_to_manual(self):
        from merchants.serializers import MenuItemEditorSerializer

        TodaySpecial.objects.create(
            merchant=self.merchant, title="Latte day", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_PERCENTAGE, discount_value=Decimal("25.00"),
            is_active=True,
        )
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_source, MenuItem.DISCOUNT_SOURCE_SPECIAL)

        serializer = MenuItemEditorSerializer(
            self.item, data={"discount_value": "10.00"}, partial=True,
            context={"merchant": self.merchant},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_source, MenuItem.DISCOUNT_SOURCE_MANUAL)
        self.assertEqual(self.item.discount_value, Decimal("10.00"))

    def test_serializer_saving_unchanged_discount_keeps_special_source(self):
        from merchants.serializers import MenuItemEditorSerializer

        TodaySpecial.objects.create(
            merchant=self.merchant, title="Latte day", linked_menu_item=self.item,
            discount_type=TodaySpecial.DISCOUNT_PERCENTAGE, discount_value=Decimal("25.00"),
            is_active=True,
        )
        self.item.refresh_from_db()
        serializer = MenuItemEditorSerializer(
            self.item, data={"discount_value": "25.00"}, partial=True,
            context={"merchant": self.merchant},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.item.refresh_from_db()
        self.assertEqual(self.item.discount_source, MenuItem.DISCOUNT_SOURCE_SPECIAL)


class TaxPreviewTests(TestCase):
    """Order preview surfaces VAT/other tax components for the cart, honoring tax_enabled."""

    def setUp(self):
        self.client = APIClient()
        m_user = get_user_model().objects.create_user(
            username="taxm", email="taxm@t.com", password="Pass123!", role="merchant"
        )
        self.merchant = make_merchant(m_user, "tax-cafe")
        self.merchant.tax_enabled = True
        self.merchant.tax_components = [{"name": "VAT", "rate": 13}]
        self.merchant.save()
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Thali", price="200.00",
        )

    def _preview(self):
        return self.client.post("/api/orders/preview/", {
            "merchant_id": self.merchant.id,
            "items": [{"menu_item_id": self.item.id, "quantity": 1}],
        }, format="json")

    def test_preview_returns_tax_amount_and_breakdown(self):
        resp = self._preview()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(resp.data["subtotal"]), Decimal("200.00"))
        self.assertEqual(Decimal(resp.data["tax_amount"]), Decimal("26.00"))
        self.assertEqual(resp.data["tax_breakdown"][0]["name"], "VAT")
        self.assertEqual(resp.data["tax_breakdown"][0]["rate"], 13.0)
        self.assertEqual(resp.data["tax_breakdown"][0]["amount"], 26.0)
        self.assertEqual(Decimal(resp.data["total_amount"]), Decimal("226.00"))

    def test_preview_omits_tax_when_disabled(self):
        self.merchant.tax_enabled = False
        self.merchant.save()
        resp = self._preview()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(resp.data["tax_amount"]), Decimal("0"))
        self.assertEqual(resp.data["tax_breakdown"], [])
        self.assertEqual(Decimal(resp.data["total_amount"]), Decimal("200.00"))

    def test_preview_legacy_rate_fallback(self):
        self.merchant.tax_components = []
        self.merchant.tax_rate_percent = Decimal("6.00")
        self.merchant.save()
        resp = self._preview()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(resp.data["tax_amount"]), Decimal("12.00"))
        self.assertEqual(resp.data["tax_breakdown"][0]["name"], "VAT")


