"""
Live POS table status and moving an open bill to a free table.

Run with: python manage.py test pos.test_table_move
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MenuItem, MerchantProfile, MerchantTable, TableArea
from orders.models import KitchenOrderTicket, Order

from . import rbac
from .models import PosAuditLog, ShiftWorker


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="table-owner", email="table-owner@test.com",
            password="Owner123!", role="merchant",
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner, business_name="Table Cafe", slug="table-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        cls.roles = rbac.ensure_default_roles(cls.merchant)
        cls.coffee = MenuItem.objects.create(
            merchant=cls.merchant, name="Coffee", price=Decimal("100.00"), is_available=True,
        )

        cls.main = TableArea.objects.create(merchant=cls.merchant, name="Main", display_order=0)
        cls.bar = TableArea.objects.create(merchant=cls.merchant, name="Bar", display_order=1)
        cls.table_a = MerchantTable.objects.create(
            merchant=cls.merchant, area=cls.main, name="A1", table_number=1,
        )
        cls.table_b = MerchantTable.objects.create(
            merchant=cls.merchant, area=cls.main, name="A2", table_number=2,
        )
        cls.table_bar = MerchantTable.objects.create(
            merchant=cls.merchant, area=cls.bar, name="B1", table_number=3,
        )

        cls.other_owner = User.objects.create_user(
            username="table-other", email="table-other@test.com",
            password="Other123!", role="merchant",
        )
        cls.other = MerchantProfile.objects.create(
            user=cls.other_owner, business_name="Other Cafe", slug="other-table-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        cls.other_table = MerchantTable.objects.create(
            merchant=cls.other, name="Other 1", table_number=1,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def create_order(self, table, *, fulfillment="dine_in"):
        resp = self.client.post("/api/pos/order/create/", {
            "merchant_id": self.merchant.id,
            "items": [{"menu_item_id": self.coffee.id, "quantity": 1}],
            "fulfillment_type": fulfillment,
            "table_id": table.id if table else None,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return Order.objects.get(id=resp.data["id"])

    def employee(self, name, role_key=None, areas=(), pin="1234", role=None):
        resp = self.client.post("/api/pos/workers/team/", {
            "display_name": name, "pin": pin,
            "staff_role": (role or self.roles[role_key]).id,
            "area_ids": list(areas),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return ShiftWorker.objects.get(id=resp.data["id"])

    def as_staff(self, worker, pin="1234"):
        resp = self.client.post("/api/pos/staff/session/", {
            "worker_id": str(worker.id), "pin": pin,
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        client = APIClient()
        client.force_authenticate(self.owner)
        client.credentials(HTTP_X_ZENTRO_STAFF=resp.data["token"])
        return client


class TableStatusTests(Base):
    def test_lists_tables_as_available(self):
        resp = self.client.get("/api/pos/tables/status/")
        self.assertEqual(resp.status_code, 200, resp.data)
        by_name = {t["name"]: t for t in resp.data["tables"]}
        self.assertFalse(by_name["A1"]["is_occupied"])
        self.assertIsNone(by_name["A1"]["bill"])
        self.assertEqual(by_name["A1"]["area_name"], "Main")

    def test_occupied_table_shows_its_open_bill(self):
        order = self.create_order(self.table_a)

        resp = self.client.get("/api/pos/tables/status/")
        self.assertEqual(resp.status_code, 200, resp.data)
        by_name = {t["name"]: t for t in resp.data["tables"]}
        table = by_name["A1"]
        self.assertTrue(table["is_occupied"])
        self.assertEqual(table["open_bill_count"], 1)
        self.assertEqual(table["bill"]["uuid"], str(order.uuid))
        self.assertEqual(table["bill"]["item_count"], 1)

    def test_area_restricted_worker_sees_only_their_area(self):
        worker = self.employee("Sita", "cashier", areas=[self.main.id])
        staff = self.as_staff(worker)

        resp = staff.get("/api/pos/tables/status/")
        self.assertEqual(resp.status_code, 200, resp.data)
        names = {t["name"] for t in resp.data["tables"]}
        self.assertEqual(names, {"A1", "A2"})


class MoveTableTests(Base):
    def move(self, order, table, client=None):
        return (client or self.client).post("/api/pos/order/table/move/", {
            "order_id": str(order.uuid),
            "table_id": table.id,
        }, format="json")

    def test_moves_bill_to_free_table_and_frees_the_old_one(self):
        order = self.create_order(self.table_a)
        old_session = order.dining_session
        self.assertIsNotNone(old_session)

        resp = self.move(order, self.table_b)
        self.assertEqual(resp.status_code, 200, resp.data)

        order.refresh_from_db()
        self.assertEqual(order.table_id, self.table_b.id)
        self.assertEqual(order.table_name_snapshot, "A2")
        self.assertEqual(order.table_number_snapshot, 2)
        self.assertEqual(order.status, Order.STATUS_CONFIRMED)

        old_session.refresh_from_db()
        self.assertEqual(old_session.table_id, self.table_b.id)

        self.assertFalse(
            KitchenOrderTicket.objects.filter(order=order)
            .exclude(table_name_snapshot="A2", table_number_snapshot=2)
            .exists()
        )

        log = PosAuditLog.objects.get(action=PosAuditLog.ACTION_TABLE_MOVE)
        self.assertEqual(log.metadata["from_table_id"], self.table_a.id)
        self.assertEqual(log.metadata["to_table_id"], self.table_b.id)

        statuses = {t["name"]: t for t in self.client.get("/api/pos/tables/status/").data["tables"]}
        self.assertFalse(statuses["A1"]["is_occupied"])
        self.assertTrue(statuses["A2"]["is_occupied"])

    def test_same_table_is_a_no_op(self):
        order = self.create_order(self.table_a)
        resp = self.move(order, self.table_a)
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.table_id, self.table_a.id)

    def test_occupied_destination_is_refused_and_nothing_changes(self):
        source = self.create_order(self.table_a)
        self.create_order(self.table_b)

        resp = self.move(source, self.table_b)
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertEqual(resp.data["code"], "table_occupied")

        source.refresh_from_db()
        self.assertEqual(source.table_id, self.table_a.id)

    def test_paid_or_completed_orders_cannot_move(self):
        order = self.create_order(self.table_a)
        order.status = Order.STATUS_COMPLETED
        order.save(update_fields=["status"])

        resp = self.move(order, self.table_b)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertIn(resp.data["code"], {"order_closed", "order_paid"})

        order.refresh_from_db()
        self.assertEqual(order.table_id, self.table_a.id)

    def test_non_dine_in_order_cannot_move(self):
        order = self.create_order(None, fulfillment="pickup")
        resp = self.move(order, self.table_b)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data["code"], "not_dine_in")

    def test_cannot_move_to_another_merchants_table(self):
        order = self.create_order(self.table_a)
        resp = self.move(order, self.other_table)
        self.assertEqual(resp.status_code, 404, resp.data)

    def test_worker_cannot_move_into_another_area(self):
        order = self.create_order(self.table_a)
        worker = self.employee("Ram", "server", areas=[self.main.id])
        staff = self.as_staff(worker)

        resp = self.move(order, self.table_bar, client=staff)
        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data["code"], "area_restricted")

        order.refresh_from_db()
        self.assertEqual(order.table_id, self.table_a.id)

    def test_staff_mode_gate_only_requires_orders_edit(self):
        from .middleware import required_permission

        self.assertEqual(
            required_permission("/api/pos/order/table/move/", "POST"),
            "orders.edit",
        )

    def test_worker_without_orders_edit_cannot_move(self):
        order = self.create_order(self.table_a)
        role_resp = self.client.post("/api/pos/roles/", {
            "name": "Table Viewer",
            "permissions": ["pos.access", "orders.view"],
        }, format="json")
        self.assertEqual(role_resp.status_code, 201, role_resp.data)
        worker = self.employee("Kiran", role_key="cashier")
        worker.staff_role_id = role_resp.data["id"]
        worker.save(update_fields=["staff_role"])
        staff = self.as_staff(worker)

        resp = self.move(order, self.table_b, client=staff)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "no_access")

        order.refresh_from_db()
        self.assertEqual(order.table_id, self.table_a.id)
