"""
Regression guards for table-QR / guest ordering with variants and modifiers.

This is the customer path a guest takes after scanning a table code. It is
exercised end to end (public menu payload -> guest order -> KDS) because the
frontend and backend were previously able to agree on "no options here" while a
merchant had already published variant groups: the guest could neither choose an
option nor see the resulting price.

These tests pin the contract the table-QR screen depends on:

  1. The public catalog is the only payload that carries option groups.
  2. A guest order priced on the server, not on a client-sent price.
  3. Selections are snapshotted onto the order item and survive later edits to
     the menu (an old order must keep the price and names the guest was quoted).
  4. Instructions and selections reach the KDS, not just the order table.
  5. Two different configurations of the same item stay two separate lines.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import (
    MerchantProfile,
    MerchantTable,
    MenuItem,
    MenuOption,
    MenuOptionGroup,
)
from orders.models import Order, OrderItem, OrderItemOption


def _option_group(merchant, item, name, kind, **kwargs):
    return MenuOptionGroup.objects.create(
        merchant=merchant, menu_item=item, name=name, kind=kind, **kwargs
    )


class TableQROrderingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user_model = get_user_model()
        self.merchant_user = user_model.objects.create_user(
            username="trader", email="t@example.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Cafe", slug="cafe",
            is_approved=True, is_open=True, table_ordering_enabled=True,
            # Keep the money assertions readable; tax interaction is covered
            # separately in `test_tax_stacks_on_top_of_variant_pricing`.
            tax_rate_percent=0,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="Table 1", table_number=1,
            public_token="tok-abc", is_active=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=250,
            is_available=True, status=MenuItem.STATUS_ACTIVE,
        )

        # Small / Large carry their own absolute price; Milk is a paid add-on.
        self.size = _option_group(
            self.merchant, self.item, "Size", MenuOptionGroup.KIND_VARIANT,
            required=True, min_select=1, max_select=1,
        )
        self.small = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Small", price=200, is_default=True,
        )
        self.large = MenuOption.objects.create(
            group=self.size, merchant=self.merchant, name="Large", price=300,
        )

        self.extras = _option_group(
            self.merchant, self.item, "Extras", MenuOptionGroup.KIND_MODIFIER,
            required=False, min_select=0, max_select=2,
        )
        self.oat = MenuOption.objects.create(
            group=self.extras, merchant=self.merchant, name="Oat milk", price_delta=50,
        )
        self.vanilla = MenuOption.objects.create(
            group=self.extras, merchant=self.merchant, name="Vanilla", price_delta=30,
        )

    def _selections(self, *pairs):
        return [
            {"group_id": g.id, "option_id": o.id} for g, o in pairs
        ]

    def _guest_order(self, items, name="Guest"):
        res = self.client.post(
            "/api/orders/guest-create/",
            data={
                "merchant_id": self.merchant.id,
                "table_token": self.table.public_token,
                "guest_session_id": "sess-1",
                "guest_name": name,
                "items": items,
            },
            content_type="application/json",
        )
        return res

    # â”€â”€ 1. Public catalog carries the groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_public_catalog_includes_option_groups(self):
        res = self.client.get(f"/api/merchants/{self.merchant.id}/menu/catalog/")
        self.assertEqual(res.status_code, 200, res.data)
        item = next(i for i in res.data["items"] if i["id"] == self.item.id)

        groups = {g["name"]: g for g in item["groups"]}
        self.assertEqual(set(groups), {"Size", "Extras"})

        size = groups["Size"]
        self.assertEqual(size["kind"], "variant")
        self.assertTrue(size["required"])
        self.assertEqual(size["max_select"], 1)
        # The guest screen needs absolute variant prices to show a real total.
        self.assertEqual(
            {o["name"]: o["price"] for o in size["options"]},
            {"Small": "200.00", "Large": "300.00"},
        )

        extras = groups["Extras"]
        self.assertEqual(extras["kind"], "modifier")
        self.assertEqual(extras["min_select"], 0)
        self.assertEqual(
            {o["name"]: o["price_delta"] for o in extras["options"]},
            {"Oat milk": "50.00", "Vanilla": "30.00"},
        )

    # â”€â”€ 2. Server-authoritative pricing for guest orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_guest_order_price_ignores_client_sent_price(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id,
            "quantity": 2,
            # A tampered client price must not survive.
            "price": "1.00",
            "name": "Free Latte",
            "points_per_item": 0,
            "selections": self._selections((self.size, self.large)),
            "special_instructions": "Extra hot",
        }])
        self.assertEqual(res.status_code, 201, res.data)

        line = OrderItem.objects.get(order_id=res.data["id"])
        self.assertEqual(line.name, "Latte")
        # Large replaces the base price: 300 * 2
        self.assertEqual(line.price, Decimal("300.00"))
        self.assertEqual(line.subtotal, Decimal("600.00"))
        self.assertEqual(res.data["total_amount"], "600.00")

    def test_guest_order_adds_modifier_deltas_on_top_of_variant(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id,
            "quantity": 1,
            "name": "",
            "price": "1.00",
            "points_per_item": 0,
            "selections": self._selections(
                (self.size, self.small), (self.extras, self.oat), (self.extras, self.vanilla),
            ),
        }])
        self.assertEqual(res.status_code, 201, res.data)
        # Small 200 + oat 50 + vanilla 30
        self.assertEqual(res.data["total_amount"], "280.00")

    def test_guest_order_rejects_unavailable_modifier(self):
        self.oat.is_available = False
        self.oat.save()
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.size, self.small), (self.extras, self.oat)),
        }])
        self.assertEqual(res.status_code, 400, res.data)
        # The message must name the group so the guest knows what to revisit.
        self.assertIn("Extras", str(res.data))

    def test_guest_order_rejects_missing_required_variant(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.extras, self.oat)),
        }])
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("Size", str(res.data))

    def test_guest_order_rejects_group_over_selection_limit(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.size, self.small), (self.extras, self.oat)),
        }])
        # Extras allows up to 2, so this is valid; a 3rd distinct add-on is not.
        self.assertEqual(res.status_code, 201, res.data)

        third = MenuOption.objects.create(
            group=self.extras, merchant=self.merchant, name="Extra shot", price_delta=70,
        )
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections(
                (self.size, self.small),
                (self.extras, self.oat), (self.extras, self.vanilla), (self.extras, third),
            ),
        }])
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("Extras", str(res.data))

    def test_guest_order_rejects_option_from_another_item(self):
        other_item = MenuItem.objects.create(
            merchant=self.merchant, name="Mochi", price=180, is_available=True,
        )
        other_group = _option_group(
            self.merchant, other_item, "Flavour", MenuOptionGroup.KIND_VARIANT,
            required=True, min_select=1, max_select=1,
        )
        other_opt = MenuOption.objects.create(
            group=other_group, merchant=self.merchant, name="Strawberry", price=200,
        )

        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections(
                (self.size, self.small), (other_group, other_opt),
            ),
        }])
        self.assertEqual(res.status_code, 400, res.data)

    # â”€â”€ 3. Snapshot immutability â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_selection_snapshot_survives_menu_edits(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.size, self.large)),
            "special_instructions": "No foam",
        }])
        self.assertEqual(res.status_code, 201, res.data)

        # Merchant re-prices and renames the option after the order was placed.
        self.large.name = "Large (XL)"
        self.large.price = Decimal("500.00")
        self.large.save()
        self.item.price = Decimal("999.00")
        self.item.save()

        line = OrderItem.objects.get(order_id=res.data["id"])
        self.assertEqual(line.price, Decimal("300.00"))
        self.assertEqual(line.special_instructions, "No foam")
        opt = OrderItemOption.objects.get(order_item=line)
        self.assertEqual(opt.option_name, "Large")
        self.assertEqual(opt.price_effect, Decimal("300.00"))

    def test_order_detail_returns_options_and_instructions(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections(
                (self.size, self.large), (self.extras, self.oat),
            ),
            "special_instructions": "Less ice",
        }])
        self.assertEqual(res.status_code, 201, res.data)

        # Guest orders belong to no customer, so the detail view is exercised
        # from the merchant side â€” the same serializer the KDS/orders screens use.
        self.client.force_authenticate(self.merchant_user)
        detail = self.client.get(f"/api/orders/{res.data['id']}/")
        self.assertEqual(detail.status_code, 200, detail.data)
        line = detail.data["items"][0]
        self.assertEqual(line["special_instructions"], "Less ice")
        self.assertEqual(line["variant_name"], "Large")
        # modifier_summary is a flat list of modifiers only (variants are
        # already reported once via variant_name).
        self.assertEqual(
            [(m["group_name"], m["option_name"]) for m in line["modifier_summary"]],
            [("Extras", "Oat milk")],
        )

        chosen = {o["option_name"] for o in line["options"]}
        self.assertEqual(chosen, {"Large", "Oat milk"})

    def test_tax_stacks_on_top_of_variant_pricing(self):
        self.merchant.tax_rate_percent = 10
        self.merchant.save()
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            # Large 300 + oat 50 = 350, +10% tax = 385
            "selections": self._selections(
                (self.size, self.large), (self.extras, self.oat),
            ),
        }])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["subtotal"], "350.00")
        self.assertEqual(res.data["tax_amount"], "35.00")
        self.assertEqual(res.data["total_amount"], "385.00")

    # â”€â”€ 4. KDS visibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_kds_exposes_selections_and_instructions(self):
        # KDS reads from a preparation area, so the merchant needs routing on
        # and a manager worker (managers may read any area).
        from orders.models import PreparationArea
        from pos.models import ShiftWorker

        self.merchant.preparation_routing_enabled = True
        self.merchant.save()
        area = PreparationArea.objects.create(
            merchant=self.merchant, name="Drinks", is_default=True, is_active=True,
        )
        self.item.preparation_area = area
        self.item.requires_preparation = True
        self.item.save()
        worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Manager",
            role=ShiftWorker.ROLE_MANAGER, pin_hash="x",
        )

        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections(
                (self.size, self.large), (self.extras, self.vanilla),
            ),
            "special_instructions": "Allergy: no nuts",
        }])
        self.assertEqual(res.status_code, 201, res.data)

        self.client.force_authenticate(self.merchant_user)
        kds = self.client.get(
            f"/api/orders/preparation-areas/{area.id}/orders/"
            f"?status=active&worker_id={worker.id}"
        )
        self.assertEqual(kds.status_code, 200, kds.data)

        order = next(o for o in kds.data["orders"] if o["id"] == res.data["id"])
        item = order["items"][0]
        self.assertEqual(item["variant_name"], "Large")
        self.assertEqual([m["option_name"] for m in item["modifiers"]], ["Vanilla"])
        self.assertEqual(item["special_instructions"], "Allergy: no nuts")
        # Backwards-compatible field must carry the real instruction, not "".
        self.assertIn("Allergy: no nuts", item["notes"])

    # â”€â”€ 5. Distinct configurations stay distinct lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_two_configurations_stay_separate_lines(self):
        res = self._guest_order([
            {
                "menu_item_id": self.item.id, "quantity": 1, "name": "",
                "price": "0", "points_per_item": 0,
                "selections": self._selections((self.size, self.small)),
            },
            {
                "menu_item_id": self.item.id, "quantity": 1, "name": "",
                "price": "0", "points_per_item": 0,
                "selections": self._selections((self.size, self.large)),
            },
        ])
        self.assertEqual(res.status_code, 201, res.data)

        lines = OrderItem.objects.filter(order_id=res.data["id"]).order_by("id")
        self.assertEqual(lines.count(), 2)
        self.assertEqual(
            sorted(l.price for l in lines),
            [Decimal("200.00"), Decimal("300.00")],
        )
        self.assertEqual(res.data["total_amount"], "500.00")

    def test_same_configuration_sent_twice_keeps_both_lines(self):
        # The customer cart merges identical lines by (item, selections,
        # instructions) before sending, so this shape only arrives from a client
        # that deliberately submitted it. The server records what it was given
        # rather than silently rewriting it — see _bulk_create_items_with_options.
        res = self._guest_order([
            {
                "menu_item_id": self.item.id, "quantity": 1, "name": "",
                "price": "0", "points_per_item": 0,
                "selections": self._selections((self.size, self.large)),
            },
            {
                "menu_item_id": self.item.id, "quantity": 2, "name": "",
                "price": "0", "points_per_item": 0,
                "selections": self._selections((self.size, self.large)),
            },
        ])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(OrderItem.objects.filter(order_id=res.data["id"]).count(), 2)
        self.assertEqual(res.data["total_amount"], "900.00")

    def test_add_items_to_order_appends_a_new_configuration(self):
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.size, self.small)),
        }])
        self.assertEqual(res.status_code, 201, res.data)
        order_id = res.data["id"]

        # The add-to-order screen posts here; the merchant owner is authorised.
        self.client.force_authenticate(self.merchant_user)
        add = self.client.post(
            f"/api/orders/{order_id}/add-items/",
            data={
                "merchant_id": self.merchant.id,
                "items": [{
                    "menu_item_id": self.item.id, "quantity": 1, "name": "",
                    "price": "0", "points_per_item": 0,
                    "selections": self._selections(
                        (self.size, self.large), (self.extras, self.oat),
                    ),
                    "special_instructions": "Extra dry",
                }],
            },
            content_type="application/json",
        )
        self.assertEqual(add.status_code, 200, add.data)

        order = Order.objects.get(id=order_id)
        self.assertEqual(order.items.count(), 2)
        added = order.items.filter(options__option_name="Large").first()
        # Large 300 + oat 50
        self.assertEqual(added.price, Decimal("350.00"))
        self.assertEqual(added.special_instructions, "Extra dry")
        # The originally placed configuration is untouched.
        kept = order.items.filter(options__option_name="Small").first()
        self.assertEqual(kept.price, Decimal("200.00"))

    def _add_payload(self):
        return {
            "merchant_id": self.merchant.id,
            "items": [{
                "menu_item_id": self.item.id, "quantity": 1, "name": "",
                "price": "0", "points_per_item": 0,
                "selections": self._selections((self.size, self.large)),
            }],
        }

    def test_add_items_allowed_on_unpaid_confirmed_dine_in_order(self):
        """
        Dine-in tickets are meant to be built up across courses: the order sits
        in `confirmed` precisely so staff can keep adding before paying.
        """
        res = self._guest_order([{
            "menu_item_id": self.item.id, "quantity": 1, "name": "",
            "price": "0", "points_per_item": 0,
            "selections": self._selections((self.size, self.small)),
        }])
        self.assertEqual(res.status_code, 201, res.data)
        order = Order.objects.get(id=res.data["id"])
        order.status = Order.STATUS_CONFIRMED
        order.save(update_fields=["status"])

        self.client.force_authenticate(self.merchant_user)
        add = self.client.post(
            f"/api/orders/{order.id}/add-items/",
            data=self._add_payload(), content_type="application/json",
        )
        self.assertEqual(add.status_code, 200, add.data)
        self.assertEqual(Order.objects.get(id=order.id).items.count(), 2)

    def test_add_items_refused_once_order_is_paid(self):
        """
        The status gate alone let a *paid* confirmed/preparing order be appended
        to, which under-charges silently: the collected total is already fixed
        and the recorded tender no longer matches the bill.
        """
        for payment_status in ("paid", "partially_paid", "refunded"):
            with self.subTest(payment_status=payment_status):
                res = self._guest_order([{
                    "menu_item_id": self.item.id, "quantity": 1, "name": "",
                    "price": "0", "points_per_item": 0,
                    "selections": self._selections((self.size, self.small)),
                }])
                self.assertEqual(res.status_code, 201, res.data)
                order = Order.objects.get(id=res.data["id"])
                order.status = Order.STATUS_CONFIRMED
                order.payment_status = payment_status
                order.save(update_fields=["status", "payment_status"])

                self.client.force_authenticate(self.merchant_user)
                add = self.client.post(
                    f"/api/orders/{order.id}/add-items/",
                    data=self._add_payload(), content_type="application/json",
                )
                self.assertEqual(add.status_code, 400, add.data)
                self.assertIn("already been paid", str(add.data["error"]).lower())
                # And nothing was written.
                self.assertEqual(Order.objects.get(id=order.id).items.count(), 1)


