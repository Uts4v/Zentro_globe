"""
Variant / modifier hardening tests.

Covers the guarantees the variant + modifier feature depends on:

  * a product with no configured groups still orders at its base price
  * required groups, min/max selection bounds and single-select rules
  * default variants and disabled (unavailable) options
  * wrong-product and cross-merchant ids are rejected server-side
  * the backend recomputes price from the database and ignores any
    client-sent price

Run with: python manage.py test merchants.test_menu_options_hardening
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from config.menu_pricing import LineValidationError, validate_and_price_line
from merchants.models import (
    MerchantProfile, MenuItem, MenuOption, MenuOptionGroup,
)
from orders.models import Order, OrderItem, OrderItemOption


def make_merchant(username, slug):
    user = get_user_model().objects.create_user(
        username=username, email=f"{username}@t.com", password="Pass123!",
        role="merchant",
    )
    return MerchantProfile.objects.create(
        user=user, business_name=slug.replace("-", " ").title(),
        slug=slug, is_approved=True, is_open=True,
    )


class OptionGroupTestBase(TestCase):
    """Shared fixture: a Pizza with a required Size group and a Milk group."""

    def setUp(self):
        self.merchant = make_merchant("mv1", "pizza-a")
        self.other_merchant = make_merchant("mv2", "pizza-b")

        self.pizza = MenuItem.objects.create(
            merchant=self.merchant, name="Margherita Pizza", price="450.00",
            category="Pizza", is_available=True,
        )
        self.size = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.pizza, name="Size",
            kind="variant", required=True, min_select=1, max_select=1, display_order=0,
        )
        self.small = MenuOption.objects.create(
            merchant=self.merchant, group=self.size, name="Small",
            price="450.00", display_order=0, is_default=True,
        )
        self.medium = MenuOption.objects.create(
            merchant=self.merchant, group=self.size, name="Medium",
            price="650.00", display_order=1,
        )
        self.large = MenuOption.objects.create(
            merchant=self.merchant, group=self.size, name="Large",
            price="850.00", display_order=2,
        )

        self.toppings = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.pizza, name="Extra Toppings",
            kind="modifier", required=False, min_select=0, max_select=5, display_order=1,
        )
        self.cheese = MenuOption.objects.create(
            merchant=self.merchant, group=self.toppings, name="Extra Cheese",
            price_delta="80.00", display_order=0,
        )
        self.olives = MenuOption.objects.create(
            merchant=self.merchant, group=self.toppings, name="Olives",
            price_delta="40.00", display_order=1,
        )
        self.pepperoni = MenuOption.objects.create(
            merchant=self.merchant, group=self.toppings, name="Pepperoni",
            price_delta="120.00", display_order=2,
        )

        # A second product on the same merchant, to prove options are bound to
        # their own product and not merely to the merchant.
        self.burger = MenuItem.objects.create(
            merchant=self.merchant, name="Burger", price="300.00", is_available=True,
        )
        self.burger_size = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="Burger Size",
            kind="variant", required=True, min_select=1, max_select=1,
        )
        self.burger_large = MenuOption.objects.create(
            merchant=self.merchant, group=self.burger_size, name="Large",
            price="380.00",
        )

        # A completely separate merchant's option, for tenant isolation.
        self.foreign_item = MenuItem.objects.create(
            merchant=self.other_merchant, name="Foreign Pizza", price="999.00",
            is_available=True,
        )
        self.foreign_group = MenuOptionGroup.objects.create(
            merchant=self.other_merchant, menu_item=self.foreign_item, name="Foreign Size",
            kind="variant", required=True, min_select=1, max_select=1,
        )
        self.foreign_option = MenuOption.objects.create(
            merchant=self.other_merchant, group=self.foreign_group, name="Jumbo",
            price="5000.00",
        )

    @staticmethod
    def pair(group, option):
        return (group.id, option.id)


class ProductWithoutGroupsTests(OptionGroupTestBase):
    """Migration safety: plain products must keep ordering with no selections."""

    def test_plain_product_orders_at_base_price(self):
        plain = MenuItem.objects.create(
            merchant=self.merchant, name="Black Coffee", price="150.00",
            is_available=True,
        )
        line = validate_and_price_line(plain, 2, [])
        self.assertEqual(line.unit_price, Decimal("150.00"))
        self.assertEqual(line.subtotal, Decimal("300.00"))
        self.assertEqual(line.options, [])

    def test_plain_product_needs_no_variants(self):
        plain = MenuItem.objects.create(
            merchant=self.merchant, name="Black Coffee 2", price="150.00",
            is_available=True,
        )
        self.assertEqual(plain.option_groups.count(), 0)
        line = validate_and_price_line(plain, 1, None)
        self.assertEqual(line.unit_price, Decimal("150.00"))


class VariantSelectionTests(OptionGroupTestBase):
    def test_required_variant_must_be_chosen(self):
        with self.assertRaises(LineValidationError) as ctx:
            validate_and_price_line(self.pizza, 1, [])
        self.assertIn("Size", str(ctx.exception))

    def test_optional_modifier_group_may_be_empty(self):
        line = validate_and_price_line(
            self.pizza, 1, [self.pair(self.size, self.small)]
        )
        self.assertEqual(line.unit_price, Decimal("450.00"))

    def test_variant_carries_its_own_final_price(self):
        for option, expected in ((self.small, "450.00"),
                                 (self.medium, "650.00"),
                                 (self.large, "850.00")):
            line = validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, option)]
            )
            self.assertEqual(line.unit_price, Decimal(expected))

    def test_default_variant_is_marked_for_preselection(self):
        defaults = [
            o for o in self.size.options.all() if o.is_default
        ]
        self.assertEqual([o.id for o in defaults], [self.small.id])

    def test_disabled_variant_cannot_be_selected(self):
        self.large.is_available = False
        self.large.save()
        with self.assertRaises(LineValidationError) as ctx:
            validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, self.large)]
            )
        self.assertIn("sold out", str(ctx.exception).lower())

    def test_disabled_group_cannot_be_selected(self):
        self.size.is_active = False
        self.size.save()
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, self.small)]
            )

    def test_option_from_another_product_is_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1,
                [self.pair(self.size, self.small), self.pair(self.toppings, self.burger_large)],
            )

    def test_cross_merchant_option_is_rejected(self):
        """Merchant A can never charge against merchant B's option ids."""
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, self.foreign_option)]
            )

    def test_option_cannot_be_smuggled_under_another_group_id(self):
        """Cheese is real, but it is not a valid *Size* choice."""
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, self.cheese)]
            )

    def test_bogus_option_id_is_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(self.pizza, 1, [(self.size.id, 999999)])

    def test_duplicate_selection_is_rejected(self):
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1,
                [self.pair(self.size, self.small), self.pair(self.size, self.small)],
            )


class ModifierSelectionTests(OptionGroupTestBase):
    def test_multi_select_adds_every_delta(self):
        line = validate_and_price_line(
            self.pizza, 1,
            [
                self.pair(self.size, self.medium),
                self.pair(self.toppings, self.cheese),
                self.pair(self.toppings, self.olives),
            ],
        )
        # 650 + 80 + 40
        self.assertEqual(line.unit_price, Decimal("770.00"))

    def test_zero_price_option_is_allowed(self):
        milk = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="Milk",
            kind="modifier", required=True, min_select=1, max_select=1,
        )
        regular = MenuOption.objects.create(
            merchant=self.merchant, group=milk, name="Regular Milk",
            price_delta="0.00",
        )
        line = validate_and_price_line(
            self.burger, 1,
            [self.pair(self.burger_size, self.burger_large), self.pair(milk, regular)],
        )
        self.assertEqual(line.unit_price, Decimal("380.00"))

    def test_max_select_is_enforced(self):
        # max_select is 5, so all three existing options are still allowed.
        line = validate_and_price_line(
            self.pizza, 1,
            [
                self.pair(self.size, self.small),
                self.pair(self.toppings, self.cheese),
                self.pair(self.toppings, self.olives),
                self.pair(self.toppings, self.pepperoni),
            ],
        )
        self.assertEqual(line.unit_price, Decimal("450.00") + 80 + 40 + 120)

    def test_exceeding_max_select_is_rejected(self):
        self.toppings.max_select = 1
        self.toppings.save()
        with self.assertRaises(LineValidationError) as ctx:
            validate_and_price_line(
                self.pizza, 1,
                [
                    self.pair(self.size, self.small),
                    self.pair(self.toppings, self.cheese),
                    self.pair(self.toppings, self.olives),
                ],
            )
        self.assertIn("only one", str(ctx.exception).lower())

    def test_min_select_is_enforced_even_when_group_not_flagged_required(self):
        """
        A group with min_select=1 is mandatory regardless of the `required`
        flag — the floor is the real rule, `required` is just the UI hint.
        """
        self.toppings.min_select = 2
        self.toppings.required = False
        self.toppings.save()

        with self.assertRaises(LineValidationError) as ctx:
            validate_and_price_line(
                self.pizza, 1, [self.pair(self.size, self.small)]
            )
        self.assertIn("at least 2", str(ctx.exception))

        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1,
                [
                    self.pair(self.size, self.small),
                    self.pair(self.toppings, self.cheese),
                ],
            )

        ok = validate_and_price_line(
            self.pizza, 1,
            [
                self.pair(self.size, self.small),
                self.pair(self.toppings, self.cheese),
                self.pair(self.toppings, self.olives),
            ],
        )
        self.assertEqual(ok.unit_price, Decimal("570.00"))

    def test_single_select_group_rejects_two_choices(self):
        milk = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="Milk",
            kind="modifier", required=True, min_select=1, max_select=1,
        )
        oat = MenuOption.objects.create(
            merchant=self.merchant, group=milk, name="Oat Milk", price_delta="50.00",
        )
        almond = MenuOption.objects.create(
            merchant=self.merchant, group=milk, name="Almond Milk", price_delta="60.00",
        )
        with self.assertRaises(LineValidationError) as ctx:
            validate_and_price_line(
                self.burger, 1,
                [
                    self.pair(self.burger_size, self.burger_large),
                    self.pair(milk, oat),
                    self.pair(milk, almond),
                ],
            )
        self.assertIn("one", str(ctx.exception).lower())

    def test_inactive_option_cannot_be_selected(self):
        self.olives.is_available = False
        self.olives.save()
        with self.assertRaises(LineValidationError):
            validate_and_price_line(
                self.pizza, 1,
                [
                    self.pair(self.size, self.small),
                    self.pair(self.toppings, self.olives),
                ],
            )


class AuthoritativePricingTests(OptionGroupTestBase):
    def test_spec_example_medium_plus_two_toppings_times_two(self):
        """
        Medium 650 + Extra Cheese 80 + Olives 40 = 770 unit, x2 = 1,540.
        The client never sends a price, so this is the whole contract.
        """
        line = validate_and_price_line(
            self.pizza, 2,
            [
                self.pair(self.size, self.medium),
                self.pair(self.toppings, self.cheese),
                self.pair(self.toppings, self.olives),
            ],
        )
        self.assertEqual(line.unit_price, Decimal("770.00"))
        self.assertEqual(line.subtotal, Decimal("1540.00"))

    def test_prices_are_decimal_not_float(self):
        line = validate_and_price_line(
            self.pizza, 3, [self.pair(self.size, self.large)]
        )
        self.assertIsInstance(line.unit_price, Decimal)
        self.assertIsInstance(line.subtotal, Decimal)
        self.assertEqual(line.subtotal, Decimal("2550.00"))

    def test_variant_price_changes_do_not_affect_existing_snapshot(self):
        line = validate_and_price_line(
            self.pizza, 1,
            [
                self.pair(self.size, self.medium),
                self.pair(self.toppings, self.cheese),
            ],
        )
        order = Order.objects.create(
            merchant=self.merchant, total_amount=line.subtotal,
            subtotal=line.subtotal, status=Order.STATUS_PENDING,
        )
        item = OrderItem.objects.create(
            order=order, menu_item=self.pizza, quantity=1,
            price=line.unit_price, subtotal=line.subtotal,
            special_instructions="No onion",
        )
        for opt in line.options:
            OrderItemOption.objects.create(
                order_item=item, group_name=opt.group_name,
                option_name=opt.option_name, kind=opt.kind,
                price_effect=opt.price_effect,
            )

        # Merchant renames and reprices the live menu.
        self.medium.name = "Jumbo"
        self.medium.price = Decimal("9999.00")
        self.medium.save()
        self.cheese.price_delta = Decimal("500.00")
        self.cheese.save()
        MenuOptionGroup.objects.filter(pk=self.size.pk).delete()

        item.refresh_from_db()
        names = sorted(item.options.values_list("option_name", flat=True))
        self.assertEqual(names, ["Extra Cheese", "Medium"])
        self.assertEqual(item.special_instructions, "No onion")
        self.assertEqual(item.price, Decimal("730.00"))


class OptionGroupConstraintTests(OptionGroupTestBase):
    def test_required_group_floors_min_select_at_one(self):
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="Required",
            kind="modifier", required=True,
        )
        self.assertEqual(group.min_select, 1)

    def test_min_select_is_clamped_to_max_select(self):
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="Clamped",
            kind="modifier", required=False, min_select=9, max_select=2,
        )
        self.assertEqual(group.min_select, 2)
        self.assertEqual(group.max_select, 2)

    def test_variant_group_is_forced_to_single_select(self):
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.burger, name="MultiVariant",
            kind="variant", min_select=0, max_select=4,
        )
        self.assertEqual(group.max_select, 1)
        self.assertEqual(group.min_select, 0)

    def test_database_rejects_required_group_with_zero_min(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                MenuOptionGroup.objects.bulk_create([MenuOptionGroup(
                    merchant=self.merchant, menu_item=self.burger,
                    name="RawBad", kind="modifier", required=True,
                    min_select=0, max_select=1,
                )])

    def test_database_rejects_negative_modifier_delta(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                MenuOption.objects.bulk_create([MenuOption(
                    merchant=self.merchant, group=self.toppings,
                    name="RawDiscount", price_delta=Decimal("-10.00"),
                )])

    def test_database_rejects_negative_variant_price(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                MenuOption.objects.bulk_create([MenuOption(
                    merchant=self.merchant, group=self.size,
                    name="RawNegative", price=Decimal("-5.00"),
                )])


class OrderApiPricingTests(OptionGroupTestBase):
    """The customer order endpoint must recompute, never trust the client."""

    def setUp(self):
        super().setUp()
        self.client = APIClient()
        from accounts.models import CustomerProfile
        user = get_user_model().objects.create_user(
            username="cust1", email="c1@t.com", password="Pass123!", role="customer",
        )
        self.customer = CustomerProfile.objects.create(user=user, full_name="Cust One")

    def _create(self, payload):
        return self.client.post(
            "/api/orders/create/", payload, format="json"
        )

    def _base_payload(self, **overrides):
        payload = {
            "merchant_id": self.merchant.id,
            "fulfillment_type": "pickup",
            "items": [{
                "menu_item_id": self.pizza.id,
                "quantity": 2,
                "selections": [
                    {"group_id": self.size.id, "option_id": self.medium.id},
                    {"group_id": self.toppings.id, "option_id": self.cheese.id},
                    {"group_id": self.toppings.id, "option_id": self.olives.id},
                ],
            }],
        }
        payload.update(overrides)
        return payload

    def test_client_sent_price_is_ignored(self):
        self.client.force_authenticate(self.customer.user)
        payload = self._base_payload()
        # Deliberately hostile: the client claims the line is worth 1.00.
        payload["items"][0].update({
            "unit_price": "1.00",
            "price": "1.00",
            "subtotal": "1.00",
            "line_total": "1.00",
            "total": "2.00",
        })

        res = self._create(payload)
        self.assertEqual(res.status_code, 201, res.data)
        stored = OrderItem.objects.get(id=res.data["items"][0]["id"])
        self.assertEqual(stored.price, Decimal("770.00"))
        self.assertEqual(stored.subtotal, Decimal("1540.00"))

    def test_snapshots_are_returned_to_the_client(self):
        self.client.force_authenticate(self.customer.user)
        res = self._create(self._base_payload())
        self.assertEqual(res.status_code, 201, res.data)
        item = res.data["items"][0]
        self.assertEqual(item["variant_name"], "Medium")
        self.assertEqual(
            sorted(o["option_name"] for o in item["options"]),
            ["Extra Cheese", "Medium", "Olives"],
        )
        names = sorted(m["option_name"] for m in item["modifier_summary"])
        self.assertEqual(names, ["Extra Cheese", "Olives"])

    def test_api_rejects_cross_merchant_option(self):
        self.client.force_authenticate(self.customer.user)
        payload = self._base_payload()
        payload["items"][0]["selections"] = [
            {"group_id": self.size.id, "option_id": self.foreign_option.id},
        ]
        res = self._create(payload)
        self.assertEqual(res.status_code, 400, res.data)

    def test_historical_orders_without_options_still_serialize(self):
        """Orders predating the snapshot fields must render safely."""
        order = Order.objects.create(
            merchant=self.merchant, total_amount=150, subtotal=150,
            status=Order.STATUS_COMPLETED,
        )
        legacy = OrderItem.objects.create(
            order=order, menu_item=self.pizza, quantity=1,
            price=150, subtotal=150,
        )
        from orders.serializers import OrderItemSerializer
        data = OrderItemSerializer(legacy).data
        self.assertEqual(data["options"], [])
        self.assertIsNone(data["variant_name"])
        self.assertEqual(data["modifier_summary"], [])
        self.assertEqual(data["special_instructions"], "")
