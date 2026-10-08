"""
POS staff-login tenancy and staff-account persistence regressions.

Both guards exist because a POS is shared hardware: a staff code must never
resolve against a merchant other than the one the till belongs to, and the
identity fields a merchant sets for a worker (code/phone/email) must actually
persist — a dropped staff code is exactly how a code login 404s later and shows
the worker with "Code: —".

Run with: python manage.py test pos.test_staff_login_scope
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos import rbac
from pos.models import PosDevice, ShiftWorker


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


class CreateWorkerPersistsIdentityTests(TestCase):
    """What the POS staff screen saves is what the server keeps."""

    def setUp(self):
        self.owner, self.merchant = make_merchant(
            "cw-owner", "cw-owner@test.com", "Code Cafe", "code-cafe"
        )
        rbac.ensure_default_roles(self.merchant)
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

    def test_create_worker_persists_staff_code_phone_email(self):
        resp = self.client.post("/api/pos/workers/create/", {
            "display_name": "Nabin",
            "pin": "4821",
            "role": "cashier",
            "staff_code": "2049",
            "phone": "+9779811111111",
            "email": "nabin@codecafe.test",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data["staff_code"], "2049")
        self.assertEqual(resp.data["phone"], "+9779811111111")
        self.assertEqual(resp.data["email"], "nabin@codecafe.test")
        saved = ShiftWorker.objects.get(id=resp.data["id"])
        self.assertEqual(saved.staff_code, "2049")
        self.assertEqual(saved.phone, "+9779811111111")
        self.assertEqual(saved.email, "nabin@codecafe.test")

    def test_update_worker_persists_staff_code(self):
        worker = ShiftWorker.objects.create(
            merchant=self.merchant,
            display_name="Babu",
            pin_hash="",
            staff_code="",
            phone="",
            email="",
            role="cashier",
            is_active=True,
        )
        resp = self.client.patch(f"/api/pos/workers/{worker.id}/update/", {
            "staff_code": "2050",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        worker.refresh_from_db()
        self.assertEqual(worker.staff_code, "2050")


class StaffLoginTenancyTests(TestCase):
    """A staff code resolves only inside the merchant the till is bound to."""

    def setUp(self):
        self.owner_a, self.merchant_a = make_merchant(
            "sl-a", "sl-a@test.com", "Alpha Diner", "alpha-diner"
        )
        self.owner_b, self.merchant_b = make_merchant(
            "sl-b", "sl-b@test.com", "Beta Grill", "beta-grill"
        )
        for merchant in (self.merchant_a, self.merchant_b):
            rbac.ensure_default_roles(merchant)

        self.staff_a = ShiftWorker.objects.create(
            merchant=self.merchant_a,
            display_name="Alpha Worker",
            staff_code="3101",
            pin_hash="",
            role="cashier",
            is_active=True,
        )
        self.staff_a.set_pin("1234")
        self.staff_a.save()

        self.staff_b = ShiftWorker.objects.create(
            merchant=self.merchant_b,
            display_name="Beta Worker",
            staff_code="3102",
            pin_hash="",
            role="cashier",
            is_active=True,
        )
        self.staff_b.set_pin("5678")
        self.staff_b.save()

        # A registered Alpha till with a valid device token.
        self.device_a, self.device_a_token = PosDevice.register(
            merchant=self.merchant_a,
            name="Alpha till",
            platform="desktop",
            user_agent="test-runner",
        )

        self.client = APIClient()

    def test_another_merchants_code_cannot_login_on_this_till(self):
        # The till belongs to Alpha. Beta's code is unique system-wide, but on a
        # till already bound to Alpha it must not resolve — that is how a shared
        # device starts serving the wrong merchant's staff.
        resp = self.client.post("/api/pos/auth/staff-login/", {
            "staff_code": self.staff_b.staff_code,
            "pin": "5678",
            "platform": "mobile",
        }, format="json",
            HTTP_X_POS_DEVICE_ID=str(self.device_a.id),
            HTTP_X_POS_DEVICE_TOKEN=self.device_a_token,
        )
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_code_ambiguous_across_merchants_demands_the_store(self):
        # Same code on both merchants, no device and no store: the server cannot
        # choose a tenant, so it must ask for the store instead of guessing.
        ShiftWorker.objects.filter(merchant=self.merchant_a, staff_code="3101").update(
            staff_code="7777"
        )
        ShiftWorker.objects.filter(merchant=self.merchant_b, staff_code="3102").update(
            staff_code="7777"
        )
        resp = self.client.post("/api/pos/auth/staff-login/", {
            "staff_code": "7777",
            "pin": "1234",
            "platform": "mobile",
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.data.get("code"), "store_required")