"""
Free items, quantity changes after an order is sent, discounts on a sent
order, and optional add-ons.

Run with: python manage.py test pos.test_order_edit
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import (
    InventoryBalance, InventoryCategory, InventoryItem, InventoryLocation, MenuItemStockLink, UnitOfMeasure,
)
from merchants.models import MenuItem, MenuOption, MenuOptionGroup, MerchantProfile
from orders.models import Order

from . import rbac
from .models import PosAuditLog, ShiftWorker


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="edit-owner", email="edit-owner@test.com", password="Owner123!", role="merchant",
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner, business_name="Edit Cafe", slug="edit-cafe",
            is_approved=True, is_open=True, pos_enabled=True, discounts_enabled=True,
            tax_enabled=True, tax_policy="exclusive",
            tax_components=[{"name": "CGST", "rate": 9}, {"name": "SGST", "rate": 9}],
        )
        cls.roles = rbac.ensure_default_roles(cls.merchant)
        cls.coffee = MenuItem.objects.create(
            merchant=cls.merchant, name="Coffee", price=Decimal("100.00"), is_available=True,
        )
        cls.cake = MenuItem.objects.create(
            merchant=cls.merchant, name="Cake", price=Decimal("200.00"), is_available=True,
        )

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def worker(self, name, role_key, pin="1234"):
        resp = self.client.post("/api/pos/workers/team/", {
            "display_name": name, "pin": pin, "staff_role": self.roles[role_key].id,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return ShiftWorker.objects.get(id=resp.data["id"])

    def create_order(self, items, **extra):
        return self.client.post("/api/pos/order/create/", {
            "merchant_id": self.merchant.id, "items": items,
            "fulfillment_type": "pickup", **extra,
        }, format="json")

    def enable_free_items(self, pin=""):
        self.merchant.free_items_enabled = True
        self.merchant.set_free_item_pin(pin)
        self.merchant.save()


class FreeItemTests(Base):
    def test_free_item_refused_when_setting_is_off(self):
        resp = self.create_order([{"menu_item_id": self.coffee.id, "quantity": 1, "is_free": True}])
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data["code"], "free_items_disabled")
        self.assertFalse(Order.objects.exists())

    def test_free_item_is_charged_nothing_and_logged(self):
        self.enable_free_items()
        manager = self.worker("Mina", "manager")
        resp = self.create_order([
            {"menu_item_id": self.coffee.id, "quantity": 2, "is_free": True},
            {"menu_item_id": self.cake.id, "quantity": 1},
        ], worker_id=str(manager.id))
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(id=resp.data["id"])
        free = order.items.get(name="Coffee")
        self.assertTrue(free.is_complimentary)
        self.assertEqual(free.price, Decimal("0.00"))
        self.assertEqual(free.complimentary_value, Decimal("200.00"))
        self.assertEqual(free.complimentary_by_id, manager.id)
        # Only the cake is charged: 200 + 18% tax.
        self.assertEqual(order.subtotal, Decimal("200.00"))
        self.assertEqual(order.tax_amount, Decimal("36.00"))
        self.assertEqual(order.total_amount, Decimal("236.00"))

        log = PosAuditLog.objects.get(action=PosAuditLog.ACTION_FREE_ITEM)
        self.assertEqual(log.worker_id, manager.id)
        self.assertEqual(log.metadata["given_by"], "Mina")
        self.assertEqual(log.metadata["items"][0]["name"], "Coffee")
        self.assertEqual(log.metadata["value"], "200.00")

    def test_role_without_permission_cannot_give_free_items(self):
        self.enable_free_items()
        cashier = self.worker("Chandra", "cashier")
        self.assertFalse(rbac.worker_can(cashier, "items.free"))
        resp = self.create_order(
            [{"menu_item_id": self.coffee.id, "quantity": 1, "is_free": True}],
            worker_id=str(cashier.id),
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data["required_permission"], "items.free")

    def test_pin_is_required_and_checked(self):
        self.enable_free_items(pin="4321")
        items = [{"menu_item_id": self.coffee.id, "quantity": 1, "is_free": True}]
        resp = self.create_order(items)
        self.assertEqual(resp.data["code"], "free_item_pin_required")
        resp = self.create_order(items, free_item_pin="0000")
        self.assertEqual(resp.data["code"], "free_item_pin_invalid")
        resp = self.create_order(items, free_item_pin="4321")
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_wrong_pin_locks_after_repeated_attempts(self):
        self.enable_free_items(pin="4321")
        items = [{"menu_item_id": self.coffee.id, "quantity": 1, "is_free": True}]
        for _ in range(5):
            self.assertEqual(self.create_order(items, free_item_pin="1111").status_code, 403)
        resp = self.create_order(items, free_item_pin="4321")
        self.assertEqual(resp.status_code, 429, resp.data)

    def test_staff_free_order_follows_the_same_rules(self):
        items = [{"menu_item_id": self.coffee.id, "quantity": 1}]
        resp = self.create_order(items, order_type="staff_comp")
        self.assertEqual(resp.data["code"], "free_items_disabled")
        self.enable_free_items()
        resp = self.create_order(items, order_type="staff_comp")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(resp.data["total_amount"]), Decimal("0.00"))
        self.assertTrue(PosAuditLog.objects.filter(action=PosAuditLog.ACTION_FREE_ITEM).exists())

    def test_free_flag_is_ignored_for_normal_customers(self):
        # The customer ordering API never passes allow_free, so the flag does nothing.
        from orders.pricing import price_request_lines

        priced = price_request_lines(
            self.merchant, [{"menu_item_id": self.coffee.id, "quantity": 1, "is_free": True}],
        )
        self.assertEqual(priced[0].line.unit_price, Decimal("100.00"))
        self.assertNotIn("is_complimentary", priced[0].item_fields)

    def test_pin_setting_needs_current_pin_or_password_to_change(self):
        url = "/api/pos/settings/free-item-pin/"
        self.assertEqual(self.client.post(url, {"pin": "12"}, format="json").status_code, 400)
        resp = self.client.post(url, {"pin": "1234"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data["free_item_pin_set"])
        self.merchant.refresh_from_db()
        self.assertNotIn("1234", self.merchant.free_item_pin_hash)
        # Changing it without proof is refused.
        self.assertEqual(self.client.post(url, {"pin": "9999"}, format="json").status_code, 403)
        resp = self.client.post(url, {"pin": "9999", "current_pin": "1234"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        # The account password also works, e.g. when the PIN is forgotten.
        resp = self.client.post(url, {"pin": "", "account_password": "Owner123!"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertFalse(resp.data["free_item_pin_set"])

    def test_cashier_in_staff_mode_cannot_set_the_pin(self):
        cashier = self.worker("Chandra", "cashier")
        resp = self.client.post("/api/pos/staff/session/", {"worker_id": str(cashier.id), "pin": "1234"}, format="json")
        staff = APIClient()
        staff.force_authenticate(self.owner)
        staff.credentials(HTTP_X_ZENTRO_STAFF=resp.data["token"])
        resp = staff.post("/api/pos/settings/free-item-pin/", {"pin": "1234"}, format="json")
        self.assertEqual(resp.status_code, 403)


class QuantityChangeTests(Base):
    def order(self):
        resp = self.create_order([
            {"menu_item_id": self.coffee.id, "quantity": 2},
            {"menu_item_id": self.cake.id, "quantity": 1},
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        return Order.objects.get(id=resp.data["id"])

    def change(self, order, item, quantity, client=None, **extra):
        return (client or self.client).post("/api/pos/order/item/update/", {
            "order_id": str(order.uuid), "item_id": item.id, "quantity": quantity, **extra,
        }, format="json")

    def test_reduce_quantity_reprices_bill_and_tax(self):
        order = self.order()
        self.assertEqual(order.total_amount, Decimal("472.00"))  # 400 + 18%
        coffee = order.items.get(name="Coffee")
        resp = self.change(order, coffee, 1, reason="Customer changed mind")
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        coffee.refresh_from_db()
        self.assertEqual(coffee.quantity, 1)
        self.assertEqual(coffee.subtotal, Decimal("100.00"))
        self.assertEqual(order.subtotal, Decimal("300.00"))
        self.assertEqual(order.tax_amount, Decimal("54.00"))
        self.assertEqual(order.total_amount, Decimal("354.00"))
        self.assertEqual([t["name"] for t in order.tax_breakdown], ["CGST", "SGST"])

        log = PosAuditLog.objects.get(action=PosAuditLog.ACTION_ORDER_ITEM_UPDATE)
        self.assertEqual(log.metadata["from_quantity"], 2)
        self.assertEqual(log.metadata["to_quantity"], 1)
        self.assertEqual(log.metadata["reason"], "Customer changed mind")

    def test_discount_is_recalculated_after_a_reduction(self):
        order = self.order()
        resp = self.client.post("/api/pos/discount/apply/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker("Mina", "manager").id),
            "discount_type": "percentage", "discount_value": "10",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(resp.data["pricing"]["grand_total"]), Decimal("424.80"))
        order.refresh_from_db()
        self.assertEqual(order.discount_amount, Decimal("40.00"))

        resp = self.change(order, order.items.get(name="Coffee"), 1)
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.subtotal, Decimal("300.00"))
        self.assertEqual(order.discount_amount, Decimal("30.00"))
        self.assertEqual(order.tax_amount, Decimal("48.60"))   # 18% of 270
        self.assertEqual(order.total_amount, Decimal("318.60"))

    def test_remove_a_line_and_never_the_last_one(self):
        order = self.order()
        resp = self.change(order, order.items.get(name="Cake"), 0)
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.items.count(), 1)
        self.assertEqual(order.total_amount, Decimal("236.00"))
        resp = self.change(order, order.items.get(), 0)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["code"], "last_item")

    def test_increase_and_paid_orders_are_refused(self):
        order = self.order()
        coffee = order.items.get(name="Coffee")
        self.assertEqual(self.change(order, coffee, 3).data["code"], "use_add_items")
        Order.objects.filter(pk=order.pk).update(payment_status="paid")
        self.assertEqual(self.change(order, coffee, 1).data["code"], "order_paid")

    def test_permissions_edit_to_reduce_cancel_to_remove(self):
        order = self.order()
        coffee = order.items.get(name="Coffee")
        cashier = self.worker("Chandra", "cashier")       # orders.edit, not orders.cancel
        resp = self.change(order, order.items.get(name="Cake"), 0, worker_id=str(cashier.id))
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data["required_permission"], "orders.cancel")
        resp = self.change(order, coffee, 1, worker_id=str(cashier.id))
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_other_merchant_cannot_touch_the_order(self):
        order = self.order()
        User = get_user_model()
        other_owner = User.objects.create_user(
            username="edit-other", email="edit-other@test.com", password="Other123!", role="merchant",
        )
        MerchantProfile.objects.create(
            user=other_owner, business_name="Other", slug="edit-other", pos_enabled=True,
        )
        other = APIClient()
        other.force_authenticate(other_owner)
        resp = self.change(order, order.items.first(), 1, client=other)
        self.assertEqual(resp.status_code, 404)

    def test_stock_comes_back_for_removed_units_only_once(self):
        unit = UnitOfMeasure.objects.first() or UnitOfMeasure.objects.create(
            code="g", name="Gram", kind="WEIGHT", factor_to_base=Decimal("1"), is_base=True,
        )
        location = InventoryLocation.objects.create(merchant=self.merchant, name="Bar", is_default=True)
        beans = InventoryItem.objects.create(
            merchant=self.merchant, name="Beans", item_type="INGREDIENT", base_unit=unit,
            category=InventoryCategory.objects.create(merchant=self.merchant, name="Dry goods"),
            default_location=location,
        )
        InventoryBalance.objects.create(
            merchant=self.merchant, inventory_item=beans, location=location, on_hand=Decimal("100"),
        )
        MenuItemStockLink.objects.create(
            merchant=self.merchant, menu_item=self.coffee, inventory_item=beans,
            quantity_per_unit=Decimal("10"),
        )
        resp = self.create_order(
            [{"menu_item_id": self.coffee.id, "quantity": 3}, {"menu_item_id": self.cake.id, "quantity": 1}],
            fulfillment_type="dine-in",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(id=resp.data["id"])
        balance = InventoryBalance.objects.get(inventory_item=beans, location=location)
        self.assertEqual(balance.on_hand, Decimal("70"))

        coffee = order.items.get(name="Coffee")
        self.assertEqual(self.change(order, coffee, 2).status_code, 200)
        balance.refresh_from_db()
        self.assertEqual(balance.on_hand, Decimal("80"))
        order.refresh_from_db()
        self.assertEqual(self.change(order, coffee, 1).status_code, 200)
        balance.refresh_from_db()
        self.assertEqual(balance.on_hand, Decimal("90"))

        # Cancelling afterwards returns only what is still consumed.
        from inventory.order_stock import restore_stock_for_order
        order.refresh_from_db()
        restore_stock_for_order(order)
        balance.refresh_from_db()
        self.assertEqual(balance.on_hand, Decimal("100"))


class OptionalAddOnTests(Base):
    def test_addon_group_is_optional_unless_marked_required(self):
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.coffee, name="Extras",
            kind="modifier", required=False, min_select=1, max_select=3,
        )
        self.assertEqual(group.min_select, 0)
        resp = self.create_order([{"menu_item_id": self.coffee.id, "quantity": 1}])
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_required_addon_group_still_blocks_the_order(self):
        group = MenuOptionGroup.objects.create(
            merchant=self.merchant, menu_item=self.coffee, name="Milk",
            kind="modifier", required=True, max_select=1,
        )
        MenuOption.objects.create(merchant=self.merchant, group=group, name="Oat", price_delta=Decimal("20.00"))
        resp = self.create_order([{"menu_item_id": self.coffee.id, "quantity": 1}])
        self.assertEqual(resp.status_code, 400, resp.data)
