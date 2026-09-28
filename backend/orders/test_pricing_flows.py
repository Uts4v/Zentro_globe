"""
Pricing through the real endpoints: every order flow must produce the same
numbers for the same basket, discounts are re-validated when an order changes,
settled orders are frozen, and one merchant can never price with another's data.

Run with: python manage.py test orders.test_pricing_flows
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from merchants.models import MenuItem, MenuOption, MenuOptionGroup, MerchantProfile, MerchantTable
from orders.models import Order, OrderAdjustment, OrderItem
from orders.pricing import (
    ADJ_LOYALTY_REWARD,
    AdjustmentSpec,
    PricingError,
    attach_adjustment,
    reprice_order,
)
from pos.models import PosDiscount, ShiftWorker

User = get_user_model()
D = Decimal


class PricingFlowBase(TestCase):
    policy = "exclusive"

    def setUp(self):
        self.merchant_user = User.objects.create_user(
            username="pf-m", email="pf-m@test.com", password="Pass123!", role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Pricing Cafe", slug="pricing-cafe",
            is_approved=True, is_open=True, onboarding_complete=True,
            pos_enabled=True, discounts_enabled=True, table_ordering_enabled=True,
            allow_pickup=True, allow_dine_in=True,
            tax_enabled=True, tax_components=[{"name": "VAT", "rate": 13}],
            tax_policy=self.policy, currency_code="NPR", currency_symbol="Rs",
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant, name="Table 1", table_number=1, public_token="pf-tok", is_active=True,
        )
        # Coffee 500 → Large variant 600 → + cheese 50 = 650 effective.
        self.coffee = MenuItem.objects.create(
            merchant=self.merchant, name="Coffee", price=500, is_available=True,
            status=MenuItem.STATUS_ACTIVE,
        )
        self.size = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.coffee, name="Size",
            kind=MenuOptionGroup.KIND_VARIANT, required=True, min_select=1, max_select=1,
        )
        self.large = MenuOption.objects.create(group=self.size, merchant=self.merchant, name="Large", price=600)
        self.extras = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.coffee, name="Extras",
            kind=MenuOptionGroup.KIND_MODIFIER, required=False, min_select=0, max_select=2,
        )
        self.cheese = MenuOption.objects.create(group=self.extras, merchant=self.merchant, name="Cheese", price_delta=50)
        # Pizza 1000 on a 20% item discount (Today's Special style) → sells at 800.
        self.pizza = MenuItem.objects.create(
            merchant=self.merchant, name="Pizza", price=1000, is_available=True,
            status=MenuItem.STATUS_ACTIVE, discount_type="percentage", discount_value=20,
        )
        self.water = MenuItem.objects.create(
            merchant=self.merchant, name="Water", price=100, is_available=True,
            status=MenuItem.STATUS_ACTIVE, tax_class="exempt",
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Mgr", pin_hash="x", role="manager",
            is_active=True, can_apply_discount=True, can_process_refund=True,
        )
        self.customer_user = User.objects.create_user(
            username="pf-c", email="pf-c@test.com", password="Pass123!", role="customer",
        )
        self.customer = CustomerProfile.objects.create(user=self.customer_user, full_name="Pat")

    def basket(self):
        return [
            {"menu_item_id": self.coffee.id, "quantity": 2, "selections": [
                {"group_id": self.size.id, "option_id": self.large.id},
                {"group_id": self.extras.id, "option_id": self.cheese.id},
            ]},
            {"menu_item_id": self.pizza.id, "quantity": 1},
            {"menu_item_id": self.water.id, "quantity": 3},
        ]

    def as_merchant(self):
        client = APIClient()
        client.force_authenticate(self.merchant_user)
        return client

    def as_customer(self):
        client = APIClient()
        client.force_authenticate(self.customer_user)
        return client

    def pos_order(self, items=None, **extra):
        resp = self.as_merchant().post(
            "/api/pos/order/create/", {"items": items or self.basket(), "fulfillment_type": "pickup", **extra},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return Order.objects.get(pk=resp.data["id"])

    def apply_pos_discount(self, order, discount_type, value):
        return self.as_merchant().post("/api/pos/discount/apply/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id),
            "discount_type": discount_type, "discount_value": str(value),
        }, format="json")


class SameBasketParityTests(PricingFlowBase):
    # 2 × 650 + 800 + 3 × 100 (exempt) = 2400; VAT 13% on 2100 = 273.
    EXPECTED = {"subtotal": D("2400.00"), "taxable_amount": D("2100.00"),
                "tax_amount": D("273.00"), "total_amount": D("2673.00")}

    def assert_expected(self, order, label):
        for field, value in self.EXPECTED.items():
            self.assertEqual(getattr(order, field), value, f"{label}: {field}")
        self.assertEqual(order.pricing_version, "v1", label)

    def test_every_flow_prices_the_basket_identically(self):
        customer = self.as_customer().post("/api/orders/create/", {
            "merchant_id": self.merchant.id, "items": self.basket(), "fulfillment_type": "pickup",
        }, format="json")
        self.assertEqual(customer.status_code, 201, customer.data)
        self.assert_expected(Order.objects.get(pk=customer.data["id"]), "customer app")

        guest = APIClient().post("/api/orders/guest-create/", {
            "merchant_id": self.merchant.id, "table_token": self.table.public_token,
            "guest_session_id": "s1", "guest_name": "G", "items": self.basket(),
        }, format="json")
        self.assertEqual(guest.status_code, 201, guest.data)
        self.assert_expected(Order.objects.get(pk=guest.data["id"]), "guest/table QR")

        self.assert_expected(self.pos_order(), "POS")

        table = APIClient().post(f"/api/pos/table/{self.table.public_token}/order/",
                                 {"items": self.basket()}, format="json")
        self.assertEqual(table.status_code, 201, table.data)
        self.assertEqual(D(table.data["total"]), self.EXPECTED["total_amount"])
        self.assert_expected(Order.objects.get(pk=table.data["order_id"]), "POS table QR")

        preview = self.as_customer().post("/api/orders/preview/", {
            "merchant_id": self.merchant.id, "items": self.basket(),
        }, format="json")
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(D(preview.data["total_amount"]), self.EXPECTED["total_amount"])
        self.assertEqual(D(preview.data["tax_amount"]), self.EXPECTED["tax_amount"])

    def test_line_snapshot_records_variants_modifiers_special_and_tax(self):
        order = self.pos_order()
        coffee, pizza, water = order.items.order_by("id")
        self.assertEqual(coffee.price, D("650.00"))
        self.assertEqual(coffee.subtotal, D("1300.00"))
        self.assertEqual(pizza.price, D("800.00"))
        self.assertEqual(pizza.list_unit_price, D("1000.00"))
        self.assertEqual(water.tax_class, "exempt")
        self.assertEqual(water.tax_amount, D("0.00"))
        self.assertEqual(sum(i.total_amount for i in (coffee, pizza, water)), order.total_amount)
        # Today's Special is a price, not a discount: the discount slot is empty.
        self.assertEqual(order.discount_amount, D("0.00"))
        self.assertFalse(order.adjustments.exists())
        self.assertEqual(order.tax_components_snapshot, [{"name": "VAT", "rate": "13"}])
        self.assertEqual(order.currency_code_snapshot, "NPR")

    def test_tampered_client_totals_are_ignored(self):
        order = self.pos_order(subtotal="1", tax_amount="0", total_amount="1")
        self.assertEqual(order.total_amount, self.EXPECTED["total_amount"])


class DiscountTests(PricingFlowBase):
    def test_percentage_discount_is_allocated_per_line_and_reduces_tax(self):
        order = self.pos_order()
        resp = self.apply_pos_discount(order, "percentage", 20)
        self.assertEqual(resp.status_code, 201, resp.data)
        order.refresh_from_db()
        # 20% of 2400 = 480; taxable = 2100 − 420 (the part on taxed lines) = 1680.
        self.assertEqual(order.discount_amount, D("480.00"))
        self.assertEqual(order.taxable_amount, D("1680.00"))
        self.assertEqual(order.tax_amount, D("218.40"))
        self.assertEqual(order.total_amount, D("2138.40"))
        self.assertEqual(sum(i.discount_amount for i in order.items.all()), D("480.00"))
        self.assertEqual(sum(i.total_amount for i in order.items.all()), order.total_amount)
        self.assertEqual(D(resp.data["discount_amount"]), D("480.00"))

    def test_cashier_can_replace_their_own_discount(self):
        order = self.pos_order()
        self.apply_pos_discount(order, "percentage", 10)
        resp = self.apply_pos_discount(order, "fixed", 100)
        self.assertEqual(resp.status_code, 201, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.discount_amount, D("100.00"))
        self.assertEqual(order.adjustments.filter(status="active").count(), 1)

    def test_one_discount_slot_blocks_a_second_kind(self):
        order = self.pos_order()
        attach_adjustment(order, AdjustmentSpec(
            kind=ADJ_LOYALTY_REWARD, calc_type="fixed", value=D("100"), label="Loyalty reward"))
        resp = self.apply_pos_discount(order, "percentage", 10)
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertEqual(resp.data["error"], "Remove the current reward before applying another offer.")
        self.assertEqual(resp.data["code"], "discount_slot_taken")

    def test_remove_discount_restores_the_full_price(self):
        order = self.pos_order()
        self.apply_pos_discount(order, "percentage", 20)
        resp = self.as_merchant().post("/api/pos/discount/remove/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.total_amount, D("2673.00"))
        self.assertEqual(order.discount_amount, D("0.00"))

    def test_fixed_discount_above_subtotal_is_rejected(self):
        order = self.pos_order()
        resp = self.apply_pos_discount(order, "fixed", 5000)
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PosDiscount.objects.exists())


class RevalidationTests(PricingFlowBase):
    def test_minimum_spend_rechecked_when_the_order_shrinks(self):
        order = self.pos_order(items=[
            {"menu_item_id": self.pizza.id, "quantity": 1},
            {"menu_item_id": self.water.id, "quantity": 4},
        ])  # 800 + 400 = 1200
        _, result = attach_adjustment(order, AdjustmentSpec(
            kind="promotion", calc_type="percentage", value=D("10"), label="10% over 1000",
            min_subtotal=D("1000")))
        self.assertEqual(result.discount_total, D("120.00"))

        water = order.items.get(menu_item=self.water)
        water.quantity = 0
        water.delete()
        OrderItem.objects.create(order=order, menu_item=self.water, name="Water", price=D("50.00"),
                                 list_unit_price=D("50.00"), quantity=1, subtotal=D("50.00"),
                                 tax_class="exempt")
        result = reprice_order(order)  # 800 + 50 = 850
        self.assertEqual(result.discount_total, D("0.00"))
        self.assertEqual(result.messages, [{
            "kind": "promotion", "label": "10% over 1000", "code": "MINIMUM_ORDER_NOT_MET",
            "required": "1000.00", "current": "850.00", "shortfall": "150.00",
        }])
        adj = order.adjustments.get(status="active")
        self.assertFalse(adj.eligible)

    def test_adding_items_grows_a_percentage_discount(self):
        order = self.pos_order(items=[{"menu_item_id": self.pizza.id, "quantity": 1}])
        order.status = Order.STATUS_CONFIRMED
        order.save(update_fields=["status"])
        self.apply_pos_discount(order, "percentage", 10)
        resp = self.as_merchant().post(f"/api/orders/{order.id}/add-items/", {
            "items": [{"menu_item_id": self.pizza.id, "quantity": 1}]}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.subtotal, D("1600.00"))
        self.assertEqual(order.discount_amount, D("160.00"))
        self.assertEqual(resp.data["pricing_messages"], [])


class SnapshotTests(PricingFlowBase):
    def test_settled_order_never_changes(self):
        order = self.pos_order()
        order.payment_status = "paid"
        order.save(update_fields=["payment_status"])
        self.assertIsNotNone(Order.objects.get(pk=order.pk).pricing_locked_at)
        before = self.as_merchant().get(f"/api/orders/{order.id}/pricing/").data

        self.pizza.price = 5000
        self.pizza.save()
        self.merchant.tax_components = [{"name": "VAT", "rate": 20}]
        self.merchant.tax_policy = "inclusive"
        self.merchant.save()

        after = self.as_merchant().get(f"/api/orders/{order.id}/pricing/").data
        self.assertEqual(before, after)
        self.assertEqual(after["grand_total"], "2673.00")
        order.refresh_from_db()
        with self.assertRaises(PricingError):
            reprice_order(order)
        resp = self.apply_pos_discount(order, "percentage", 10)
        self.assertEqual(resp.status_code, 400)

    def test_open_order_keeps_its_tax_snapshot_when_settings_change(self):
        order = self.pos_order(items=[{"menu_item_id": self.pizza.id, "quantity": 1}])
        self.merchant.tax_components = [{"name": "VAT", "rate": 20}]
        self.merchant.save()
        result = reprice_order(Order.objects.get(pk=order.pk))
        self.assertEqual(result.tax_total, D("104.00"))

    def test_reward_orders_carry_a_snapshot(self):
        order = Order.objects.create(merchant=self.merchant, total_amount=0,
                                     order_type=Order.ORDER_TYPE_REWARD_REDEMPTION)
        OrderItem.objects.create(order=order, name="Free coffee", price=0, quantity=1, subtotal=0)
        reprice_order(order)
        order.refresh_from_db()
        self.assertEqual(order.pricing_version, "v1")
        self.assertEqual(order.total_amount, D("0.00"))


class TenantIsolationTests(PricingFlowBase):
    def setUp(self):
        super().setUp()
        other_user = User.objects.create_user(username="pf-o", email="pf-o@test.com",
                                              password="Pass123!", role="merchant")
        self.other = MerchantProfile.objects.create(user=other_user, business_name="Rival",
                                                    slug="rival-pricing", is_open=True, pos_enabled=True)
        self.foreign_item = MenuItem.objects.create(merchant=self.other, name="Foreign", price=1,
                                                    is_available=True, status=MenuItem.STATUS_ACTIVE)
        self.foreign_group = MenuOptionGroup.objects.create(
            merchant=self.other, menu_item=self.foreign_item, name="Size",
            kind=MenuOptionGroup.KIND_VARIANT, required=False, max_select=1)
        self.foreign_option = MenuOption.objects.create(group=self.foreign_group, merchant=self.other,
                                                        name="Tiny", price=1)

    def test_pos_cannot_price_another_merchants_product(self):
        resp = self.as_merchant().post("/api/pos/order/create/", {
            "items": [{"menu_item_id": self.foreign_item.id, "quantity": 1}]}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Order.objects.exists())

    def test_customer_cannot_attach_another_merchants_option(self):
        resp = self.as_customer().post("/api/orders/create/", {
            "merchant_id": self.merchant.id,
            "items": [{"menu_item_id": self.coffee.id, "quantity": 1, "selections": [
                {"group_id": self.foreign_group.id, "option_id": self.foreign_option.id}]}],
        }, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_other_merchant_cannot_read_or_discount_the_order(self):
        order = self.pos_order()
        rival = APIClient()
        rival.force_authenticate(self.other.user)
        self.assertEqual(rival.get(f"/api/orders/{order.id}/pricing/").status_code, 404)
        resp = rival.post("/api/pos/discount/apply/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id),
            "discount_type": "percentage", "discount_value": "50"}, format="json")
        self.assertIn(resp.status_code, (403, 404))

    def test_table_order_with_a_bad_line_leaves_nothing_behind(self):
        resp = APIClient().post(f"/api/pos/table/{self.table.public_token}/order/", {"items": [
            {"menu_item_id": self.pizza.id, "quantity": 1},
            {"menu_item_id": self.foreign_item.id, "quantity": 1},
        ]}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(Order.objects.exists())


class RefundTests(PricingFlowBase):
    def test_line_refund_uses_the_amount_originally_charged(self):
        order = self.pos_order()
        self.apply_pos_discount(order, "percentage", 20)
        order.refresh_from_db()
        order.payment_status = "paid"
        order.status = Order.STATUS_COMPLETED
        order.save()
        coffee = order.items.get(menu_item=self.coffee)
        charged_per_coffee = coffee.total_amount / 2

        self.pizza.price = 9999
        self.pizza.save()
        resp = self.as_merchant().post("/api/pos/refund/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id),
            "items": [{"order_item_id": coffee.id, "quantity": 1}],
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(D(resp.data["refund_amount"]), charged_per_coffee.quantize(D("0.01")))
        coffee.refresh_from_db()
        self.assertEqual(coffee.refunded_quantity, 1)


class LegacyPolicyTests(PricingFlowBase):
    policy = "legacy"

    def test_legacy_keeps_taxing_the_pre_discount_subtotal(self):
        order = self.pos_order()
        self.assertEqual(order.tax_amount, D("273.00"))
        self.apply_pos_discount(order, "percentage", 20)
        order.refresh_from_db()
        # Same arithmetic Zentro used before pricing v1: subtotal − discount + tax(on subtotal).
        self.assertEqual(order.tax_amount, D("273.00"))
        self.assertEqual(order.total_amount, D("2400.00") - D("480.00") + D("273.00"))

    def test_pre_v1_discounted_order_keeps_its_discount_when_repriced(self):
        order = Order.objects.create(
            merchant=self.merchant, subtotal=D("800.00"), discount_type="percentage",
            discount_value=D("10"), discount_amount=D("80.00"), tax_amount=D("104.00"),
            total_amount=D("824.00"), status=Order.STATUS_CONFIRMED,
        )
        OrderItem.objects.create(order=order, menu_item=self.pizza, name="Pizza",
                                 price=D("800.00"), quantity=1, subtotal=D("800.00"))
        result = reprice_order(order)
        self.assertEqual(result.discount_total, D("80.00"))
        self.assertEqual(result.grand_total, D("824.00"))
        self.assertEqual(OrderAdjustment.objects.get(order=order).source_ref, "legacy")


class InclusivePolicyTests(PricingFlowBase):
    policy = "inclusive"

    def test_inclusive_prices_are_what_the_customer_pays(self):
        order = self.pos_order(items=[{"menu_item_id": self.pizza.id, "quantity": 1}])
        self.assertEqual(order.total_amount, D("800.00"))
        self.assertEqual(order.tax_amount, D("92.04"))  # 800 − 800/1.13
        self.assertTrue(order.prices_include_tax)


class ServiceChargeTests(PricingFlowBase):
    def setUp(self):
        super().setUp()
        self.merchant.service_charge_percent = D("10")
        self.merchant.save()

    def test_service_charge_applies_to_dine_in_and_is_taxed_under_exclusive(self):
        guest = APIClient().post("/api/orders/guest-create/", {
            "merchant_id": self.merchant.id, "table_token": self.table.public_token,
            "guest_session_id": "s", "guest_name": "G",
            "items": [{"menu_item_id": self.pizza.id, "quantity": 1}],
        }, format="json")
        order = Order.objects.get(pk=guest.data["id"])
        self.assertEqual(order.service_charge, D("80.00"))
        self.assertEqual(order.tax_amount, D("114.40"))  # 13% of (800 + 80)
        self.assertEqual(order.total_amount, D("994.40"))
        self.assertEqual(order.charges.get().kind, "service")

    def test_pickup_orders_have_no_service_charge_by_default(self):
        order = self.pos_order(items=[{"menu_item_id": self.pizza.id, "quantity": 1}])
        self.assertEqual(order.service_charge, D("0.00"))
        self.assertFalse(order.charges.exists())
