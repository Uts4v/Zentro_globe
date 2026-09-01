"""
Tests for GET /api/pos/staff-report/

Run with: python manage.py test pos.test_staff_report

These verify the per-staff daily report aggregation (rewritten from a per-worker
8xN loop into grouped GROUP BY queries).
"""

import uuid

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos.models import ShiftWorker, PosPayment
from orders.models import Order, OrderItem


class StaffDailyReportTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="sr-m", email="sr-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Report Cafe", slug="report-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
        )
        self.worker_a = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Alice", role="cashier",
        )
        self.worker_b = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Bob", role="cashier",
        )
        self._auth()

    def _auth(self):
        self.client.force_authenticate(user=self.merchant_user)

    def _order(self, worker, amount, discount=0, status=None):
        order = Order.objects.create(
            merchant=self.merchant_profile,
            status=status or Order.STATUS_COMPLETED,
            total_amount=amount,
            discount_amount=discount,
            processed_by_worker=worker,
        )
        OrderItem.objects.create(
            order=order, name="Item", price=amount, quantity=2, subtotal=amount,
        )
        return order

    def _payment(self, worker, order, method, amount, status=PosPayment.STATUS_COMPLETED):
        PosPayment.objects.create(
            id=uuid.uuid4(),
            merchant=self.merchant_profile,
            order=order,
            worker=worker,
            payment_method=method,
            amount=amount,
            status=status,
            client_mutation_id=uuid.uuid4(),
        )

    def test_aggregates_are_scoped_and_correct_per_worker(self):
        # Alice: cash 100 + card 40 (completed) + a failed 999 (ignored)
        a1 = self._order(self.worker_a, 140, discount=10)
        self._payment(self.worker_a, a1, PosPayment.METHOD_CASH, 100)
        self._payment(self.worker_a, a1, PosPayment.METHOD_CARD, 40)
        a2 = self._order(self.worker_a, 999)
        self._payment(self.worker_a, a2, PosPayment.METHOD_CASH, 999,
                      status=PosPayment.STATUS_FAILED)

        # Bob: credit 50 + other 25 on two separate completed payments
        b1 = self._order(self.worker_b, 50, discount=5)
        self._payment(self.worker_b, b1, PosPayment.METHOD_CREDIT, 50)
        b2 = self._order(self.worker_b, 25)
        self._payment(self.worker_b, b2, PosPayment.METHOD_OTHER, 25)

        resp = self.client.get("/api/pos/staff-report/")
        self.assertEqual(resp.status_code, 200, resp.data)

        by_name = {s["worker_name"]: s for s in resp.data["staff"]}

        alice = by_name["Alice"]
        # Failed payment excluded -> total revenue = 100 + 40 = 140
        self.assertEqual(alice["total_revenue"], "140")
        self.assertEqual(alice["cash_amount"], "100")
        self.assertEqual(alice["card_amount"], "40")
        self.assertEqual(alice["credit_amount"], "0")
        self.assertEqual(alice["other_amount"], "0")
        self.assertEqual(alice["payment_count"], 2)
        self.assertEqual(alice["order_count"], 2)
        self.assertEqual(alice["total_discount"], "10")
        self.assertEqual(alice["items_sold"], 4)  # 2 items/order

        bob = by_name["Bob"]
        self.assertEqual(bob["total_revenue"], "75")
        self.assertEqual(bob["credit_amount"], "50")
        self.assertEqual(bob["other_amount"], "25")
        self.assertEqual(bob["payment_count"], 2)
        self.assertEqual(bob["order_count"], 2)
        self.assertEqual(bob["total_discount"], "5")
        self.assertEqual(bob["items_sold"], 4)

    def test_worker_with_no_activity_yields_zeroes(self):
        # Only Bob has activity; Alice must still appear with zeroed values.
        b1 = self._order(self.worker_b, 50)
        self._payment(self.worker_b, b1, PosPayment.METHOD_CASH, 50)

        resp = self.client.get("/api/pos/staff-report/")
        self.assertEqual(resp.status_code, 200, resp.data)
        by_name = {s["worker_name"]: s for s in resp.data["staff"]}

        alice = by_name["Alice"]
        self.assertEqual(alice["total_revenue"], "0")
        self.assertEqual(alice["payment_count"], 0)
        self.assertEqual(alice["order_count"], 0)
        self.assertEqual(alice["items_sold"], 0)


class StaffDailyReportAuthTests(TestCase):
    def test_requires_merchant_authentication(self):
        client = APIClient()
        resp = client.get("/api/pos/staff-report/")
        self.assertEqual(resp.status_code, 401)
