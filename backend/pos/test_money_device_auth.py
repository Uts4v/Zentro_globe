"""
Money-endpoint POS device authorization regression (M-items).

Run with: python manage.py test pos.test_money_device_auth

Verifies that debit/credit money endpoints reject transactions attributed to a
device that is not an active POS device of the current merchant.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos.models import ShiftWorker, DebitAccount, PosDevice


class MoneyDeviceAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        user = get_user_model().objects.create_user(
            username="mda-m", email="mda-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_user = user
        self.merchant = MerchantProfile.objects.create(
            user=user, business_name="MDA Cafe", slug="mda-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
            debit_accounts_enabled=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="W", pin_hash="x",
            role="manager", is_active=True,
        )
        self.account = DebitAccount.objects.create(
            merchant=self.merchant, contact_name="Acct", balance=500, is_active=True,
        )
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till", device_token_hash="x", is_active=True,
        )
        self.client.force_authenticate(user=self.merchant_user)

    def _payload(self, device_id):
        return {
            "account_id": str(self.account.id),
            "worker_id": str(self.worker.id),
            "device_id": str(device_id),
            "amount": "50",
            "client_mutation_id": "00000000-0000-0000-0000-0000000000aa",
            "note": "",
        }

    def test_valid_device_allows_topup(self):
        resp = self.client.post("/api/pos/debit/topup/", self._payload(self.device.id), format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

    def test_foreign_device_rejected(self):
        other_user = get_user_model().objects.create_user(
            username="mda-o", email="mda-o@test.com", password="Pass123!", role="merchant"
        )
        other_merchant = MerchantProfile.objects.create(
            user=other_user, business_name="Other", slug="other-cafe", is_approved=True,
        )
        foreign = PosDevice.objects.create(
            merchant=other_merchant, name="OtherTill", device_token_hash="x", is_active=True,
        )
        resp = self.client.post("/api/pos/debit/topup/", self._payload(foreign.id), format="json")
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_bogus_device_rejected(self):
        resp = self.client.post(
            "/api/pos/debit/topup/",
            self._payload("00000000-0000-0000-0000-000000000000"),
            format="json",
        )
        self.assertEqual(resp.status_code, 404, resp.content)