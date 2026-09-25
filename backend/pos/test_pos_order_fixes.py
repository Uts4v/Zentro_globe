"""
Regression tests for three POS fixes.

Run with: python manage.py test pos.test_pos_order_fixes

1. Dine-in orders consume stock of linked inventory items exactly once,
   and cancelling puts it back.
2. Customer search/create report the customer's loyalty points and order
   count at this merchant.
3. A paid order stays paid and cannot be charged a second time.
"""

import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from inventory.models import (
    InventoryBalance,
    InventoryCategory,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    MenuItemStockLink,
    MovementType,
)
from inventory.order_stock import deduct_stock_for_order
from inventory.services import (
    InventoryMovementService,
    get_system_unit,
    seed_merchant_reference_data,
)
from loyalty.services import award_wallet_points, join_merchant
from merchants.models import MenuItem, MerchantProfile
from orders.models import Order, OrderItem
from pos.models import CashShift, PosDevice, ShiftWorker


class PosFixtureMixin:
    def setUp(self):
        User = get_user_model()
        self.merchant_user = User.objects.create_user(
            username="fix-merchant", email="fix-merchant@test.com",
            password="Pass123!", role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Fix Cafe", slug="fix-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            table_ordering_enabled=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.merchant_user)

        self.coke = MenuItem.objects.create(
            merchant=self.merchant, name="Coke", price=100, is_available=True,
        )
        self.tea = MenuItem.objects.create(
            merchant=self.merchant, name="Tea", price=50, is_available=True,
        )
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till-1", device_token_hash="x",
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", pin_hash="hashed",
        )
        self.shift = CashShift.objects.create(
            merchant=self.merchant, device=self.device, opened_by=self.worker,
        )

    def create_pos_order(self, items, fulfillment="dine-in", mutation_id=None):
        return self.client.post("/api/pos/order/create/", {
            "items": [{"menu_item_id": mi.id, "quantity": q} for mi, q in items],
            "fulfillment_type": fulfillment,
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": mutation_id or str(uuid.uuid4()),
        }, format="json")

    def pay(self, order_uuid, amount, mutation_id=None):
        return self.client.post("/api/pos/payment/create/", {
            "order_id": order_uuid,
            "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "payment_method": "cash",
            "amount": str(amount),
            "change_amount": "0",
            "client_mutation_id": mutation_id or str(uuid.uuid4()),
        }, format="json")


class DineInStockDeductionTests(PosFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        seed_merchant_reference_data(self.merchant)
        self.location = InventoryLocation.objects.get(merchant=self.merchant, name="Bar")
        self.stock = InventoryItem.objects.create(
            merchant=self.merchant,
            name="Coke bottle",
            item_type="DIRECT_SALE",
            category=InventoryCategory.objects.filter(merchant=self.merchant).first(),
            default_location=self.location,
            base_unit=get_system_unit("piece"),
        )
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.stock, location=self.location,
            opening_qty=Decimal("10"),
        )
        MenuItemStockLink.objects.create(
            merchant=self.merchant, menu_item=self.coke,
            inventory_item=self.stock, quantity_per_unit=1,
        )

    def on_hand(self):
        return InventoryBalance.objects.get(
            inventory_item=self.stock, location=self.location,
        ).on_hand

    def sales(self):
        return InventoryMovement.objects.filter(
            inventory_item=self.stock, movement_type=MovementType.SALE,
        )

    def test_dine_in_order_is_stored_as_dine_in_and_deducts_stock(self):
        resp = self.create_pos_order([(self.coke, 3), (self.tea, 1)])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["fulfillment_type"], Order.FULFILLMENT_DINE_IN)
        self.assertEqual(self.on_hand(), Decimal("7"))
        self.assertEqual(self.sales().count(), 1)

    def test_resubmitted_order_does_not_deduct_twice(self):
        mutation_id = str(uuid.uuid4())
        first = self.create_pos_order([(self.coke, 2)], mutation_id=mutation_id)
        again = self.create_pos_order([(self.coke, 2)], mutation_id=mutation_id)
        self.assertEqual(first.data["id"], again.data["id"])
        order = Order.objects.get(id=first.data["id"])
        deduct_stock_for_order(order)  # repeated deduction is a no-op
        self.assertEqual(self.on_hand(), Decimal("8"))
        self.assertEqual(self.sales().count(), 1)

    def test_takeaway_order_does_not_deduct(self):
        resp = self.create_pos_order([(self.coke, 2)], fulfillment="takeaway")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["fulfillment_type"], Order.FULFILLMENT_PICKUP)
        self.assertEqual(self.on_hand(), Decimal("10"))

    def test_quantity_per_unit_is_applied(self):
        link = MenuItemStockLink.objects.get(menu_item=self.coke)
        link.quantity_per_unit = Decimal("0.5")
        link.save()
        self.create_pos_order([(self.coke, 3)])
        self.assertEqual(self.on_hand(), Decimal("8.5"))

    def test_short_stock_never_blocks_the_sale(self):
        resp = self.create_pos_order([(self.coke, 15)])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.on_hand(), Decimal("0"))
        self.assertIn("Short by", self.sales().get().note)

    def test_accepting_pending_order_deducts_and_cancel_restores(self):
        order = Order.objects.create(
            merchant=self.merchant, status=Order.STATUS_PENDING,
            fulfillment_type=Order.FULFILLMENT_DINE_IN,
            source=Order.SOURCE_TABLE_QR, total_amount=200,
        )
        OrderItem.objects.create(
            order=order, menu_item=self.coke, name="Coke",
            price=100, quantity=2, subtotal=200,
        )
        resp = self.client.post("/api/pos/order/status/", {
            "order_id": str(order.uuid), "status": "confirmed",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.on_hand(), Decimal("8"))

        resp = self.client.post("/api/pos/order/status/", {
            "order_id": str(order.uuid), "status": "cancelled",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.on_hand(), Decimal("10"))

    def test_merchant_cancel_restores_once(self):
        resp = self.create_pos_order([(self.coke, 4)])
        self.assertEqual(self.on_hand(), Decimal("6"))
        order_id = resp.data["id"]
        cancel = self.client.patch(f"/api/orders/{order_id}/cancel/", {}, format="json")
        self.assertEqual(cancel.status_code, 200, cancel.data)
        self.assertEqual(self.on_hand(), Decimal("10"))
        from inventory.order_stock import restore_stock_for_order
        restore_stock_for_order(Order.objects.get(id=order_id))
        self.assertEqual(self.on_hand(), Decimal("10"))

    def test_added_items_on_confirmed_dine_in_order_deduct_only_new_lines(self):
        resp = self.create_pos_order([(self.coke, 1)])
        self.assertEqual(self.on_hand(), Decimal("9"))
        add = self.client.post(f"/api/orders/{resp.data['id']}/add-items/", {
            "items": [{"menu_item_id": self.coke.id, "quantity": 2}],
        }, format="json")
        self.assertEqual(add.status_code, 200, add.data)
        self.assertEqual(self.on_hand(), Decimal("7"))
        self.assertEqual(self.sales().count(), 2)

    def test_inventory_item_menu_links_api(self):
        url = f"/api/inventory/items/{self.stock.id}/"
        resp = self.client.patch(url, {
            "menu_links": [
                {"menu_item": self.coke.id, "quantity_per_unit": "1"},
                {"menu_item": str(self.tea.id), "quantity_per_unit": "2"},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        links = {row["menu_item"]: row for row in resp.data["menu_links"]}
        self.assertEqual(set(links), {self.coke.id, self.tea.id})
        self.assertEqual(Decimal(links[self.tea.id]["quantity_per_unit"]), Decimal("2"))

        resp = self.client.patch(url, {"menu_links": []}, format="json")
        self.assertEqual(resp.data["menu_links"], [])

    def test_menu_links_reject_foreign_menu_items_and_bad_quantities(self):
        other_user = get_user_model().objects.create_user(
            username="other", email="other@test.com", password="x", role="merchant",
        )
        other = MerchantProfile.objects.create(
            user=other_user, business_name="Other", slug="other-cafe",
        )
        foreign = MenuItem.objects.create(merchant=other, name="Foreign", price=1)
        url = f"/api/inventory/items/{self.stock.id}/"
        for payload in (
            [{"menu_item": foreign.id, "quantity_per_unit": "1"}],
            [{"menu_item": self.coke.id, "quantity_per_unit": "0"}],
            [{"menu_item": self.coke.id, "quantity_per_unit": "abc"}],
        ):
            with self.subTest(payload=payload):
                resp = self.client.patch(url, {"menu_links": payload}, format="json")
                self.assertEqual(resp.status_code, 400)
        # The original link is untouched by the rejected requests.
        self.assertTrue(MenuItemStockLink.objects.filter(menu_item=self.coke).exists())


class CustomerLoyaltyInfoTests(PosFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        User = get_user_model()
        user = User.objects.create_user(
            username="ram", email="ram@test.com", password="x",
            role="customer", phone="9800000001",
        )
        self.customer = CustomerProfile.objects.create(user=user, full_name="Ram Customer")
        _, wallet, _ = join_merchant(self.customer, self.merchant)
        award_wallet_points(wallet, 42, description="test")
        for status in (Order.STATUS_COMPLETED, Order.STATUS_COMPLETED, Order.STATUS_CANCELLED):
            Order.objects.create(
                customer=self.customer, merchant=self.merchant,
                total_amount=10, status=status,
            )
        # Free reward claims aren't purchases and don't count either.
        Order.objects.create(
            customer=self.customer, merchant=self.merchant, total_amount=0,
            status=Order.STATUS_COMPLETED, order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
        )
        # Orders at another merchant don't count here.
        other_user = User.objects.create_user(
            username="o", email="o@test.com", password="x", role="merchant",
        )
        other = MerchantProfile.objects.create(user=other_user, business_name="O", slug="o")
        Order.objects.create(customer=self.customer, merchant=other, total_amount=10)

    def test_search_reports_wallet_points_and_order_count(self):
        resp = self.client.get("/api/pos/customers/search/?q=Ram")
        self.assertEqual(resp.status_code, 200)
        [row] = resp.data
        self.assertEqual(row["loyalty_points"], 42)
        self.assertEqual(row["total_orders"], 2)
        self.assertTrue(row["membership_number"])

    def test_create_customer_matching_existing_account_reports_same_info(self):
        resp = self.client.post("/api/pos/customers/create/", {
            "full_name": "Ram Customer", "phone": "9800000001",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["id"], self.customer.id)
        self.assertEqual(resp.data["loyalty_points"], 42)
        self.assertEqual(resp.data["total_orders"], 2)


class CollectPaymentTests(PosFixtureMixin, TestCase):
    def test_paid_order_stays_paid_in_order_list(self):
        order = self.create_pos_order([(self.tea, 2)]).data
        resp = self.pay(order["uuid"], order["total_amount"])
        self.assertEqual(resp.status_code, 201, resp.data)
        listed = next(
            o for o in self.client.get("/api/pos/orders/").data if o["uuid"] == order["uuid"]
        )
        self.assertEqual(listed["payment_status"], "paid")

    def test_paid_order_cannot_be_charged_again(self):
        order = self.create_pos_order([(self.tea, 2)]).data
        mutation_id = str(uuid.uuid4())
        self.assertEqual(self.pay(order["uuid"], order["total_amount"], mutation_id).status_code, 201)

        # A retry of the same payment is idempotent...
        retry = self.pay(order["uuid"], order["total_amount"], mutation_id)
        self.assertEqual(retry.status_code, 200)
        # ...but a new charge on the settled order is refused.
        again = self.pay(order["uuid"], order["total_amount"])
        self.assertEqual(again.status_code, 400)
        self.assertEqual(again.data["payment_status"], "paid")
        self.assertEqual(Order.objects.get(uuid=order["uuid"]).pos_payments.count(), 1)
