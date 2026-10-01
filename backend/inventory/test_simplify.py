"""
inventory/test_simplify.py

Regression tests for the simplified inventory: server-side permissions (owner
vs POS staff mode), cost privacy in JSON and exports, tenant isolation,
real pagination, safe undo, correction approval, item removal, and the
CSV/PDF import + export pipeline — which must never write InventoryBalance
except through InventoryMovementService.
"""

import csv
import io
from decimal import Decimal
from unittest import mock

import pymupdf
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models import Sum
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos.models import ShiftWorker

from . import importing
from .models import (
    AdjustmentStatus,
    CountStatus,
    InventoryAdjustment,
    InventoryBalance,
    InventoryImportSession,
    InventoryItem,
    InventoryMovement,
    InventoryReceiving,
    InventoryTransfer,
    MovementType,
    StockCount,
    StockCountLine,
    UnitOfMeasure,
)
from .permissions import InvPerm
from .reports import build_report
from .services import (
    InventoryMovementService,
    StockCountService,
    seed_default_units,
    seed_merchant_reference_data,
    stock_status,
    with_stock_totals,
)


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_default_units()
        cls.kg = UnitOfMeasure.objects.get(merchant__isnull=True, code="kg")
        cls.g = UnitOfMeasure.objects.get(merchant__isnull=True, code="g")
        cls.litre = UnitOfMeasure.objects.get(merchant__isnull=True, code="L")
        cls.piece = UnitOfMeasure.objects.get(merchant__isnull=True, code="piece")
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="simp-owner", email="simp-owner@test.com", password="Owner123!", role="merchant"
        )
        cls.merchant = MerchantProfile.objects.create(user=cls.owner, business_name="Silver Fir", slug="silver-fir")
        seed_merchant_reference_data(cls.merchant)
        cls.other = User.objects.create_user(
            username="simp-other", email="simp-other@test.com", password="Other123!", role="merchant"
        )
        cls.merchant2 = MerchantProfile.objects.create(user=cls.other, business_name="Other Place", slug="other-place")
        seed_merchant_reference_data(cls.merchant2)
        cls.kitchen = cls.merchant.inventory_locations.get(name="Main Kitchen")
        cls.bar = cls.merchant.inventory_locations.get(name="Bar")
        cls.dry = cls.merchant.inventory_locations.get(name="Dry Storage")
        cls.category = cls.merchant.inventory_categories.get(name="Dry Goods")
        cls.kitchen2 = cls.merchant2.inventory_locations.get(name="Main Kitchen")
        cls.category2 = cls.merchant2.inventory_categories.get(name="Dry Goods")

        def worker(name, role):
            w = ShiftWorker(merchant=cls.merchant, display_name=name, role=role)
            w.set_pin("1234")
            w.save()
            return w

        cls.cashier = worker("Sita", ShiftWorker.ROLE_CASHIER)
        cls.waiter = worker("Hari", ShiftWorker.ROLE_WAITER)
        cls.manager = worker("Maya", ShiftWorker.ROLE_MANAGER)
        # Inventory capabilities come from the employee's central role (pos.rbac).
        cls.stock_helper = worker("Gita", ShiftWorker.ROLE_CASHIER)
        cls.give_role(cls.stock_helper, "Stock Helper",
                      ["inventory.view", "inventory.count", "inventory.waste"])
        cls.give_role(cls.waiter, "Runner", ["inventory.view", "inventory.transfer"])

    @classmethod
    def give_role(cls, worker, name, codes):
        from pos import rbac
        from pos.models import StaffRole

        role = StaffRole.objects.create(merchant=worker.merchant, name=name)
        rbac.set_role_permissions(role, codes)
        rbac.assign_role(worker, role)
        return role

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)
        # Tests must never call the real AI provider.
        from merchants.ai.gemini_scanner import MenuScanError

        guard = mock.patch("merchants.ai.gemini_scanner.requests.post",
                           side_effect=MenuScanError("network disabled in tests"))
        guard.start()
        self.addCleanup(guard.stop)

    # helpers
    def item(self, name="Rice", unit=None, merchant=None, location=None, qty=None, cost=None, **extra):
        merchant = merchant or self.merchant
        category = self.category if merchant == self.merchant else self.category2
        location = location or (self.kitchen if merchant == self.merchant else self.kitchen2)
        item = InventoryItem.objects.create(
            merchant=merchant, name=name, item_type="INGREDIENT", category=category,
            base_unit=unit or self.kg, default_location=location, **extra,
        )
        if qty:
            InventoryMovementService.opening_balance(
                merchant=merchant, item=item, location=location, opening_qty=Decimal(qty),
                unit_cost=Decimal(cost) if cost else None,
            )
        return item

    def staff(self, worker):
        resp = self.client.post("/api/inventory/staff/session/", {"worker_id": str(worker.id), "pin": "1234"},
                                format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        client = APIClient()
        client.force_authenticate(user=self.owner)
        client.credentials(HTTP_X_INVENTORY_STAFF=resp.data["token"])
        return client

    def balance(self, item, location=None):
        b = InventoryBalance.objects.filter(inventory_item=item, location=location or self.kitchen).first()
        return b.on_hand if b else Decimal("0")

    def assert_ledger_matches(self, merchant=None):
        """Every balance equals the sum of its movements (nothing bypassed the service)."""
        for b in InventoryBalance.objects.filter(merchant=merchant or self.merchant):
            total = InventoryMovement.objects.filter(
                inventory_item=b.inventory_item, location=b.location
            ).aggregate(t=Sum("quantity_change"))["t"] or Decimal("0")
            self.assertEqual(b.on_hand, total, f"{b} does not match its history")


# ─────────────────────────────────────────────────────────────────────────────
# Permissions
# ─────────────────────────────────────────────────────────────────────────────


class PermissionTests(Base):
    def test_root_reports_role_and_permissions(self):
        data = self.client.get("/api/inventory/").data
        self.assertEqual(data["role"], "owner")
        self.assertTrue(all(data["permissions"].values()))
        self.assertTrue(data["staff_mode_available"])

    def test_wrong_pin_rejected(self):
        resp = self.client.post("/api/inventory/staff/session/",
                                {"worker_id": str(self.cashier.id), "pin": "9999"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_default_cashier_has_no_inventory_access(self):
        self.item(qty="10")
        staff = self.staff(self.cashier)
        self.assertEqual(staff.get("/api/inventory/items/").status_code, 403)
        self.assertEqual(staff.get("/api/inventory/").status_code, 403)

    def test_cashier_limits_enforced_server_side(self):
        rice = self.item(qty="10", cost="100")
        staff = self.staff(self.stock_helper)
        root = staff.get("/api/inventory/").data
        self.assertEqual(root["role"], "custom")
        self.assertFalse(root["permissions"][InvPerm.VIEW_COST])
        # Can see stock (without costs), count and record waste.
        items = staff.get("/api/inventory/items/").data["results"]
        self.assertIsNone(items[0]["stock_value"])
        self.assertIsNone(items[0]["avg_cost"])
        resp = staff.post("/api/inventory/waste/", {
            "inventory_item": rice.id, "location": self.kitchen.id, "quantity": "1", "reason": "DROPPED",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(InventoryMovement.objects.get(movement_type=MovementType.EXPLICIT_WASTE).actor_label,
                         "Gita")
        # Everything else is refused by the backend, not just hidden.
        forbidden = [
            ("post", "/api/inventory/adjustments/", {"inventory_item": rice.id, "location": self.kitchen.id,
                                                     "quantity_delta": "1", "reason": "x"}),
            ("patch", "/api/inventory/settings/", {"prevent_negative_stock": False}),
            ("get", "/api/inventory/settings/", None),
            ("post", "/api/inventory/receiving/", {"location": self.kitchen.id,
                                                   "lines": [{"item_id": rice.id, "quantity": 1}]}),
            ("post", "/api/inventory/transfers/", {"from_location": self.kitchen.id,
                                                   "to_location": self.bar.id, "lines": []}),
            ("post", "/api/inventory/items/", {"name": "New", "item_type": "INGREDIENT",
                                               "base_unit": self.kg.id}),
            ("delete", f"/api/inventory/items/{rice.id}/", None),
            ("get", "/api/inventory/movements/", None),
            ("get", "/api/inventory/audit/", None),
            ("get", "/api/inventory/exports/current-stock.csv", None),
            ("get", "/api/inventory/import/", None),
            ("get", "/api/inventory/suppliers/", None),
            ("post", f"/api/inventory/movements/{InventoryMovement.objects.first().id}/reversal/", None),
        ]
        for method, url, body in forbidden:
            resp = getattr(staff, method)(url, body, format="json") if body is not None else getattr(staff, method)(url)
            self.assertEqual(resp.status_code, 403, f"{method.upper()} {url} should be forbidden")

    def test_waiter_can_move_stock(self):
        rice = self.item(qty="10")
        staff = self.staff(self.waiter)
        resp = staff.post("/api/inventory/transfers/", {
            "from_location": self.kitchen.id, "to_location": self.bar.id, "complete": True,
            "lines": [{"item_id": rice.id, "quantity": "4"}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.balance(rice, self.bar), Decimal("4"))

    def test_manager_can_fix_stock_but_not_settings_or_import(self):
        rice = self.item(qty="10")
        staff = self.staff(self.manager)
        resp = staff.post("/api/inventory/adjustments/", {
            "inventory_item": rice.id, "location": self.kitchen.id, "quantity_delta": "-2", "reason": "Typo",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.balance(rice), Decimal("8"))
        self.assertEqual(staff.get("/api/inventory/settings/").status_code, 403)
        self.assertEqual(staff.get("/api/inventory/import/").status_code, 403)
        self.assertEqual(staff.get("/api/inventory/exports/current-stock.csv").status_code, 200)

    def test_bad_staff_token_fails_closed(self):
        client = APIClient()
        client.force_authenticate(user=self.owner)
        client.credentials(HTTP_X_INVENTORY_STAFF="forged-token")
        self.assertEqual(client.get("/api/inventory/items/").status_code, 403)

    def test_staff_token_from_other_merchant_rejected(self):
        token = self.client.post("/api/inventory/staff/session/",
                                 {"worker_id": str(self.cashier.id), "pin": "1234"}, format="json").data["token"]
        client = APIClient()
        client.force_authenticate(user=self.other)
        client.credentials(HTTP_X_INVENTORY_STAFF=token)
        self.assertEqual(client.get("/api/inventory/items/").status_code, 403)

    def test_leaving_staff_mode_needs_owner_password_or_manager_pin(self):
        staff = self.staff(self.stock_helper)
        self.assertEqual(staff.post("/api/inventory/staff/session/end/", {"password": "nope"},
                                    format="json").status_code, 401)
        self.assertEqual(staff.post("/api/inventory/staff/session/end/",
                                    {"worker_id": str(self.cashier.id), "pin": "1234"},
                                    format="json").status_code, 401)
        self.assertEqual(staff.post("/api/inventory/staff/session/end/",
                                    {"worker_id": str(self.manager.id), "pin": "1234"},
                                    format="json").status_code, 200)
        self.assertEqual(staff.post("/api/inventory/staff/session/end/", {"password": "Owner123!"},
                                    format="json").status_code, 200)

    def test_customer_account_rejected(self):
        customer = get_user_model().objects.create_user(
            username="simp-cust", email="c@test.com", password="x", role="customer"
        )
        client = APIClient()
        client.force_authenticate(user=customer)
        self.assertEqual(client.get("/api/inventory/items/").status_code, 403)

    def test_staff_finishing_count_with_auto_approve_waits_for_manager(self):
        settings_obj = self.merchant.inventory_settings
        settings_obj.require_count_approval = False
        settings_obj.save()
        rice = self.item(qty="10")
        staff = self.staff(self.stock_helper)
        count = staff.post("/api/inventory/counts/", {"name": "Kitchen", "location": self.kitchen.id},
                           format="json").data
        line = count["lines"][0]
        staff.post(f"/api/inventory/counts/{count['id']}/lines/", {"line_id": line["id"], "physical_quantity": "7"},
                   format="json")
        resp = staff.post(f"/api/inventory/counts/{count['id']}/submit/")
        self.assertEqual(resp.data["status"], CountStatus.SUBMITTED)
        self.assertEqual(self.balance(rice), Decimal("10"))
        self.assertEqual(staff.post(f"/api/inventory/counts/{count['id']}/approve/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/inventory/counts/{count['id']}/approve/").status_code, 200)
        self.assertEqual(self.balance(rice), Decimal("7"))


# ─────────────────────────────────────────────────────────────────────────────
# Tenant isolation & cost leak
# ─────────────────────────────────────────────────────────────────────────────


class TenantTests(Base):
    def test_count_difference_cost_never_uses_other_merchant_balance(self):
        """Regression: the variance report used item.balances.first()."""
        flour = self.item("Flour", qty="70", cost="2")
        # A corrupt/foreign balance row for the same item with a huge cost,
        # created first so an unscoped .first() would pick it.
        InventoryBalance.objects.filter(inventory_item=flour).delete()
        InventoryBalance.objects.create(merchant=self.merchant2, location=self.kitchen2,
                                        inventory_item=flour, on_hand=0, avg_cost=Decimal("9999"))
        InventoryBalance.objects.create(merchant=self.merchant, location=self.kitchen,
                                        inventory_item=flour, on_hand=Decimal("70"), avg_cost=Decimal("2"))
        count = StockCountService.create_count(merchant=self.merchant, name="c", location=self.kitchen)
        line = count.lines.get(inventory_item=flour)
        StockCountService.upsert_line(count=count, merchant=self.merchant, line_id=line.id,
                                      physical_quantity=Decimal("43"))
        StockCountService.submit(count=count, merchant=self.merchant)
        StockCountService.approve(count=count, merchant=self.merchant)
        rows = self.client.get("/api/inventory/reports/?report=count-differences").data["results"]
        self.assertEqual(rows[0]["value_difference"], "54")
        self.assertNotIn("9999", str(rows))

    def test_create_item_with_other_merchants_references_rejected(self):
        resp = self.client.post("/api/inventory/items/", {
            "name": "Sneaky", "item_type": "INGREDIENT", "base_unit": self.kg.id,
            "category": self.category2.id,
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post("/api/inventory/items/", {
            "name": "Sneaky", "item_type": "INGREDIENT", "base_unit": self.kg.id,
            "default_location": self.kitchen2.id, "opening_quantity": "5",
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(InventoryItem.objects.filter(name="Sneaky").exists())

    def test_waste_on_other_merchants_item_is_400_not_500(self):
        foreign = self.item("Foreign", merchant=self.merchant2, qty="5")
        resp = self.client.post("/api/inventory/waste/", {
            "inventory_item": foreign.id, "location": self.kitchen.id, "quantity": "1", "reason": "SPOILED",
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.balance(foreign, self.kitchen2), Decimal("5"))

    def test_lists_and_exports_are_merchant_scoped(self):
        self.item("Mine Rice", qty="3")
        self.item("Theirs Rice", merchant=self.merchant2, qty="4")
        names = [i["name"] for i in self.client.get("/api/inventory/items/").data["results"]]
        self.assertEqual(names, ["Mine Rice"])
        body = b"".join(self.client.get("/api/inventory/exports/current-stock.csv").streaming_content)
        self.assertIn("Mine Rice".encode(), body)
        self.assertNotIn(b"Theirs Rice", body)
        history = self.client.get("/api/inventory/movements/").data["results"]
        self.assertTrue(all(m["item"] == "Mine Rice" for m in history))

    def test_other_merchant_cannot_see_import_session(self):
        session = importing.start_session(
            merchant=self.merchant, user=self.owner, mode="NEW_ITEMS",
            upload=SimpleUploadedFile("a.csv", b"item_name,unit\nSalt,kg\n"),
        )
        client = APIClient()
        client.force_authenticate(user=self.other)
        self.assertEqual(client.get(f"/api/inventory/import/{session.id}/").status_code, 404)
        self.assertEqual(client.post(f"/api/inventory/import/{session.id}/commit/").status_code, 404)


# ─────────────────────────────────────────────────────────────────────────────
# Pagination & status
# ─────────────────────────────────────────────────────────────────────────────


class PaginationTests(Base):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        for i in range(120):
            item = InventoryItem.objects.create(
                merchant=cls.merchant, name=f"Item {i:03d}", item_type="SUPPLY", category=cls.category,
                base_unit=cls.piece, default_location=cls.kitchen, reorder_point=Decimal("5"),
                sku=f"SKU-{i:03d}",
            )
            if i % 3 == 0:
                InventoryMovementService.opening_balance(
                    merchant=cls.merchant, item=item, location=cls.kitchen, opening_qty=Decimal("50"),
                )

    def test_pages_return_only_requested_rows(self):
        first = self.client.get("/api/inventory/items/?page_size=50&page=1").data
        self.assertEqual(len(first["results"]), 50)
        self.assertEqual(first["total_count"], 120)
        self.assertEqual(first["total_pages"], 3)
        self.assertEqual(first["next"], 2)
        self.assertIsNone(first["previous"])
        second = self.client.get("/api/inventory/items/?page_size=50&page=2").data
        self.assertEqual(second["results"][0]["name"], "Item 050")
        third = self.client.get("/api/inventory/items/?page_size=50&page=3").data
        self.assertEqual(len(third["results"]), 20)
        self.assertIsNone(third["next"])

    def test_search_and_filters_keep_pagination(self):
        data = self.client.get("/api/inventory/items/?q=Item 1&page_size=5").data
        self.assertEqual(data["total_count"], 20)  # Item 100 … Item 119
        self.assertEqual(len(data["results"]), 5)
        out = self.client.get("/api/inventory/items/?status=OUT&page_size=25&with_counts=1").data
        self.assertEqual(out["total_count"], 80)
        self.assertEqual(out["status_counts"]["HEALTHY"], 40)
        self.assertTrue(all(r["status"] == "OUT" for r in out["results"]))
        by_sku = self.client.get("/api/inventory/items/?q=SKU-007").data
        self.assertEqual([r["name"] for r in by_sku["results"]], ["Item 007"])

    def test_sql_status_matches_python_rule(self):
        cases = [
            dict(par_level=None, reorder_point=None, critical_level=None, qty="3"),
            dict(par_level=Decimal("10"), reorder_point=Decimal("4"), critical_level=None, qty="2"),
            dict(par_level=Decimal("10"), reorder_point=Decimal("4"), critical_level=None, qty="4"),
            dict(par_level=Decimal("10"), reorder_point=Decimal("4"), critical_level=Decimal("1"), qty="2"),
            dict(par_level=Decimal("10"), reorder_point=None, critical_level=None, qty="16"),
            dict(par_level=None, reorder_point=Decimal("0"), critical_level=None, qty="0.5"),
            dict(par_level=None, reorder_point=Decimal("6"), critical_level=Decimal("0"), qty="2"),
        ]
        for n, case in enumerate(cases):
            qty = case.pop("qty")
            item = self.item(f"Case {n}", unit=self.piece, qty=qty, **case)
            annotated = with_stock_totals(InventoryItem.objects.filter(pk=item.pk), self.merchant).get()
            self.assertEqual(annotated.stock_state, stock_status(item, Decimal(qty)), case)


# ─────────────────────────────────────────────────────────────────────────────
# Undo, corrections, items, deliveries, moves, counts
# ─────────────────────────────────────────────────────────────────────────────


class StockActionTests(Base):
    def test_undo_opening_balance_keeps_original(self):
        rice = self.item(qty="50")
        original = InventoryMovement.objects.get(movement_type=MovementType.OPENING_BALANCE)
        resp = self.client.post(f"/api/inventory/movements/{original.id}/reversal/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Decimal(resp.data["quantity_change"]), Decimal("-50"))
        self.assertTrue(InventoryMovement.objects.filter(id=original.id).exists())
        self.assertEqual(self.balance(rice), Decimal("0"))
        # Undo only once; an undo cannot be undone.
        self.assertEqual(self.client.post(f"/api/inventory/movements/{original.id}/reversal/").status_code, 400)
        undo_id = resp.data["id"]
        self.assertEqual(self.client.post(f"/api/inventory/movements/{undo_id}/reversal/").status_code, 400)
        self.assert_ledger_matches()

    def test_undo_one_side_of_move_undoes_both(self):
        rice = self.item(qty="10")
        self.client.post("/api/inventory/transfers/", {
            "from_location": self.kitchen.id, "to_location": self.bar.id, "complete": True,
            "lines": [{"item_id": rice.id, "quantity": "4"}],
        }, format="json")
        moved_in = InventoryMovement.objects.get(movement_type=MovementType.TRANSFER_IN)
        self.assertEqual(self.client.post(f"/api/inventory/movements/{moved_in.id}/reversal/").status_code, 200)
        self.assertEqual(self.balance(rice), Decimal("10"))
        self.assertEqual(self.balance(rice, self.bar), Decimal("0"))
        self.assert_ledger_matches()

    def test_failed_undo_is_400_and_changes_nothing(self):
        rice = self.item(qty="10")
        opening = InventoryMovement.objects.get()
        InventoryMovementService.record_waste(merchant=self.merchant, item=rice, location=self.kitchen,
                                              quantity=Decimal("8"), reason="SPOILED")
        resp = self.client.post(f"/api/inventory/movements/{opening.id}/reversal/")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.balance(rice), Decimal("2"))

    def test_move_stock_with_too_little_leaves_nothing_behind(self):
        rice = self.item(qty="3")
        resp = self.client.post("/api/inventory/transfers/", {
            "from_location": self.kitchen.id, "to_location": self.bar.id, "complete": True,
            "lines": [{"item_id": rice.id, "quantity": "5"}],
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(InventoryTransfer.objects.count(), 0)
        self.assertEqual(self.balance(rice), Decimal("3"))

    def test_correction_approval_workflow(self):
        settings_obj = self.merchant.inventory_settings
        settings_obj.require_adjustment_approval = True
        settings_obj.save()
        milk = self.item("Milk", unit=self.litre, qty="12")
        staff = self.staff(self.manager)
        resp = staff.post("/api/inventory/adjustments/", {
            "inventory_item": milk.id, "location": self.kitchen.id, "quantity_delta": "-2",
            "reason": "Data entry mistake",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["status"], AdjustmentStatus.PENDING)
        self.assertEqual(self.balance(milk), Decimal("12"), "Pending correction must not change stock")
        pending_id = resp.data["id"]
        self.assertEqual(staff.post(f"/api/inventory/adjustments/{pending_id}/approve/").status_code, 403)
        resp = self.client.post(f"/api/inventory/adjustments/{pending_id}/approve/")
        self.assertEqual(resp.data["status"], AdjustmentStatus.APPROVED)
        self.assertEqual(self.balance(milk), Decimal("10"))
        # Approving twice never applies twice.
        self.client.post(f"/api/inventory/adjustments/{pending_id}/approve/")
        self.assertEqual(self.balance(milk), Decimal("10"))
        # Owner corrections apply immediately; rejected ones never apply.
        other = staff.post("/api/inventory/adjustments/", {
            "inventory_item": milk.id, "location": self.kitchen.id, "quantity_delta": "5", "reason": "x",
        }, format="json").data
        self.client.post(f"/api/inventory/adjustments/{other['id']}/reject/")
        self.assertEqual(InventoryAdjustment.objects.get(id=other["id"]).status, AdjustmentStatus.REJECTED)
        self.assertEqual(self.balance(milk), Decimal("10"))
        self.assert_ledger_matches()

    def test_delivery_is_idempotent_and_numbered_safely(self):
        rice = self.item(purchase_unit_label="Sack", purchase_unit_conversion=Decimal("25"))
        payload = {"location": self.kitchen.id, "idempotency_key": "rcv-1",
                   "lines": [{"item_id": rice.id, "quantity": "2"}]}
        first = self.client.post("/api/inventory/receiving/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["results"][0]["added"], "50.000000")
        self.assertEqual(first.data["results"][0]["new_stock"], "50.000000")
        self.client.post("/api/inventory/receiving/", payload, format="json")
        self.assertEqual(InventoryReceiving.objects.count(), 1)
        self.assertEqual(self.balance(rice), Decimal("50"))
        second = self.client.post("/api/inventory/receiving/", {
            "location": self.kitchen.id, "lines": [{"item_id": rice.id, "quantity": "5",
                                                    "purchase_unit_conversion": None}],
        }, format="json")
        self.assertEqual(self.balance(rice), Decimal("55"), "Explicit counted units must not use pack size")
        self.assertEqual(first.data["receipt_number"], "RCV-0001")
        self.assertEqual(second.data["receipt_number"], "RCV-0002")

    def test_duplicate_item_name_is_caught(self):
        self.item("Chicken Breast")
        resp = self.client.post("/api/inventory/items/", {
            "name": "chicken breast", "item_type": "INGREDIENT", "base_unit": self.kg.id,
        }, format="json")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data["code"], "duplicate_name")

    def test_opening_quantity_without_location_is_refused(self):
        resp = self.client.post("/api/inventory/items/", {
            "name": "Beans", "item_type": "INGREDIENT", "base_unit": self.kg.id, "opening_quantity": "4",
        }, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_delete_item_rules(self):
        fresh = self.item("Typo Item")
        self.assertEqual(self.client.delete(f"/api/inventory/items/{fresh.id}/").data["result"], "deleted")
        self.assertFalse(InventoryItem.objects.filter(id=fresh.id).exists())

        stocked = self.item("Duplicate Rice", qty="20")
        resp = self.client.delete(f"/api/inventory/items/{stocked.id}/")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data["code"], "stock_remaining")
        resp = self.client.delete(f"/api/inventory/items/{stocked.id}/?clear_stock=1")
        self.assertEqual(resp.data["result"], "archived")
        stocked.refresh_from_db()
        self.assertTrue(stocked.archived)
        self.assertEqual(self.balance(stocked), Decimal("0"))
        self.assertTrue(InventoryMovement.objects.filter(
            inventory_item=stocked, movement_type=MovementType.MANUAL_ADJUSTMENT).exists())
        self.assertTrue(InventoryMovement.objects.filter(
            inventory_item=stocked, movement_type=MovementType.OPENING_BALANCE).exists())
        self.assert_ledger_matches()

    def test_edit_item_cannot_change_quantity_or_unit_after_history(self):
        rice = self.item(qty="5")
        resp = self.client.patch(f"/api/inventory/items/{rice.id}/", {
            "name": "Jasmine Rice", "reorder_point": "2", "total_stock": "999", "base_unit": self.g.id,
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        resp = self.client.patch(f"/api/inventory/items/{rice.id}/", {
            "name": "Jasmine Rice", "reorder_point": "2", "total_stock": "999",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["name"], "Jasmine Rice")
        self.assertEqual(self.balance(rice), Decimal("5"))

    def test_location_count_only_lists_items_kept_there(self):
        self.item("Kitchen Rice", qty="5")
        self.item("Bar Lime", location=self.bar, qty="5")
        count = self.client.post("/api/inventory/counts/", {"name": "Kitchen", "location": self.kitchen.id},
                                 format="json").data
        self.assertEqual([l["item_name"] for l in count["lines"]], ["Kitchen Rice"])
        self.assertEqual(count["status"], CountStatus.IN_PROGRESS)


# ─────────────────────────────────────────────────────────────────────────────
# CSV import
# ─────────────────────────────────────────────────────────────────────────────


def csv_file(rows, name="inventory.csv"):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(row)
    return SimpleUploadedFile(name, buffer.getvalue().encode("utf-8"), content_type="text/csv")


class CsvImportTests(Base):
    HEADER = ["item_name", "item_type", "category", "unit", "location", "opening_quantity",
              "opening_unit_cost", "sku", "barcode", "keep_around", "warn_me_below"]

    def upload(self, rows, mode="NEW_ITEMS", header=None, **extra):
        resp = self.client.post("/api/inventory/import/", {
            "file": csv_file([header or self.HEADER] + rows), "mode": mode, **extra,
        }, format="multipart")
        return resp

    def by_name(self, data):
        return {r["name"]: r for r in data["rows"]}

    def test_upload_validates_without_changing_anything(self):
        resp = self.upload([
            ["Chicken Breast", "Food", "Meat & Poultry", "kg", "Main Kitchen", "18", "480", "CHK-1", "", "25", "10"],
            ["Milk", "Drink", "Dairy & Eggs", "L", "Bar", "10", "", "", "", "", ""],
            ["Cooking Oil", "Food", "", "tin", "Main Kitchen", "5", "", "", "", "", ""],
            ["Paper Cups", "Packaging", "", "piece", "Counter 2", "100", "", "", "", "", ""],
            ["Rice", "Food", "", "kg", "Dry Storage", "-3", "", "", "", "", ""],
            ["Sugar", "Food", "", "kg", "Dry Storage", "2", "abc", "", "", "", ""],
            ["Salt", "Food", "", "", "Dry Storage", "2", "", "", "", "", ""],
        ])
        self.assertEqual(resp.status_code, 201, resp.data)
        rows = self.by_name(resp.data)
        self.assertEqual(rows["Chicken Breast"]["status"], "ready")
        self.assertEqual(rows["Milk"]["status"], "ready")
        self.assertEqual(rows["Cooking Oil"]["status"], "error")
        self.assertIn("tin", rows["Cooking Oil"]["messages"][0]["text"])
        self.assertEqual(rows["Paper Cups"]["status"], "warning")
        self.assertEqual(rows["Rice"]["status"], "error")
        self.assertEqual(rows["Sugar"]["status"], "error")
        self.assertEqual(rows["Salt"]["status"], "error")
        self.assertEqual(resp.data["summary"]["importable"], 3)
        self.assertEqual(InventoryItem.objects.filter(merchant=self.merchant).count(), 0)
        self.assertEqual(InventoryMovement.objects.count(), 0)

    def test_commit_creates_items_with_opening_balance_movements(self):
        session = self.upload([
            ["Chicken Breast", "Food", "Meat & Poultry", "kg", "Main Kitchen", "18", "480", "CHK-1", "", "25", "10"],
            ["चिया पत्ती", "Food", "Coffee & Tea", "kg", "Dry Storage", "2.5", "", "", "", "", ""],
            ["Rice", "Food", "", "kg", "Dry Storage", "-3", "", "", "", "", ""],
        ]).data
        resp = self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], "COMPLETED")
        self.assertEqual(resp.data["rows_imported"], 2)
        self.assertEqual(resp.data["rows_failed"], 1)
        self.assertEqual(resp.data["summary"]["result"]["opening"], 2)
        chicken = InventoryItem.objects.get(merchant=self.merchant, name="Chicken Breast")
        self.assertEqual(chicken.sku, "CHK-1")
        self.assertEqual(chicken.reorder_point, Decimal("10"))
        self.assertEqual(self.balance(chicken), Decimal("18"))
        tea = InventoryItem.objects.get(merchant=self.merchant, name="चिया पत्ती")
        self.assertEqual(self.balance(tea, self.dry), Decimal("2.5"))
        self.assertEqual(
            InventoryMovement.objects.filter(movement_type=MovementType.OPENING_BALANCE).count(), 2
        )
        self.assert_ledger_matches()
        # Committing again is a no-op.
        self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json")
        self.assertEqual(InventoryMovement.objects.count(), 2)
        # Result CSV is available; raw rows are not kept.
        report = self.client.get(f"/api/inventory/import/{session['id']}/report.csv")
        self.assertIn(b"imported", report.content)
        stored = InventoryImportSession.objects.get(id=session["id"])
        self.assertNotIn("raw", stored.rows[0])

    def test_duplicate_sku_and_barcode_detected(self):
        self.item("Existing", sku="DUP-1", barcode="111")
        rows = self.by_name(self.upload([
            ["Thing A", "", "", "kg", "", "", "", "DUP-1", "", "", ""],
            ["Thing B", "", "", "kg", "", "", "", "NEW-1", "111", "", ""],
            ["Thing C", "", "", "kg", "", "", "", "NEW-2", "", "", ""],
            ["Thing D", "", "", "kg", "", "", "", "NEW-2", "", "", ""],
        ]).data)
        self.assertEqual(rows["Thing A"]["action"], "skip")  # matched existing by SKU
        self.assertIn("already exists", rows["Thing A"]["messages"][0]["text"])
        self.assertEqual(rows["Thing B"]["status"], "skip")  # matched by barcode
        self.assertEqual(rows["Thing C"]["status"], "ready")
        self.assertEqual(rows["Thing D"]["status"], "error")

    def test_possible_name_match_needs_a_choice(self):
        self.item("Chicken Breast", qty="5")
        session = self.upload([["chicken  breast", "", "", "kg", "", "20", "", "", "", "12", ""]]).data
        row = session["rows"][0]
        self.assertEqual(row["action"], "skip")
        self.assertEqual(row["choices"], ["update", "create"])
        reviewed = self.client.post(f"/api/inventory/import/{session['id']}/review/",
                                    {"decisions": {str(row["row"]): {"action": "update"}}}, format="json").data
        self.assertEqual(reviewed["rows"][0]["action"], "update")
        self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json")
        item = InventoryItem.objects.get(merchant=self.merchant, name="Chicken Breast")
        self.assertEqual(item.par_level, Decimal("12"))
        self.assertEqual(self.balance(item), Decimal("5"), "Existing stock must never be overwritten")
        self.assertEqual(InventoryItem.objects.filter(merchant=self.merchant).count(), 1)

    def test_update_mode_never_changes_quantity(self):
        rice = self.item("Rice", qty="30", sku="R1")
        session = self.upload(
            [["", "R1", "Rice Sona", "5", "99"]],
            mode="UPDATE_ITEMS", header=["item_name", "sku", "category", "warn_me_below", "quantity"],
        ).data
        row = session["rows"][0]
        self.assertEqual(row["action"], "update")
        self.assertTrue(any("not changed" in m["text"] for m in row["messages"]))
        self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json")
        rice.refresh_from_db()
        self.assertEqual(rice.reorder_point, Decimal("5"))
        self.assertEqual(rice.category.name, "Rice Sona")
        self.assertEqual(self.balance(rice), Decimal("30"))

    def test_stock_count_import_creates_draft_then_reconciles_on_approval(self):
        flour = self.item("Flour", qty="70", sku="FL")
        session = self.upload(
            [["Flour", "FL", "Main Kitchen", "43", "kg"]],
            mode="STOCK_COUNT", header=["item_name", "sku", "location", "counted_quantity", "unit"],
        ).data
        row = session["rows"][0]
        self.assertEqual(row["values"]["system_says"], "70.000000")
        self.assertEqual(row["values"]["difference"], "-27.000000")
        result = self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json").data
        self.assertEqual(self.balance(flour), Decimal("70"), "Import alone must not change stock")
        count = StockCount.objects.get(id=result["stock_count"])
        self.assertEqual(count.status, CountStatus.IN_PROGRESS)
        StockCountService.submit(count=count, merchant=self.merchant, submitted_by=self.owner)
        StockCountService.approve(count=count, merchant=self.merchant, approved_by=self.owner)
        self.assertEqual(self.balance(flour), Decimal("43"), "Final must be 43, never 16")
        movement = InventoryMovement.objects.get(movement_type=MovementType.COUNT_RECONCILIATION)
        self.assertEqual(movement.quantity_change, Decimal("-27"))
        self.assertFalse(InventoryMovement.objects.filter(movement_type=MovementType.EXPLICIT_WASTE).exists())
        self.assert_ledger_matches()

    def test_count_import_converts_units_and_rejects_cross_kind(self):
        self.item("Flour", qty="10")
        self.item("Milk", unit=self.litre, qty="10")
        session = self.upload(
            [["Flour", "Main Kitchen", "2500", "g"], ["Milk", "Main Kitchen", "3", "kg"]],
            mode="STOCK_COUNT", header=["item_name", "location", "counted_quantity", "unit"],
        ).data
        rows = self.by_name(session)
        self.assertEqual(rows["Flour"]["values"]["counted"], "2.5")
        self.assertEqual(rows["Milk"]["status"], "error")

    def test_missing_name_column_reports_errors(self):
        rows = self.upload([["kg", "5"]], header=["unit", "opening_quantity"]).data["rows"]
        self.assertEqual(rows[0]["status"], "error")

    def test_duplicate_upload_is_detected(self):
        rows = [["Salt", "", "", "kg", "", "", "", "", "", "", ""]]
        first = self.upload(rows).data
        self.client.post(f"/api/inventory/import/{first['id']}/commit/", format="json")
        again = self.upload(rows).data
        self.assertEqual(again["duplicate_of"]["id"], first["id"])
        resp = self.client.post(f"/api/inventory/import/{again['id']}/commit/", format="json")
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data["code"], "duplicate_import")
        resp = self.client.post(f"/api/inventory/import/{again['id']}/commit/", {"allow_duplicate": True},
                                format="json")
        self.assertEqual(resp.status_code, 200)

    def test_file_type_and_size_guards(self):
        png = SimpleUploadedFile("stock.csv", b"\x89PNG\r\n\x1a\n\x00\x00\x00", content_type="text/csv")
        resp = self.client.post("/api/inventory/import/", {"file": png, "mode": "NEW_ITEMS"}, format="multipart")
        self.assertEqual(resp.status_code, 400)
        xlsx = SimpleUploadedFile("stock.csv", b"PK\x03\x04rest", content_type="text/csv")
        resp = self.client.post("/api/inventory/import/", {"file": xlsx, "mode": "NEW_ITEMS"}, format="multipart")
        self.assertIn("Excel", resp.data["detail"])
        with mock.patch.object(importing, "MAX_ROWS", 3):
            resp = self.upload([["A", "", "", "kg"] + [""] * 7] * 5)
        self.assertEqual(resp.status_code, 400)
        with mock.patch.object(importing, "MAX_CSV_BYTES", 10):
            resp = self.upload([["A", "", "", "kg"] + [""] * 7])
        self.assertEqual(resp.status_code, 400)

    def test_template_download(self):
        resp = self.client.get("/api/inventory/import/template/")
        self.assertIn("zentro_inventory_template.csv", resp["Content-Disposition"])
        lines = resp.content.decode("utf-8-sig").strip().splitlines()
        self.assertEqual(len(lines), 1, "Template must be header-only")
        self.assertTrue(lines[0].startswith("item_name,item_type,category,unit,location"))
        example = self.client.get("/api/inventory/import/template/?example=1")
        self.assertIn("zentro_inventory_example.csv", example["Content-Disposition"])
        self.assertGreater(len(example.content.decode("utf-8-sig").strip().splitlines()), 2)

    def test_exported_stock_csv_reimports_as_count(self):
        self.item("Oats", qty="12.5", sku="OAT")
        body = b"".join(self.client.get("/api/inventory/exports/current-stock.csv").streaming_content)
        text = body.decode("utf-8-sig")
        self.assertIn("12.5", text)
        self.assertNotIn("12.500000", text)


# ─────────────────────────────────────────────────────────────────────────────
# PDF import
# ─────────────────────────────────────────────────────────────────────────────


def text_pdf(lines):
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line)
        y += 18
    data = doc.tobytes()
    doc.close()
    return data


class PdfImportTests(Base):
    def upload(self, data, name="stock.pdf", mode="STOCK_COUNT"):
        return self.client.post("/api/inventory/import/", {
            "file": SimpleUploadedFile(name, data, content_type="application/pdf"), "mode": mode,
            "location": self.kitchen.id,
        }, format="multipart")

    def test_text_pdf_needs_confirmation_and_never_writes_stock(self):
        chicken = self.item("Chicken Breast", qty="20")
        resp = self.upload(text_pdf(["Stock sheet", "Chicken Breast 18 kg", "Mystery thing 12x?"]))
        self.assertEqual(resp.status_code, 201, resp.data)
        rows = {r["name"]: r for r in resp.data["rows"]}
        self.assertTrue(rows["Chicken Breast"]["needs_review"])
        self.assertFalse(rows["Chicken Breast"]["importable"])
        # Committing without confirming imports nothing.
        result = self.client.post(f"/api/inventory/import/{resp.data['id']}/commit/", format="json").data
        self.assertEqual(result["rows_imported"], 0)
        self.assertIsNone(result["stock_count"])
        self.assertEqual(self.balance(chicken), Decimal("20"))

    def test_confirmed_pdf_rows_become_count_draft(self):
        chicken = self.item("Chicken Breast", qty="20")
        session = self.upload(text_pdf(["Chicken Breast 18 kg"])).data
        row = session["rows"][0]
        self.client.post(f"/api/inventory/import/{session['id']}/review/",
                         {"decisions": {str(row["row"]): {"confirm": True, "fix": {"quantity": "17"}}}},
                         format="json")
        result = self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json").data
        self.assertEqual(result["rows_imported"], 1)
        line = StockCountLine.objects.get(stock_count_id=result["stock_count"])
        self.assertEqual(line.physical_quantity, Decimal("17"))
        self.assertEqual(line.book_quantity, Decimal("20"))
        self.assertEqual(self.balance(chicken), Decimal("20"))

    def test_new_items_from_pdf_opening_only_after_confirmation(self):
        session = self.upload(text_pdf(["Basmati Rice 25 kg"]), mode="NEW_ITEMS").data
        row = session["rows"][0]
        self.client.post(f"/api/inventory/import/{session['id']}/review/",
                         {"decisions": {str(row["row"]): {"confirm": True}}}, format="json")
        self.client.post(f"/api/inventory/import/{session['id']}/commit/", format="json")
        rice = InventoryItem.objects.get(merchant=self.merchant, name="Basmati Rice")
        self.assertEqual(self.balance(rice), Decimal("25"))
        self.assert_ledger_matches()

    def test_scanned_pdf_without_ai_gives_friendly_error(self):
        doc = pymupdf.open()
        doc.new_page()
        data = doc.tobytes()
        from merchants.ai.gemini_scanner import MenuScanError

        with mock.patch("merchants.ai.gemini_scanner.extract_menu",
                        side_effect=MenuScanError("not configured", status_code=503)):
            resp = self.upload(data)
        self.assertEqual(resp.status_code, 400)
        self.assertIn("scan", resp.data["detail"])

    def test_ai_extraction_confidence_is_kept(self):
        doc = pymupdf.open()
        doc.new_page()
        payload = '{"items": [{"name": "Chicken Breast", "quantity": 70, "unit": "kg", ' \
                  '"confidence": "low", "original_text": "10 kg ?"}]}'
        self.item("Chicken Breast", qty="20")
        with mock.patch("merchants.ai.gemini_scanner.extract_menu", return_value=(payload, False, "m")):
            resp = self.upload(doc.tobytes())
        row = resp.data["rows"][0]
        self.assertEqual(row["confidence"], "low")
        self.assertEqual(row["original_text"], "10 kg ?")
        self.assertTrue(row["needs_review"])

    def test_wrong_type_and_oversized(self):
        resp = self.upload(b"\x89PNG\r\n\x1a\nnot a pdf", name="stock.pdf")
        self.assertEqual(resp.status_code, 400)
        resp = self.upload(b"%PDF-1.4 broken", name="stock.pdf")
        self.assertEqual(resp.status_code, 400)
        with mock.patch.object(importing, "MAX_PDF_BYTES", 10), mock.patch.object(importing, "MAX_CSV_BYTES", 10):
            resp = self.upload(text_pdf(["Rice 5 kg"]))
        self.assertEqual(resp.status_code, 400)


# ─────────────────────────────────────────────────────────────────────────────
# Exports
# ─────────────────────────────────────────────────────────────────────────────


class ExportTests(Base):
    def csv_rows(self, url):
        resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        text = b"".join(resp.streaming_content).decode("utf-8-sig")
        return list(csv.reader(io.StringIO(text))), resp

    def test_stock_csv_columns_and_filename(self):
        self.item("Chicken Breast", qty="18", cost="480", reorder_point=Decimal("10"))
        rows, resp = self.csv_rows("/api/inventory/exports/current-stock.csv")
        self.assertIn("silver-fir-current-stock-", resp["Content-Disposition"])
        header = rows[0]
        for column in ("Item", "Item Type", "Category", "Location", "Current Quantity", "Unit", "Status",
                       "Keep Around", "Warn Me Below", "Very Low Level", "Last Counted", "Last Received",
                       "Average Cost", "Latest Cost", "Stock Value"):
            self.assertIn(column, header)
        record = dict(zip(header, rows[1]))
        self.assertEqual(record["Current Quantity"], "18")
        self.assertEqual(record["Stock Value"], "8640")

    def test_cost_columns_hidden_without_permission(self):
        self.item("Chicken Breast", qty="18", cost="480")
        report = build_report("current-stock", self.merchant, {}, include_cost=False)
        self.assertNotIn("stock_value", [c.key for c in report.visible_columns])
        # A role that may see inventory reports but not costs.
        self.give_role(self.manager, "Stock Lead", ["inventory.view", "inventory.manage", "reports.view"])
        staff = self.staff(self.manager)
        body = b"".join(staff.get("/api/inventory/exports/current-stock.csv").streaming_content)
        self.assertNotIn(b"Stock Value", body)
        self.assertNotIn(b"480", body)
        waste = b"".join(staff.get("/api/inventory/exports/waste.csv").streaming_content)
        self.assertNotIn(b"Cost", waste)
        pdf = staff.get("/api/inventory/exports/full.pdf").content
        doc = pymupdf.open(stream=pdf, filetype="pdf")
        self.assertNotIn("Inventory value", "".join(p.get_text() for p in doc))

    def test_filtered_export(self):
        self.item("Kitchen Rice", qty="5")
        self.item("Bar Lime", location=self.bar, qty="2")
        rows, _ = self.csv_rows(f"/api/inventory/exports/current-stock.csv?location={self.bar.id}")
        self.assertEqual([r[0] for r in rows[1:]], ["Bar Lime"])

    def test_pdfs_render_for_empty_and_large_inventory(self):
        resp = self.client.get("/api/inventory/exports/full.pdf")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.content.startswith(b"%PDF"))
        for i in range(150):
            self.item(f"Item {i} चिकन", qty="1.25")
        resp = self.client.get("/api/inventory/exports/current-stock.pdf")
        doc = pymupdf.open(stream=resp.content, filetype="pdf")
        self.assertGreater(doc.page_count, 1)
        text = doc[1].get_text()
        self.assertIn("Current Stock (continued)", text)
        self.assertIn("Item Type", text, "Table header must repeat on later pages")
        self.assertIn("Page 2 of", text)
        for key in ("low-stock", "waste", "stock-counts", "count-differences", "purchasing", "stock-history"):
            resp = self.client.get(f"/api/inventory/exports/{key}.pdf")
            self.assertEqual(resp.status_code, 200, key)
            self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_csv_formula_injection_neutralised(self):
        self.item("=HYPERLINK(\"x\")", qty="1")
        rows, _ = self.csv_rows("/api/inventory/exports/current-stock.csv")
        self.assertTrue(rows[1][0].startswith("'="))

    def test_unknown_report(self):
        self.assertEqual(self.client.get("/api/inventory/exports/secret.csv").status_code, 404)
        self.assertEqual(self.client.get("/api/inventory/exports/full.csv").status_code, 404)
