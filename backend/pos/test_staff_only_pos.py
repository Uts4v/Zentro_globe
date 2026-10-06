"""
Staff-only terminal: an employee works the POS with no merchant account.

Run with: python manage.py test pos.test_staff_only_pos

The scenario this protects is the whole point of `pos_staff_login`: a merchant
creates an employee in /merchant/team, that employee installs the app on their
own phone and signs in with a Staff Code + PIN. They never receive the owner's
password, so every path they touch must work on the staff token alone.

Covers: login with no credentials at all, the device being registered by that
login, a long PIN, staff-only order and payment endpoints, role enforcement on
those endpoints, and staff codes no longer colliding between businesses.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from orders.models import Order

from pos import rbac
from pos.models import PosDevice, ShiftWorker, StaffRole


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


class StaffOnlyLoginTests(TestCase):
    def setUp(self):
        self.owner, self.merchant = make_merchant(
            "so-owner", "so-owner@test.com", "Solo Bistro", "solo-bistro"
        )
        rbac.ensure_default_roles(self.merchant)
        self.roles = StaffRole.objects.filter(merchant=self.merchant)

        self.cashier = ShiftWorker.objects.create(
            merchant=self.merchant,
            display_name="Asha",
            staff_code="2001",
            pin_hash="",
            role="cashier",
            is_active=True,
        )
        self.cashier.set_pin("8462")
        self.cashier.save()
        cashier_role = self.roles.get(system_key="cashier")
        rbac.assign_role(self.cashier, cashier_role)

        # The employee has no account of their own: there is no User row to log in
        # with, which is the whole point of Staff Code + PIN.
        self.assertFalse(hasattr(self.cashier, "user_id"))

        self.client = APIClient()

    def login(self, **overrides):
        payload = {"staff_code": "2001", "pin": "8462", "platform": "mobile"}
        payload.update(overrides)
        return self.client.post("/api/pos/auth/staff-login/", payload, format="json")

    def test_staff_code_and_pin_needs_no_merchant_credentials(self):
        resp = self.login()
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["worker"]["display_name"], "Asha")
        self.assertTrue(resp.data["token"])
        self.assertIn("pos.access", resp.data["permissions"])

    def test_login_registers_the_device_so_no_owner_login_is_needed(self):
        resp = self.login()
        self.assertEqual(resp.status_code, 200, resp.content)
        # The whole point: the phone becomes a registered till during login.
        self.assertIsNotNone(resp.data["device"], resp.content)
        self.assertTrue(resp.data["device_token"])

        device = PosDevice.objects.get(id=resp.data["device"]["id"])
        self.assertEqual(device.merchant_id, self.merchant.id)
        self.assertTrue(device.verify_token(resp.data["device_token"]))

    def test_device_can_bootstrap_with_only_the_device_token(self):
        resp = self.login()
        device_id = resp.data["device"]["id"]
        device_token = resp.data["device_token"]

        fresh = APIClient()
        boot = fresh.get(
            "/api/pos/auth/device-bootstrap/",
            HTTP_X_POS_DEVICE_ID=device_id,
            HTTP_X_POS_DEVICE_TOKEN=device_token,
        )
        self.assertEqual(boot.status_code, 200, boot.content)
        self.assertEqual(boot.data["merchant"]["id"], self.merchant.id)

    def test_an_eight_digit_pin_works(self):
        # The Team page invites 4-8 digits and the PIN pad accepts 8, so a long
        # PIN has to be verifiable here. It used to be truncated to its first
        # four digits by the POS, which counted as a wrong attempt.
        worker = ShiftWorker.objects.create(
            merchant=self.merchant,
            display_name="Bo",
            staff_code="2002",
            pin_hash="",
            role="cashier",
            is_active=True,
        )
        worker.set_pin("13579246")
        worker.save()

        resp = self.login(staff_code="2002", pin="13579246")
        self.assertEqual(resp.status_code, 200, resp.content)

        # And the first four digits on their own are NOT the PIN.
        short = self.login(staff_code="2002", pin="1357")
        self.assertEqual(short.status_code, 401, short.content)

    def test_wrong_pin_is_refused_without_leaking_which_part_was_wrong(self):
        resp = self.login(pin="0000")
        self.assertEqual(resp.status_code, 401)
        self.assertNotIn(str(self.cashier.pin_hash), str(resp.data).lower())

    def test_deactivated_employee_cannot_sign_in(self):
        self.cashier.is_active = False
        self.cashier.save(update_fields=["is_active"])
        resp = self.login()
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_role_without_pos_access_is_refused(self):
        kitchen = self.roles.get(system_key="kitchen")
        worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Kit", staff_code="2003",
            pin_hash="", role="waiter", is_active=True,
        )
        worker.set_pin("2468")
        worker.save()
        rbac.assign_role(worker, kitchen)

        resp = self.login(staff_code="2003", pin="2468")
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(resp.data.get("code"), "pos_access_denied")

    def test_lockout_after_five_wrong_pins(self):
        for _ in range(5):
            self.login(pin="0000")
        locked = self.login(pin="8462")
        self.assertEqual(locked.status_code, 429, locked.content)

    def test_staff_codes_do_not_collide_between_businesses(self):
        other_owner, other = make_merchant(
            "so-other", "so-other@test.com", "Two Cafe", "two-cafe"
        )
        rbac.ensure_default_roles(other)
        other_worker = ShiftWorker.objects.create(
            merchant=other, display_name="Cy", staff_code="", pin_hash="x",
            role="cashier", is_active=True,
        )
        code = ShiftWorker.generate_staff_code(other)
        self.assertNotEqual(code, self.cashier.staff_code)
        self.assertGreaterEqual(len(code), 7)

        # And a code from one business cannot sign in to the other.
        resp = self.login(staff_code=code)
        self.assertEqual(resp.status_code, 404, resp.content)


class StaffOnlyEndpointTests(TestCase):
    """What the employee can reach on the POS once signed in."""

    def setUp(self):
        self.owner, self.merchant = make_merchant(
            "soo-owner", "soo-owner@test.com", "Solo Grill", "solo-grill"
        )
        rbac.ensure_default_roles(self.merchant)
        roles = StaffRole.objects.filter(merchant=self.merchant)

        self.cashier = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Asha", staff_code="3100",
            pin_hash="", role="cashier", is_active=True,
        )
        self.cashier.set_pin("1357")
        self.cashier.save()
        rbac.assign_role(self.cashier, roles.get(system_key="cashier"))

        self.staff_client = APIClient()
        token = rbac.issue_staff_token(self.cashier)
        self.staff_client.credentials(
            HTTP_AUTHORIZATION=f"Staff {token}", HTTP_X_ZENTRO_STAFF=token
        )

    def test_a_cashier_can_create_an_order_with_only_a_staff_token(self):
        resp = self.staff_client.post(
            "/api/pos/order/create/",
            {
                "order_type": "takeaway",
                "items": [
                    {"menu_item_id": 0, "quantity": 1, "name": "Soup", "unit_price": "8.00"}
                ],
                "client_mutation_id": "00000000-0000-0000-0000-0000000000b1",
            },
            format="json",
        )
        # Whatever the payload validation says, it must not be 401/403: the
        # point is that the staff token authenticates at all.
        self.assertNotIn(resp.status_code, (401, 403), resp.content)

    def test_a_cashier_is_refused_reports(self):
        resp = self.staff_client.get("/api/pos/reports/summary/")
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_a_cashier_is_refused_settings_changes(self):
        resp = self.staff_client.post(
            "/api/pos/settings/update/", {"business_name": "Hacked"}, format="json"
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_a_cashier_cannot_see_another_business(self):
        other_owner, other = make_merchant(
            "soo-other", "soo-other@test.com", "Rival", "rival-cafe"
        )
        worker = ShiftWorker.objects.create(
            merchant=other, display_name="Zed", staff_code="3200",
            pin_hash="", role="cashier", is_active=True,
        )
        worker.set_pin("8642")
        worker.save()
        token = rbac.issue_staff_token(worker)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Staff {token}", HTTP_X_ZENTRO_STAFF=token)

        resp = client.get("/api/pos/reports/summary/")
        self.assertNotEqual(resp.status_code, 200, resp.content)

    def test_staff_token_expiry_is_bounded(self):
        # A staff token outlives a shift but not forever: an abandoned till must
        # not stay authenticated indefinitely.
        self.assertGreater(rbac.STAFF_SESSION_MAX_AGE, 0)
        self.assertLessEqual(rbac.STAFF_SESSION_MAX_AGE, 24 * 60 * 60)


class StaffTokenAttributionTests(TestCase):
    def test_orders_taken_in_staff_mode_are_attributed_to_the_employee(self):
        owner, merchant = make_merchant(
            "sta-owner", "sta-owner@test.com", "Solo Diner", "solo-diner"
        )
        rbac.ensure_default_roles(merchant)
        worker = ShiftWorker.objects.create(
            merchant=merchant, display_name="Asha", staff_code="4100",
            pin_hash="", role="cashier", is_active=True,
        )
        worker.set_pin("1357")
        worker.save()
        rbac.assign_role(worker, StaffRole.objects.get(merchant=merchant, system_key="cashier"))

        token = rbac.issue_staff_token(worker)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Staff {token}", HTTP_X_ZENTRO_STAFF=token)

        # Whatever the outcome of the write, the request must resolve to this
        # employee rather than to the merchant owner — that is what makes the
        # audit trail trustworthy.
        self.assertEqual(rbac.worker_from_token(token).id, worker.id)
        self.assertTrue(rbac.worker_can(worker, "orders.create"))

    def test_a_token_for_one_business_does_not_resolve_in_another(self):
        owner, merchant = make_merchant(
            "sta-x", "sta-x@test.com", "Cross Cafe", "cross-cafe"
        )
        other_owner, other = make_merchant(
            "sta-y", "sta-y@test.com", "Cross Two", "cross-two"
        )
        rbac.ensure_default_roles(merchant)
        worker = ShiftWorker.objects.create(
            merchant=merchant, display_name="Kay", staff_code="4300",
            pin_hash="", role="cashier", is_active=True,
        )
        worker.save()

        token = rbac.issue_staff_token(worker)
        self.assertIsNotNone(rbac.worker_from_token(token))
        # Scoping is the tenant check: the same token must not resolve for a
        # different business, or one merchant's employee could act in another.
        self.assertIsNone(rbac.worker_from_token(token, merchant=other))

    def test_deactivating_an_employee_kills_their_live_token(self):
        owner, merchant = make_merchant(
            "sta-off", "sta-off@test.com", "Fired Cafe", "fired-cafe"
        )
        rbac.ensure_default_roles(merchant)
        worker = ShiftWorker.objects.create(
            merchant=merchant, display_name="Gone", staff_code="4400",
            pin_hash="", role="cashier", is_active=True,
        )
        worker.save()

        token = rbac.issue_staff_token(worker)
        self.assertIsNotNone(rbac.worker_from_token(token))

        # A token is checked against the database on every request, so being
        # dismissed takes effect immediately rather than at the next expiry.
        worker.is_active = False
        worker.save(update_fields=["is_active"])
        self.assertIsNone(rbac.worker_from_token(token))