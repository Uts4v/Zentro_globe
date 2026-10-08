"""
The merchant team page must show each employee's PIN.

The PIN is what the merchant hands to a staff member so they can sign in on
the POS, so a PIN the page cannot show is a PIN the merchant cannot confirm
was saved. The plain value therefore rides back on the team endpoints only —
staff login and the POS worker lists must never echo a credential.

Run with: python manage.py test pos.test_team_pin_display
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos import rbac
from pos.models import ShiftWorker, StaffRole


def make_merchant(username, email, business_name, slug):
    user = get_user_model().objects.create_user(
        username=username, email=email, password="Owner123!", role="merchant"
    )
    merchant = MerchantProfile.objects.create(
        user=user,
        business_name=business_name,
        slug=slug,
        is_approved=True,
        is_open=True,
        pos_enabled=True,
    )
    return user, merchant


class TeamPinDisplayTests(TestCase):
    """What the team page saves is what it can read back."""

    def setUp(self):
        self.owner, self.merchant = make_merchant(
            "tp-owner", "tp-owner@test.com", "Pin House", "pin-house"
        )
        rbac.ensure_default_roles(self.merchant)
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def create_employee(self, name="Ravi", pin="4821"):
        resp = self.client.post(
            "/api/pos/workers/team/",
            {"display_name": name, "pin": pin},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp

    def test_create_returns_the_pin_it_saved(self):
        resp = self.create_employee(pin="4821")
        self.assertEqual(resp.data["pin"], "4821")

    def test_list_returns_the_pin_so_the_page_can_show_it(self):
        created = self.create_employee(pin="4821")
        resp = self.client.get("/api/pos/workers/team/")
        self.assertEqual(resp.status_code, 200, resp.content)
        entry = next(e for e in resp.data if e["id"] == created.data["id"])
        self.assertEqual(entry["pin"], "4821")

    def test_a_worker_whose_pin_predates_the_column_reads_blank(self):
        # Staff created before PINs were shown keep their old hash-only PIN:
        # the page shows "—" until the merchant sets it once.
        legacy = ShiftWorker.objects.create(
            merchant=self.merchant,
            display_name="Old Timer",
            pin_hash="not-recoverable",
            role="cashier",
            is_active=True,
        )
        resp = self.client.get("/api/pos/workers/team/")
        entry = next(e for e in resp.data if e["id"] == str(legacy.id))
        self.assertEqual(entry["pin"], "")

    def test_changing_the_pin_round_trips_and_still_verifies(self):
        created = self.create_employee(pin="4821")
        resp = self.client.patch(
            f"/api/pos/workers/team/{created.data['id']}/",
            {"pin": "9753"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["pin"], "9753")

        worker = ShiftWorker.objects.get(id=created.data["id"])
        self.assertTrue(worker.verify_pin("9753"))
        self.assertFalse(worker.verify_pin("4821"))

    def test_saving_without_a_pin_keeps_the_old_one(self):
        created = self.create_employee(pin="4821")
        resp = self.client.patch(
            f"/api/pos/workers/team/{created.data['id']}/",
            {"display_name": "Ravi K"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["pin"], "4821")
        worker = ShiftWorker.objects.get(id=created.data["id"])
        self.assertTrue(worker.verify_pin("4821"))


class PinNeverLeaksTests(TestCase):
    """The team page reads the PIN; login and POS lists must not."""

    def setUp(self):
        self.owner, self.merchant = make_merchant(
            "tnl-owner", "tnl-owner@test.com", "Seal Cafe", "seal-cafe"
        )
        rbac.ensure_default_roles(self.merchant)
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant,
            display_name="Asha",
            staff_code="9101",
            pin_hash="",
            role="cashier",
            is_active=True,
        )
        self.worker.set_pin("8462")
        self.worker.save()
        rbac.assign_role(
            self.worker,
            StaffRole.objects.get(merchant=self.merchant, system_key="cashier"),
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def test_staff_login_response_has_no_pin(self):
        client = APIClient()
        resp = client.post(
            "/api/pos/auth/staff-login/",
            {"staff_code": "9101", "pin": "8462", "platform": "mobile"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertNotIn("pin", resp.data["worker"])
        self.assertNotIn("pin_hash", resp.data["worker"])
        body = str(resp.data).lower()
        self.assertNotIn(str(self.worker.pin_hash), body)

    def test_pos_worker_list_has_no_pin(self):
        resp = self.client.get("/api/pos/workers/")
        self.assertEqual(resp.status_code, 200, resp.content)
        for entry in resp.data:
            self.assertNotIn("pin", entry)
            self.assertNotIn("pin_hash", entry)
