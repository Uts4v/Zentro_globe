"""
Table areas and simple RBAC.

Run with: python manage.py test pos.test_rbac_and_areas

  TABLE AREA = where customers sit.   ROLE = what the employee can do.
  EMPLOYEE AREA = which tables they handle.

Covers: areas and bulk tables, QR stability, safe deactivation, the existing
table migration, default roles, custom roles, staff-mode enforcement on the
server (not just hidden buttons), area restriction, prompt role changes,
no privilege escalation, legacy mapping, audit logging and tenant isolation.
"""

import importlib

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MenuItem, MerchantProfile, MerchantTable, TableArea
from orders.models import Order

from . import rbac
from .models import PosAuditLog, ShiftWorker, StaffPreparationArea, StaffRole


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="rbac-owner", email="rbac-owner@test.com", password="Owner123!", role="merchant",
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner, business_name="ABC Restaurant", slug="abc-restaurant",
            is_approved=True, is_open=True, pos_enabled=True, table_ordering_enabled=True,
        )
        cls.other_owner = User.objects.create_user(
            username="rbac-other", email="rbac-other@test.com", password="Other123!", role="merchant",
        )
        cls.other = MerchantProfile.objects.create(
            user=cls.other_owner, business_name="Other Cafe", slug="other-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        cls.roles = rbac.ensure_default_roles(cls.merchant)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.other_client = APIClient()
        self.other_client.force_authenticate(self.other_owner)

    # helpers
    def area(self, name="Bar", count=6, prefix="B", seats=4, start=1):
        resp = self.client.post("/api/merchants/table-areas/", {
            "name": name, "table_count": count, "prefix": prefix, "start_number": start, "seats": seats,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def employee(self, name, role_key=None, role=None, areas=(), pin="1234"):
        role = role or self.roles[role_key]
        resp = self.client.post("/api/pos/workers/team/", {
            "display_name": name, "pin": pin, "staff_role": role.id, "area_ids": list(areas),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return ShiftWorker.objects.get(id=resp.data["id"])

    def as_staff(self, worker, pin="1234"):
        resp = self.client.post("/api/pos/staff/session/", {"worker_id": str(worker.id), "pin": pin}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        client = APIClient()
        client.force_authenticate(self.owner)
        client.credentials(HTTP_X_ZENTRO_STAFF=resp.data["token"])
        return client

    def custom_role(self, name, codes):
        resp = self.client.post("/api/pos/roles/", {"name": name, "permissions": codes}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return StaffRole.objects.get(id=resp.data["id"])


# ─────────────────────────────────────────────────────────────────────────────
# Table areas
# ─────────────────────────────────────────────────────────────────────────────


class TableAreaTests(Base):
    def test_create_area_with_bulk_tables(self):
        area = self.area("Bar", count=6, prefix="B", seats=4)
        self.assertEqual(area["table_count"], 6)
        self.assertEqual([t["name"] for t in area["tables"]], ["B1", "B2", "B3", "B4", "B5", "B6"])
        self.assertTrue(all(t["seats"] == 4 for t in area["tables"]))
        self.assertEqual(len({t["table_number"] for t in area["tables"]}), 6)
        self.assertEqual(len({t["public_token"] for t in area["tables"]}), 6)

    def test_bulk_with_starting_number_and_adding_more(self):
        hall = self.area("Conference Hall", count=3, prefix="C", seats=8, start=5)
        self.assertEqual([t["name"] for t in hall["tables"]], ["C5", "C6", "C7"])
        resp = self.client.post(f"/api/merchants/table-areas/{hall['id']}/tables/", {
            "table_count": 2, "prefix": "C", "start_number": 8, "seats": 8,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual([t["name"] for t in resp.data], ["C8", "C9"])
        # Clashing names are refused, nothing half-created.
        resp = self.client.post(f"/api/merchants/table-areas/{hall['id']}/tables/", {
            "table_count": 3, "prefix": "C", "start_number": 9, "seats": 8,
        }, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(MerchantTable.objects.filter(merchant=self.merchant).count(), 5)

    def test_validation(self):
        self.area("Bar", count=1)
        dup = self.client.post("/api/merchants/table-areas/", {"name": "bar"}, format="json")
        self.assertEqual(dup.status_code, 400)
        too_many = self.client.post("/api/merchants/table-areas/", {
            "name": "Huge", "table_count": 500, "prefix": "H",
        }, format="json")
        self.assertEqual(too_many.status_code, 400)
        no_prefix = self.client.post("/api/merchants/table-areas/", {"name": "X", "table_count": 2}, format="json")
        self.assertEqual(no_prefix.status_code, 400)
        empty = self.client.post("/api/merchants/table-areas/", {"name": "Garden"}, format="json")
        self.assertEqual(empty.status_code, 201)
        self.assertEqual(empty.data["table_count"], 0)

    def test_qr_token_survives_rename_move_and_area_rename(self):
        bar = self.area("Bar", count=3, prefix="B")
        roof = self.area("Rooftop", count=0)
        table = bar["tables"][1]
        token = table["public_token"]

        moved = self.client.patch(f"/api/merchants/tables/{table['id']}/", {"area": roof["id"]}, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.data["area_name"], "Rooftop")
        self.assertEqual(moved.data["public_token"], token)

        renamed = self.client.patch(f"/api/merchants/tables/{table['id']}/", {"name": "R1", "seats": 6}, format="json")
        self.assertEqual(renamed.data["public_token"], token)
        self.assertEqual(renamed.data["seats"], 6)

        self.client.patch(f"/api/merchants/table-areas/{roof['id']}/", {"name": "Sky Deck"}, format="json")
        self.assertEqual(MerchantTable.objects.get(id=table["id"]).public_token, token)

        # The table QR route still resolves the moved, renamed table.
        public = APIClient().get(f"/api/merchants/public/{self.merchant.slug}/tables/{token}/")
        self.assertEqual(public.status_code, 200)
        self.assertEqual(public.data["table"]["name"], "R1")
        self.assertTrue(PosAuditLog.objects.filter(merchant=self.merchant, action="table_move").exists())

    def test_history_survives_a_move(self):
        bar = self.area("Bar", count=1, prefix="B")
        roof = self.area("Rooftop", count=0)
        table = MerchantTable.objects.get(id=bar["tables"][0]["id"])
        order = Order.objects.create(
            merchant=self.merchant, table=table, table_name_snapshot=table.name,
            status=Order.STATUS_COMPLETED, total_amount=100,
        )
        self.client.patch(f"/api/merchants/tables/{table.id}/", {"area": roof["id"]}, format="json")
        order.refresh_from_db()
        self.assertEqual(order.table_id, table.id)
        self.assertEqual(order.table_name_snapshot, "B1")
        # A table with history is switched off, never deleted.
        resp = self.client.delete(f"/api/merchants/tables/{table.id}/delete/")
        self.assertEqual(resp.data["result"], "hidden")
        self.assertFalse(MerchantTable.objects.get(id=table.id).is_active)

    def test_area_deactivation_is_safe(self):
        bar = self.area("Bar", count=2, prefix="B")
        url = f"/api/merchants/table-areas/{bar['id']}/"
        self.assertEqual(self.client.patch(url, {"is_active": False}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 400)
        table = MerchantTable.objects.get(id=bar["tables"][0]["id"])
        Order.objects.create(merchant=self.merchant, table=table, status=Order.STATUS_CONFIRMED, total_amount=10)
        blocked = self.client.patch(f"/api/merchants/tables/{table.id}/", {"is_active": False}, format="json")
        self.assertEqual(blocked.status_code, 400)
        Order.objects.update(status=Order.STATUS_COMPLETED)
        for t in bar["tables"]:
            self.client.patch(f"/api/merchants/tables/{t['id']}/", {"is_active": False}, format="json")
        self.assertEqual(self.client.patch(url, {"is_active": False}, format="json").status_code, 200)
        self.assertTrue(TableArea.objects.filter(id=bar["id"]).exists())

    def test_existing_tables_migrate_into_a_default_area(self):
        legacy = [
            MerchantTable.objects.create(merchant=self.merchant, name=f"Table {i}", table_number=i)
            for i in (1, 2, 3)
        ]
        tokens = [t.public_token for t in legacy]
        module = importlib.import_module("merchants.migrations.0028_default_table_area")
        module.assign_default_area(django_apps, None)
        module.assign_default_area(django_apps, None)  # idempotent
        area = TableArea.objects.get(merchant=self.merchant, name="Main Area")
        self.assertEqual(MerchantTable.objects.filter(merchant=self.merchant, area=area).count(), 3)
        self.assertEqual([MerchantTable.objects.get(id=t.id).public_token for t in legacy], tokens)
        self.assertFalse(TableArea.objects.filter(merchant=self.other).exists())

    def test_pos_bootstrap_tables_carry_their_area(self):
        self.area("Bar", count=2, prefix="B", seats=2)
        from .views import _pos_tables

        tables = _pos_tables(self.merchant)
        self.assertEqual({t["area_name"] for t in tables}, {"Bar"})
        self.assertEqual({t["seats"] for t in tables}, {2})

    def test_merchant_isolation(self):
        bar = self.area("Bar", count=1, prefix="B")
        table_id = bar["tables"][0]["id"]
        self.assertEqual(self.other_client.patch(
            f"/api/merchants/table-areas/{bar['id']}/", {"name": "Hacked"}, format="json").status_code, 404)
        self.assertEqual(self.other_client.patch(
            f"/api/merchants/tables/{table_id}/", {"name": "Hacked"}, format="json").status_code, 404)
        self.assertEqual(self.other_client.get("/api/merchants/table-areas/").data["areas"], [])
        # Cannot move own table into another merchant's area.
        theirs = self.other_client.post("/api/merchants/table-areas/", {
            "name": "Theirs", "table_count": 1, "prefix": "X",
        }, format="json").data
        resp = self.client.patch(f"/api/merchants/tables/{table_id}/", {"area": theirs["id"]}, format="json")
        self.assertEqual(resp.status_code, 400)


# ─────────────────────────────────────────────────────────────────────────────
# Roles
# ─────────────────────────────────────────────────────────────────────────────


class RoleTests(Base):
    def test_default_roles_and_catalog(self):
        data = self.client.get("/api/pos/roles/").data
        names = [r["name"] for r in data["roles"]]
        self.assertEqual(set(names), {"Admin", "Manager", "Cashier", "Server", "Kitchen", "Inventory"})
        self.assertEqual(names[0], "Admin")
        admin = data["roles"][0]
        self.assertTrue(admin["is_admin"] and admin["is_system"])
        self.assertEqual(len(admin["permissions"]), len(rbac.ALL_PERMISSIONS))
        self.assertLessEqual(len(rbac.ALL_PERMISSIONS), 25)
        manager = next(r for r in data["roles"] if r["name"] == "Manager")
        self.assertNotIn("roles.manage", manager["permissions"])
        self.assertNotIn("settings.manage", manager["permissions"])
        # Human labels are provided for every permission.
        labels = [p["label"] for g in data["permission_groups"] for p in g["permissions"]]
        self.assertEqual(len(labels), len(rbac.ALL_PERMISSIONS))
        self.assertTrue(all(label and "." not in label for label in labels))

    def test_admin_role_is_protected(self):
        admin = self.roles["admin"]
        self.assertEqual(self.client.patch(
            f"/api/pos/roles/{admin.id}/", {"permissions": []}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"/api/pos/roles/{admin.id}/").status_code, 400)
        self.assertTrue(rbac.worker_can(self.employee("Boss", "admin"), "settings.manage"))
        # Default roles cannot be deleted either, but their permissions can change.
        self.assertEqual(self.client.delete(f"/api/pos/roles/{self.roles['cashier'].id}/").status_code, 400)

    def test_custom_role_senior_cashier(self):
        role = self.custom_role("Senior Cashier", [
            "pos.access", "orders.create", "payments.take", "payments.refund", "reports.view",
        ])
        sita = self.employee("Sita", role=role)
        self.assertTrue(rbac.worker_can(sita, "payments.refund"))
        self.assertTrue(rbac.worker_can(sita, "reports.view"))
        self.assertFalse(rbac.worker_can(sita, "settings.manage"))
        # Legacy flags mirror the role for existing POS clients.
        self.assertTrue(sita.can_process_refund and sita.can_view_reports)
        self.assertFalse(sita.can_apply_discount)
        staff = self.as_staff(sita)
        me = staff.get("/api/pos/staff/me/").data
        self.assertEqual(me["mode"], "staff")
        self.assertEqual(me["role"]["name"], "Senior Cashier")
        self.assertIn("payments.refund", me["permissions"])
        self.assertEqual(staff.get("/api/pos/reports/sales/").status_code, 200)
        self.assertEqual(staff.patch("/api/merchants/me/update/", {"business_name": "X"}, format="json").status_code, 403)
        self.assertTrue(PosAuditLog.objects.filter(merchant=self.merchant, action="role_create").exists())

    def test_clone_and_delete_custom_role(self):
        resp = self.client.post("/api/pos/roles/", {
            "name": "Night Manager", "clone_from": self.roles["manager"].id,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(set(resp.data["permissions"]), set(rbac.role_permissions(self.roles["manager"])))
        hari = self.employee("Hari", role=StaffRole.objects.get(id=resp.data["id"]))
        in_use = self.client.delete(f"/api/pos/roles/{resp.data['id']}/")
        self.assertEqual(in_use.status_code, 400)
        self.client.patch(f"/api/pos/workers/team/{hari.id}/", {"staff_role": self.roles["cashier"].id}, format="json")
        self.assertEqual(self.client.delete(f"/api/pos/roles/{resp.data['id']}/").status_code, 204)

    def test_one_role_per_employee_and_no_overrides(self):
        ram = self.employee("Ram", "server")
        # Old per-employee flags are ignored: permissions come only from the role.
        self.client.patch(f"/api/pos/workers/{ram.id}/update/", {"can_process_refund": True}, format="json")
        ram.refresh_from_db()
        self.assertFalse(ram.can_process_refund)
        self.assertFalse(rbac.worker_can(ram, "payments.refund"))
        self.assertEqual(ram.staff_role, self.roles["server"])

    def test_legacy_workers_keep_exactly_what_they_could_do(self):
        old = ShiftWorker(merchant=self.merchant, display_name="Old Cashier", role="cashier",
                          can_process_refund=True, can_close_shift=True)
        old.set_pin("1234")
        old.save()
        role = rbac.worker_role(old)
        self.assertEqual(role.name, "Cashier + Refunds + Close Shift")
        self.assertTrue(rbac.worker_can(old, "payments.refund"))
        self.assertTrue(rbac.worker_can(old, "shifts.close"))
        self.assertFalse(rbac.worker_can(old, "discounts.apply"))
        plain = ShiftWorker(merchant=self.merchant, display_name="Old Waiter", role="waiter")
        plain.set_pin("1234")
        plain.save()
        self.assertEqual(rbac.worker_role(plain), self.roles["server"])
        _, unmapped = rbac.role_for_legacy_worker(self.merchant, "barista", {})
        self.assertTrue(unmapped, "Unknown old roles must be reported, not guessed silently")

    def test_migration_maps_existing_workers(self):
        from orders.models import PreparationArea

        ShiftWorker.objects.all().delete()
        StaffRole.objects.all().delete()
        cook = ShiftWorker(merchant=self.merchant, display_name="Cook", role="cashier")
        cook.set_pin("1234")
        cook.save()
        station = PreparationArea.objects.create(merchant=self.merchant, name="Main Kitchen")
        StaffPreparationArea.objects.create(worker=cook, preparation_area=station)
        boss = ShiftWorker(merchant=self.merchant, display_name="Boss", role="manager",
                           can_apply_discount=True, can_process_refund=True,
                           can_close_shift=True, can_view_reports=True)
        boss.set_pin("1234")
        boss.save()
        module = importlib.import_module("pos.migrations.0012_seed_roles_for_existing_workers")
        module.seed(django_apps, None)
        cook.refresh_from_db()
        boss.refresh_from_db()
        self.assertEqual(boss.staff_role.name, "Manager")
        self.assertIn("Kitchen Screen", cook.staff_role.name)
        self.assertTrue(rbac.worker_can(cook, "kds.access"))
        self.assertEqual(
            set(StaffRole.objects.filter(merchant=self.merchant, is_system=True).values_list("system_key", flat=True)),
            {"admin", "manager", "cashier", "server", "kitchen", "inventory"},
        )


# ─────────────────────────────────────────────────────────────────────────────
# Server-side enforcement in staff mode
# ─────────────────────────────────────────────────────────────────────────────


class EnforcementTests(Base):
    def test_owner_is_admin_of_own_merchant_only(self):
        me = self.client.get("/api/pos/staff/me/").data
        self.assertEqual(me["mode"], "admin")
        self.assertEqual(set(me["permissions"]), set(rbac.ALL_PERMISSIONS))
        self.assertIsNone(me["area_ids"])

    def test_cashier(self):
        self.area("Bar", count=1, prefix="B")
        staff = self.as_staff(self.employee("Sita", "cashier"))
        self.assertEqual(staff.get("/api/pos/orders/").status_code, 200)           # POS
        self.assertEqual(staff.get("/api/merchants/tables/").status_code, 200)     # sees tables
        for method, url in [
            ("patch", "/api/merchants/me/update/"),          # settings
            ("get", "/api/pos/roles/"),                      # roles
            ("post", "/api/pos/roles/"),
            ("post", "/api/pos/refund/"),                    # refund not allowed
            ("post", "/api/pos/discount/apply/"),
            ("post", "/api/merchants/table-areas/"),         # table setup
            ("post", "/api/merchants/menu-items/"),          # menu
            ("get", "/api/pos/reports/sales/"),              # reports
            ("post", "/api/pos/workers/team/"),              # employees
            ("get", "/api/inventory/items/"),                # inventory
            ("post", "/api/offers/merchant/campaigns/"),     # offers config
        ]:
            self.assertEqual(getattr(staff, method)(url, {}, format="json").status_code, 403, f"{method} {url}")

    def test_kitchen(self):
        staff = self.as_staff(self.employee("Hari", "kitchen"))
        self.assertEqual(staff.get("/api/orders/preparation-areas/").status_code, 200)   # KDS
        for method, url in [
            ("post", "/api/pos/payment/create/"),
            ("get", "/api/pos/reports/sales/"),
            ("get", "/api/pos/roles/"),
            ("patch", "/api/merchants/me/update/"),
            ("post", "/api/orders/preparation-areas/"),      # setting stations up is not kitchen work
            ("post", "/api/pos/workers/team/"),
        ]:
            self.assertEqual(getattr(staff, method)(url, {}, format="json").status_code, 403, f"{method} {url}")

    def test_inventory_role(self):
        staff = self.as_staff(self.employee("Gopal", "inventory"))
        root = staff.get("/api/inventory/")
        self.assertEqual(root.status_code, 200)
        perms = root.data["permissions"]
        self.assertTrue(perms["inventory.view"] and perms["inventory.count"] and perms["inventory.receive"])
        self.assertTrue(perms["inventory.manage_suppliers"])
        self.assertFalse(perms["inventory.adjust"])
        self.assertFalse(perms["inventory.view_cost"])
        self.assertFalse(perms["inventory.manage_settings"])
        self.assertEqual(staff.get("/api/inventory/suppliers/").status_code, 200)
        self.assertEqual(staff.get("/api/inventory/settings/").status_code, 403)
        self.assertEqual(staff.get("/api/pos/roles/").status_code, 403)
        self.assertEqual(staff.patch("/api/merchants/me/update/", {}, format="json").status_code, 403)
        self.assertEqual(staff.get("/api/pos/orders/").status_code, 403)

    def test_manager_cannot_change_roles_or_escalate(self):
        maya = self.employee("Maya", "manager")
        staff = self.as_staff(maya)
        self.assertEqual(staff.get("/api/pos/reports/sales/").status_code, 200)
        self.assertEqual(staff.get("/api/pos/roles/").status_code, 200)   # needed to pick a role for staff
        admin, cashier = self.roles["admin"], self.roles["cashier"]
        self.assertEqual(staff.patch(f"/api/pos/roles/{cashier.id}/", {"permissions": []}, format="json").status_code, 403)
        self.assertEqual(staff.patch(f"/api/pos/roles/{admin.id}/", {"permissions": []}, format="json").status_code, 403)
        self.assertEqual(staff.post("/api/pos/roles/", {"name": "X"}, format="json").status_code, 403)
        # May manage employees, but never hand out more access than their own.
        ok = staff.post("/api/pos/workers/team/", {
            "display_name": "New Cashier", "pin": "4321", "staff_role": cashier.id,
        }, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        up = staff.patch(f"/api/pos/workers/team/{maya.id}/", {"staff_role": admin.id}, format="json")
        self.assertEqual(up.status_code, 403)
        self.assertEqual(ShiftWorker.objects.get(id=maya.id).staff_role, self.roles["manager"])
        boss = self.employee("Boss", "admin")
        self.assertEqual(
            staff.patch(f"/api/pos/workers/team/{boss.id}/", {"is_active": False}, format="json").status_code, 403,
        )

    def test_unknown_api_is_denied_in_staff_mode(self):
        from .middleware import required_permission

        self.assertIs(required_permission("/api/something-new/", "GET"), False)
        self.assertEqual(required_permission("/api/pos/refund/", "POST"), "payments.refund")
        self.assertEqual(required_permission("/api/orders/preparation-areas/3/action/ready/", "POST"), "kds.access")
        self.assertEqual(required_permission("/api/orders/12/cancel/", "POST"), "orders.cancel")

    def test_cancelling_an_order_needs_the_permission(self):
        order = Order.objects.create(merchant=self.merchant, status=Order.STATUS_CONFIRMED, total_amount=10)
        staff = self.as_staff(self.employee("Ram", "server"))
        url = f"/api/orders/{order.id}/update-status/"
        self.assertEqual(staff.patch(url, {"status": "cancelled"}, format="json").status_code, 403)
        self.assertEqual(staff.post(f"/api/orders/{order.id}/cancel/", {}, format="json").status_code, 403)
        manager = self.as_staff(self.employee("Maya", "manager"))
        self.assertNotEqual(manager.patch(url, {"status": "cancelled"}, format="json").status_code, 403)

    def test_invalid_or_foreign_staff_token(self):
        forged = APIClient()
        forged.force_authenticate(self.owner)
        forged.credentials(HTTP_X_ZENTRO_STAFF="forged")
        self.assertEqual(forged.get("/api/merchants/tables/").status_code, 403)
        # Another merchant's owner cannot act as this merchant's employee.
        token = self.client.post("/api/pos/staff/session/", {
            "worker_id": str(self.employee("Sita", "cashier").id), "pin": "1234",
        }, format="json").data["token"]
        foreign = APIClient()
        foreign.force_authenticate(self.other_owner)
        foreign.credentials(HTTP_X_ZENTRO_STAFF=token)
        self.assertEqual(foreign.get("/api/pos/staff/me/").status_code, 403)

    def test_wrong_pin_and_leaving_staff_mode(self):
        sita = self.employee("Sita", "cashier")
        bad = self.client.post("/api/pos/staff/session/", {"worker_id": str(sita.id), "pin": "0000"}, format="json")
        self.assertEqual(bad.status_code, 401)
        maya = self.employee("Maya", "manager", pin="9999")
        staff = self.as_staff(sita)
        end = "/api/pos/staff/session/end/"
        self.assertEqual(staff.post(end, {"password": "nope"}, format="json").status_code, 401)
        self.assertEqual(staff.post(end, {"worker_id": str(sita.id), "pin": "1234"}, format="json").status_code, 401)
        self.assertEqual(staff.post(end, {"worker_id": str(maya.id), "pin": "9999"}, format="json").status_code, 200)
        self.assertEqual(staff.post(end, {"password": "Owner123!"}, format="json").status_code, 200)

    def test_role_change_takes_effect_immediately(self):
        """Cashier cannot refund → becomes Senior Cashier → refund allowed, same session."""
        sita = self.employee("Sita", "cashier")
        staff = self.as_staff(sita)
        order = Order.objects.create(merchant=self.merchant, status=Order.STATUS_COMPLETED, total_amount=100)
        payload = {"order_id": str(order.uuid), "worker_id": str(sita.id)}

        self.assertEqual(staff.post("/api/pos/refund/", payload, format="json").status_code, 403)
        # Even without staff mode, naming the employee on the request is refused.
        self.assertEqual(self.client.post("/api/pos/refund/", payload, format="json").status_code, 403)

        senior = self.custom_role("Senior Cashier", ["pos.access", "orders.create", "payments.take", "payments.refund"])
        self.client.patch(f"/api/pos/workers/team/{sita.id}/", {"staff_role": senior.id}, format="json")

        self.assertIn("payments.refund", staff.get("/api/pos/staff/me/").data["permissions"])
        allowed = staff.post("/api/pos/refund/", payload, format="json")
        self.assertNotEqual(allowed.status_code, 403, allowed.data)   # past the permission gate
        self.assertEqual(allowed.status_code, 400)                    # "Order is not paid"
        self.assertTrue(PosAuditLog.objects.filter(merchant=self.merchant, action="worker_role_change").exists())

        # Editing the role itself also applies at once.
        self.client.patch(f"/api/pos/roles/{senior.id}/", {"permissions": ["pos.access"]}, format="json")
        self.assertEqual(staff.post("/api/pos/refund/", payload, format="json").status_code, 403)
        self.assertTrue(PosAuditLog.objects.filter(merchant=self.merchant, action="role_update").exists())


class AreaRestrictionTests(Base):
    def setUp(self):
        super().setUp()
        self.main = self.area("Main Dining", count=2, prefix="T")
        self.bar = self.area("Bar", count=2, prefix="B")
        self.coffee = MenuItem.objects.create(merchant=self.merchant, name="Coffee", price=100, is_available=True)

    def order_payload(self, worker, table_id):
        return {
            "merchant_id": self.merchant.id, "worker_id": str(worker.id), "table_id": table_id,
            "fulfillment_type": "dine_in", "items": [{"menu_item_id": self.coffee.id, "quantity": 1}],
        }

    def test_server_sees_and_uses_only_assigned_areas(self):
        ram = self.employee("Ram", "server", areas=[self.main["id"]])
        self.assertEqual(rbac.allowed_area_ids(ram), {self.main["id"]})
        staff = self.as_staff(ram)
        names = {t["name"] for t in staff.get("/api/merchants/tables/").data}
        self.assertEqual(names, {"T1", "T2"})
        self.assertEqual([a["name"] for a in staff.get("/api/merchants/table-areas/").data["areas"]], ["Main Dining"])
        # Changing a Bar table is refused (needs table setup rights anyway).
        bar_table = self.bar["tables"][0]["id"]
        self.assertEqual(staff.patch(f"/api/merchants/tables/{bar_table}/", {"seats": 9}, format="json").status_code, 403)
        # Ordering on a Bar table is refused by the server, not just hidden.
        denied = self.client.post("/api/pos/order/create/", self.order_payload(ram, bar_table), format="json")
        self.assertEqual(denied.status_code, 403, denied.data)
        self.assertEqual(denied.data["code"], "area_restricted")
        allowed = self.client.post(
            "/api/pos/order/create/", self.order_payload(ram, self.main["tables"][0]["id"]), format="json",
        )
        self.assertNotEqual(allowed.status_code, 403, allowed.data)
        self.assertTrue(PosAuditLog.objects.filter(merchant=self.merchant, action="worker_areas_change").exists())

    def test_admin_manager_and_unassigned_staff_see_all_areas(self):
        self.assertEqual({t["name"] for t in self.client.get("/api/merchants/tables/").data}, {"T1", "T2", "B1", "B2"})
        manager = self.employee("Maya", "manager", areas=[self.main["id"]])
        self.assertIsNone(rbac.allowed_area_ids(manager))          # managers are never area-limited
        cashier = self.employee("Sita", "cashier")
        self.assertIsNone(rbac.allowed_area_ids(cashier))          # no areas assigned → all areas
        staff = self.as_staff(cashier)
        self.assertEqual(len(staff.get("/api/merchants/tables/").data), 4)

    def test_kitchen_cannot_take_orders(self):
        hari = self.employee("Hari", "kitchen")
        resp = self.client.post(
            "/api/pos/order/create/", self.order_payload(hari, self.main["tables"][0]["id"]), format="json",
        )
        self.assertEqual(resp.status_code, 403)


class TenantIsolationTests(Base):
    def test_other_merchant_cannot_touch_roles_employees_or_areas(self):
        role = self.custom_role("Senior Cashier", ["pos.access"])
        ram = self.employee("Ram", "server")
        area = self.area("Bar", count=1, prefix="B")
        o = self.other_client
        self.assertEqual(o.patch(f"/api/pos/roles/{role.id}/", {"permissions": []}, format="json").status_code, 404)
        self.assertEqual(o.delete(f"/api/pos/roles/{role.id}/").status_code, 404)
        self.assertEqual(o.patch(f"/api/pos/workers/team/{ram.id}/", {"display_name": "X"}, format="json").status_code, 404)
        self.assertEqual(o.post("/api/pos/staff/session/", {"worker_id": str(ram.id), "pin": "1234"}, format="json").status_code, 404)
        self.assertNotIn("Senior Cashier", [r["name"] for r in o.get("/api/pos/roles/").data["roles"]])
        self.assertEqual(o.get("/api/pos/workers/team/").data, [])
        # Their own employee cannot be given our role or our areas.
        theirs = o.post("/api/pos/workers/team/", {
            "display_name": "Theirs", "pin": "1234", "staff_role": role.id,
        }, format="json")
        self.assertEqual(theirs.status_code, 400)
        their_cashier = rbac.ensure_default_roles(self.other)["cashier"]
        made = o.post("/api/pos/workers/team/", {
            "display_name": "Theirs", "pin": "1234", "staff_role": their_cashier.id, "area_ids": [area["id"]],
        }, format="json")
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(made.data["area_ids"], [])
        self.assertFalse(PosAuditLog.objects.filter(merchant=self.other, action="role_create").exists())
