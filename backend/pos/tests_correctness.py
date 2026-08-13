"""
Correctness regression tests for POS hardening:
- Order creation idempotency (ProcessedClientMutation unique constraint)
- KOT numbering (sequential, per merchant, non-colliding under lock)
- Payment idempotency (sequential + real concurrent double-tap)
- Failed debit validation never leaves an orphan payment
- Split-payment device-not-found returns 404 instead of a 500
"""

import uuid
from concurrent.futures import ThreadPoolExecutor

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem
from pos.models import (
    CashShift,
    PosDevice,
    PosPayment,
    ProcessedClientMutation,
    ShiftWorker,
)


def _make_merchant(slug="correctness-cafe"):
    user = get_user_model().objects.create_user(
        username=slug, email=f"{slug}@test.com", password="Pass123!", role="merchant"
    )
    merchant = MerchantProfile.objects.create(
        user=user,
        business_name="Correctness Cafe",
        slug=slug,
        is_open=True,
        onboarding_complete=True,
        pos_enabled=True,
        shift_management_enabled=False,
        table_ordering_enabled=True,
    )
    return user, merchant


class PosOrderCorrectnessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user, self.merchant = _make_merchant()
        self.client.force_authenticate(user=self.merchant_user)
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Momo", price=250, is_available=True,
            loyalty_reward=True, points_per_item=1,
        )
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till-1", device_token_hash="x", is_active=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", role="cashier",
            pin_hash="hashed",
        )

    def _payload(self, client_mutation_id):
        return {
            "items": [{"menu_item_id": self.item.id, "quantity": 2}],
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": client_mutation_id,
        }

    def test_create_pos_order_is_idempotent(self):
        mid = str(uuid.uuid4())
        first = self.client.post("/api/pos/order/create/", self._payload(mid), format="json")
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post("/api/pos/order/create/", self._payload(mid), format="json")
        self.assertIn(second.status_code, (200, 201), second.data)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(OrderItem.objects.count(), 1)
        self.assertEqual(ProcessedClientMutation.objects.count(), 1)

    def test_kot_numbers_are_sequential_per_merchant(self):
        first = self.client.post(
            "/api/pos/order/create/", self._payload(str(uuid.uuid4())), format="json"
        )
        second = self.client.post(
            "/api/pos/order/create/", self._payload(str(uuid.uuid4())), format="json"
        )
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        order1 = Order.objects.get(id=first.data["id"])
        order2 = Order.objects.get(id=second.data["id"])
        self.assertIsNotNone(order1.kot_number)
        self.assertEqual(order2.kot_number, order1.kot_number + 1)


class PosPaymentCorrectnessTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user, self.merchant = _make_merchant(slug="payment-cafe")
        self.client.force_authenticate(user=self.merchant_user)
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till-1", device_token_hash="x", is_active=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", role="cashier",
            pin_hash="hashed",
        )
        self.shift = CashShift.objects.create(
            merchant=self.merchant, device=self.device, opened_by=self.worker,
            status=CashShift.STATUS_OPEN,
        )
        self.order = Order.objects.create(
            merchant=self.merchant, status=Order.STATUS_CONFIRMED,
            total_amount=500, subtotal=500, order_type=Order.ORDER_TYPE_REGULAR,
        )

    def _payload(self, mid, **overrides):
        payload = {
            "order_id": str(self.order.uuid),
            "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "payment_method": "cash",
            "amount": "500.00",
            "client_mutation_id": mid,
        }
        payload.update(overrides)
        return payload

    def test_create_payment_is_idempotent(self):
        mid = str(uuid.uuid4())
        first = self.client.post("/api/pos/payment/create/", self._payload(mid), format="json")
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post("/api/pos/payment/create/", self._payload(mid), format="json")
        self.assertIn(second.status_code, (200, 201), second.data)
        self.assertEqual(PosPayment.objects.count(), 1)
        self.assertEqual(ProcessedClientMutation.objects.filter(
            merchant=self.merchant, entity_type="payment").count(), 1)

    def test_failed_debit_check_leaves_no_orphan_payment(self):
        from pos.models import DebitAccount
        account = DebitAccount.objects.create(
            merchant=self.merchant, contact_name="Wallet", balance=100, is_active=True,
        )
        mid = str(uuid.uuid4())
        resp = self.client.post("/api/pos/payment/create/", self._payload(
            mid, payment_method="debit", debit_account_id=str(account.id),
        ), format="json")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(PosPayment.objects.count(), 0)
        self.assertEqual(ProcessedClientMutation.objects.count(), 0)
        account.refresh_from_db()
        self.assertEqual(account.balance, 100)

    def test_split_payment_device_not_found_returns_404(self):
        mid = str(uuid.uuid4())
        resp = self.client.post("/api/pos/payment/split/", {
            "order_id": str(self.order.uuid),
            "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id),
            "device_id": str(uuid.uuid4()),
            "payments": [
                {"payment_method": "cash", "amount": "250.00"},
                {"payment_method": "cash", "amount": "250.00"},
            ],
            "client_created_at": "2026-01-01T12:00:00Z",
        }, format="json")
        self.assertEqual(resp.status_code, 404, resp.data)
        self.assertIn("Device", resp.data.get("error", ""))


class CreatePaymentConcurrencyTests(TransactionTestCase):
    """Real concurrent double-tap on the same client_mutation_id.

    Uses TransactionTestCase so each thread's connection sees committed data
    and the two requests genuinely race on the unique constraint. Exactly one
    payment row must survive, and both callers must get a 2xx.
    """

    def setUp(self):
        self.merchant_user, self.merchant = _make_merchant(slug="concurrent-cafe")
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till-1", device_token_hash="x", is_active=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", role="cashier",
            pin_hash="hashed",
        )
        self.shift = CashShift.objects.create(
            merchant=self.merchant, device=self.device, opened_by=self.worker,
            status=CashShift.STATUS_OPEN,
        )
        self.order = Order.objects.create(
            merchant=self.merchant, status=Order.STATUS_CONFIRMED,
            total_amount=500, subtotal=500, order_type=Order.ORDER_TYPE_REGULAR,
        )

    def test_concurrent_duplicate_payments_create_one_row(self):
        mid = str(uuid.uuid4())
        payload = {
            "order_id": str(self.order.uuid),
            "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "payment_method": "cash",
            "amount": "500.00",
            "client_mutation_id": mid,
        }

        def submit():
            from django.db import connections
            try:
                client = APIClient()
                client.force_authenticate(user=self.merchant_user)
                return client.post("/api/pos/payment/create/", payload, format="json")
            finally:
                # Close the thread's own DB connection so the test runner can
                # drop the test database afterwards.
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = [f.result() for f in (executor.submit(submit) for _ in range(2))]

        for resp in responses:
            self.assertIn(resp.status_code, (200, 201), resp.data)
        self.assertEqual(PosPayment.objects.filter(client_mutation_id=mid).count(), 1)
        self.assertEqual(
            ProcessedClientMutation.objects.filter(client_mutation_id=mid).count(), 1,
        )
        self.assertEqual(
            Order.objects.get(id=self.order.id).payment_status, "paid",
        )
