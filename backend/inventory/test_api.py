"""
inventory/test_api.py

Endpoint-level tests for /api/inventory/* using the project-wide APIClient
convention (force_authenticate).
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile

from .models import (
    CountStatus,
    InventoryBalance,
    InventoryItem,
    InventoryMovement,
    InventoryWasteRecord,
    Supplier,
    UnitOfMeasure,
)
from .services import seed_default_units, seed_merchant_reference_data


class InventoryApiTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_default_units()
        cls.g = UnitOfMeasure.objects.get(merchant__isnull=True, code="g")

        cls.owner = get_user_model().objects.create_user(
            username="api-owner", email="api-owner@test.com", password="Pass123!", role="merchant"
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner, business_name="API Cafe", slug="api-cafe"
        )
        seed_merchant_reference_data(cls.merchant)

        cls.other_user = get_user_model().objects.create_user(
            username="api-other", email="api-other@test.com", password="Pass123!", role="merchant"
        )
        cls.merchant2 = MerchantProfile.objects.create(
            user=cls.other_user, business_name="Other API", slug="api-other"
        )
        seed_merchant_reference_data(cls.merchant2)

        cls.kitchen = cls.merchant.inventory_locations.get(name="Main Kitchen")
        cls.category = cls.merchant.inventory_categories.get(name="Dry Goods")

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def _create_item(self, **extra):
        payload = {
            "name": "Sugar",
            "item_type": "INGREDIENT",
            "category": self.category.id,
            "default_location": self.kitchen.id,
            "base_unit": self.g.id,
            "par_level": "10000",
            **extra,
        }
        resp = self.client.post("/api/inventory/items/", payload, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data


class InventoryRootTests(InventoryApiTestBase):
    def test_anonymous_is_rejected(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get("/api/inventory/")
        # DRF default auth returns 401 when no credentials are sent.
        self.assertIn(resp.status_code, (401, 403), resp.data)

    def test_root_reports_permissions(self):
        resp = self.client.get("/api/inventory/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("permissions", resp.data)
        self.assertTrue(resp.data["permissions"]["inventory.manage_items"])
        self.assertEqual(resp.data["is_configured"], False)

    def test_movements_endpoint_returns_readable_history_rows(self):
        self.client.post("/api/inventory/items/", {
            "name": "History Rice",
            "item_type": "INGREDIENT",
            "category": self.category.id,
            "default_location": self.kitchen.id,
            "base_unit": self.g.id,
            "opening_quantity": 10,
        }, format="json")

        resp = self.client.get("/api/inventory/movements/")

        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["item"], "History Rice")
        self.assertEqual(resp.data["results"][0]["location_name"], self.kitchen.name)

    def test_overview_serializes(self):
        resp = self.client.get("/api/inventory/overview/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("inventory_value", resp.data)
        self.assertIn("needs_attention", resp.data)


class ItemApiTests(InventoryApiTestBase):
    def test_create_item_with_opening_stock(self):
        item = self._create_item(par_level=None, opening_quantity="70000", opening_unit_cost="0.05")
        balance = InventoryBalance.objects.get(inventory_item_id=item["id"])
        self.assertEqual(balance.on_hand, Decimal("70000"))
        self.assertEqual(item["status"], "HEALTHY")
        self.assertEqual(item["current_stock"], "70000.000000")

    def test_create_item_low_status_appears_in_low_stock_filter(self):
        item = self._create_item(
            par_level=None, opening_quantity="2000", reorder_point="10000",
            critical_level="1000",
        )
        self.assertEqual(item["status"], "LOW")
        resp = self.client.get("/api/inventory/items/", {"status": "LOW"})
        ids = [r["id"] for r in resp.data["results"]]
        self.assertIn(item["id"], ids)
        resp = self.client.get("/api/inventory/items/", {"status": "OUT"})
        self.assertNotIn(item["id"], [r["id"] for r in resp.data["results"]])

    def test_item_patch_updates_and_audits(self):
        item = self._create_item()
        resp = self.client.patch(
            f"/api/inventory/items/{item['id']}/",
            {"par_level": "5000", "reorder_point": "1000"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["par_level"], "5000.000000")
        resp = self.client.get("/api/inventory/audit/")
        self.assertTrue(any(r["action"] == "item_updated" for r in resp.data["results"]))

    def test_archive_item(self):
        item = self._create_item()
        resp = self.client.post(f"/api/inventory/items/{item['id']}/archive/")
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get("/api/inventory/items/")
        self.assertNotIn(item["id"], [r["id"] for r in resp.data["results"]])


class WasteApiTests(InventoryApiTestBase):
    def test_waste_via_api(self):
        item = self._create_item(opening_quantity="1000")
        resp = self.client.post(
            "/api/inventory/waste/",
            {
                "inventory_item": item["id"],
                "location": self.kitchen.id,
                "quantity": "100",
                "reason": "SPOILED",
                "idempotency_key": "waste-abc-1",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        balance = InventoryBalance.objects.get(inventory_item_id=item["id"])
        self.assertEqual(balance.on_hand, Decimal("900"))

        # Idempotent retry → no new movement.
        InventoryMovement.objects.count()
        self.client.post(
            "/api/inventory/waste/",
            {
                "inventory_item": item["id"],
                "location": self.kitchen.id,
                "quantity": "100",
                "reason": "SPOILED",
                "idempotency_key": "waste-abc-1",
            },
            format="json",
        )
        self.assertEqual(InventoryMovement.objects.filter(movement_type="EXPLICIT_WASTE").count(), 1)
        self.assertEqual(InventoryWasteRecord.objects.count(), 2)

    def test_waste_query_total(self):
        item = self._create_item(opening_quantity="1000")
        self.client.post("/api/inventory/waste/", {
            "inventory_item": item["id"], "location": self.kitchen.id,
            "quantity": "10", "reason": "DROPPED",
        }, format="json")
        self.client.post("/api/inventory/waste/", {
            "inventory_item": item["id"], "location": self.kitchen.id,
            "quantity": "20", "reason": "SPOILED",
        }, format="json")
        resp = self.client.get("/api/inventory/waste/")
        self.assertEqual(resp.data["waste_total"], Decimal("30"))
        self.assertEqual(len(resp.data["results"]), 2)


class ReceivingApiTests(InventoryApiTestBase):
    def test_receiving_via_api(self):
        supplier = Supplier.objects.create(merchant=self.merchant, name="Sugar Supplier")
        item = self._create_item(purchase_unit_label="25kg sack", purchase_unit_conversion="25000")
        resp = self.client.post("/api/inventory/receiving/", {
            "location": self.kitchen.id,
            "supplier": supplier.id,
            "lines": [
                {"item_id": item["id"], "quantity": "2", "unit_cost": "1500",
                 "purchase_unit_label": "25kg sack", "purchase_unit_conversion": "25000"},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["lines"][0]["base_quantity"], "50000.000000")
        balance = InventoryBalance.objects.get(inventory_item_id=item["id"])
        self.assertEqual(balance.on_hand, Decimal("50000"))
        self.assertEqual(balance.avg_cost, Decimal("0.06"))

        detail = self.client.get(f"/api/inventory/receiving/{resp.data['id']}/")
        self.assertEqual(detail.status_code, 200)


class StockCountApiTests(InventoryApiTestBase):
    def _setup(self, qty="1000"):
        item = self._create_item(opening_quantity=qty)
        resp = self.client.post("/api/inventory/counts/", {
            "name": "Daily count", "location": self.kitchen.id,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return item, resp.data["id"]

    def _count_flow(self, count_id, item_id, physical):
        detail = self.client.get(f"/api/inventory/counts/{count_id}/")
        line = [l for l in detail.data["lines"] if l["inventory_item"] == item_id][0]
        resp = self.client.post(
            f"/api/inventory/counts/{count_id}/lines/",
            {"line_id": line["id"], "physical_quantity": physical},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        return line

    def test_count_approve_flow(self):
        item, count_id = self._setup(qty="70000")
        self._count_flow(count_id, item["id"], "43000")
        resp = self.client.post(f"/api/inventory/counts/{count_id}/submit/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], CountStatus.SUBMITTED)
        resp = self.client.post(f"/api/inventory/counts/{count_id}/approve/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], CountStatus.APPROVED)
        balance = InventoryBalance.objects.get(inventory_item_id=item["id"])
        self.assertEqual(balance.on_hand, Decimal("43000"))

    def test_count_auto_approves_when_approval_off(self):
        settings = self.merchant.inventory_settings
        settings.require_count_approval = False
        settings.save()
        item, count_id = self._setup(qty="1000")
        self._count_flow(count_id, item["id"], "900")
        resp = self.client.post(f"/api/inventory/counts/{count_id}/submit/")
        self.assertEqual(resp.data["status"], CountStatus.APPROVED)
        balance = InventoryBalance.objects.get(inventory_item_id=item["id"])
        self.assertEqual(balance.on_hand, Decimal("900"))

    def test_edit_blocked_after_submit(self):
        item, count_id = self._setup()
        line = self._count_flow(count_id, item["id"], "800")
        self.client.post(f"/api/inventory/counts/{count_id}/submit/")
        resp = self.client.post(
            f"/api/inventory/counts/{count_id}/lines/",
            {"line_id": line["id"], "physical_quantity": "999"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_cancel_count(self):
        item, count_id = self._setup()
        self._count_flow(count_id, item["id"], "800")
        resp = self.client.post(f"/api/inventory/counts/{count_id}/cancel/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["status"], CountStatus.CANCELLED)


class TenantApiTests(InventoryApiTestBase):
    def test_other_merchant_items_invisible(self):
        other_cat = self.merchant2.inventory_categories.get(name="Dry Goods")
        other_loc = self.merchant2.inventory_locations.get(name="Main Kitchen")
        InventoryItem.objects.create(
            merchant=self.merchant2, name="Hidden Item", item_type="INGREDIENT",
            category=other_cat, base_unit=self.g, default_location=other_loc,
        )
        resp = self.client.get("/api/inventory/items/")
        names = [r["name"] for r in resp.data["results"]]
        self.assertNotIn("Hidden Item", names)

    def test_cross_merchant_supplier_rejected(self):
        other_supplier = Supplier.objects.create(merchant=self.merchant2, name="Them")
        item = self._create_item()
        resp = self.client.post("/api/inventory/receiving/", {
            "location": self.kitchen.id, "supplier": other_supplier.id,
            "lines": [{"item_id": item["id"], "quantity": "5"}],
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.data)


class SettingsApiTests(InventoryApiTestBase):
    def test_settings_get_patch(self):
        resp = self.client.get("/api/inventory/settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data["require_count_approval"])
        resp = self.client.patch(
            "/api/inventory/settings/",
            {"require_count_approval": False, "prevent_negative_stock": False},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["require_count_approval"])
        self.assertFalse(resp.data["prevent_negative_stock"])