"""
Money-concurrency regression tests — debit account balance updates are
serialized with row locks (no lost updates).

Run with: python manage.py test pos.test_debit_concurrency
"""

import threading
import unittest

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos.models import ShiftWorker, DebitAccount


@unittest.skipUnless(
    "postgres" in settings.DATABASES["default"]["ENGINE"] or
    settings.DATABASES["default"]["ENGINE"].endswith("postgresql"),
    "Money-concurrency regression requires Postgres row locking (SQLite serializes the whole write).",
)
class DebitTopupConcurrencyTest(TransactionTestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username="pos-m", email="pos-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=user, business_name="Conc Cafe", slug="conc-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
            offline_pos_enabled=True, debit_accounts_enabled=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="BarA",
            pin_hash="abc", role="manager", is_active=True,
        )
        self.account = DebitAccount.objects.create(
            merchant=self.merchant, contact_name="Prepaid A", balance=500,
            is_active=True,
        )
        self.user = user

    def _client(self):
        c = APIClient()
        c.force_authenticate(user=self.user)
        return c

    def test_concurrent_topups_do_not_lose_updates(self):
        c = self._client()
        base = c.post("/api/pos/debit/topup/", {
            "account_id": str(self.account.id),
            "worker_id": str(self.worker.id),
            "device_id": "00000000-0000-0000-0000-000000000000",
            "amount": "100",
            "client_mutation_id": "00000000-0000-0000-0000-000000000001",
            "note": "",
        }, format="json")
        self.assertEqual(base.status_code, 201, base.content)

        results = []
        lock = threading.Lock()

        def do_topup(cid):
            from django.db import connections
            try:
                client = self._client()
                r = client.post("/api/pos/debit/topup/", {
                    "account_id": str(self.account.id),
                    "worker_id": str(self.worker.id),
                    "device_id": "00000000-0000-0000-0000-000000000000",
                    "amount": "100",
                    "client_mutation_id": cid,
                    "note": "",
                }, format="json")
                with lock:
                    results.append(r.status_code)
            finally:
                connections.close_all()

        threads = [
            threading.Thread(
                target=do_topup,
                args=(f"00000000-0000-0000-0000-00000000000{c}",),
            )
            for c in range(2, 6)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(results, [201] * 4, results)
        self.account.refresh_from_db()
        # 500 + 100 (base) + 4*100 = 1000
        self.assertEqual(self.account.balance, 1000)