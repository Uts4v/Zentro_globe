"""
Money regression tests — POS refund reverses debit/credit account balances
correctly and is idempotent (no double refund).

Run with: python manage.py test pos.test_refund_money

Covers the fixes:
- credit reversals actually credit the customer's balance (previously wrote a
  fabricated 0/0 row and never touched the balance),
- money math uses Decimal (never float),
- an already-refunded order is rejected,
- a worker without refund permission is rejected.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from merchants.models import MerchantProfile
from orders.models import Order
from pos.models import ShiftWorker, PosDevice, DebitAccount, CreditAccount

PATH = "/api/pos/refund/"


class RefundMoneyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        merchant_user = get_user_model().objects.create_user(
            username="rf-m", email="rf-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_user = merchant_user
        self.merchant = MerchantProfile.objects.create(
            user=merchant_user, business_name="RF Cafe", slug="rf-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
            debit_accounts_enabled=True,
        )
        cust_user = get_user_model().objects.create_user(
            username="rf-c", email="rf-c@test.com", password="Pass123!", role="customer"
        )
        self.customer = CustomerProfile.objects.create(user=cust_user, full_name="RF Cust")
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till", device_token_hash="x", is_active=True,
        )
        self.manager = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Mgr", pin_hash="x",
            role="manager", is_active=True, can_process_refund=True,
        )
        self.cashier = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Cash", pin_hash="x",
            role="cashier", is_active=True, can_process_refund=False,
        )
        self.client.force_authenticate(user=self.merchant_user)

    def _order(self, method="debit"):
        return Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status="completed", order_type="pos",
            subtotal=Decimal("100.00"), tax_amount=Decimal("0.00"),
            total_amount=Decimal("100.00"), pos_device=self.device,
            payment_status="paid", payment_method=method,
        )

    def test_debit_refund_credits_account_balance(self):
        account = DebitAccount.objects.create(
            merchant=self.merchant, customer=self.customer,
            contact_name="", balance=Decimal("0.00"), is_active=True,
        )
        order = self._order("debit")
        resp = self.client.post(PATH, {
            "order_id": str(order.uuid),
            "worker_id": str(self.manager.id),
            "amount": "25.00",
            "refund_method": "debit",
            "reason": "wrong item",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        account.refresh_from_db()
        # 25 credited back to the debit account
        self.assertEqual(account.balance, Decimal("25.00"))
        order.refresh_from_db()
        self.assertEqual(order.payment_status, "refunded")

    def test_credit_refund_credits_account_balance(self):
        account = CreditAccount.objects.create(
            merchant=self.merchant, customer=self.customer,
            credit_limit=Decimal("200.00"), current_balance=Decimal("0.00"),
            is_active=True,
        )
        order = self._order("credit")
        resp = self.client.post(PATH, {
            "order_id": str(order.uuid),
            "worker_id": str(self.manager.id),
            "amount": "40.00",
            "refund_method": "credit",
            "reason": "correcting",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        account.refresh_from_db()
        # 40 credited back to the credit account balance
        self.assertEqual(account.current_balance, Decimal("40.00"))

    def test_double_refund_rejected(self):
        DebitAccount.objects.create(
            merchant=self.merchant, customer=self.customer,
            contact_name="", balance=Decimal("0.00"), is_active=True,
        )
        order = self._order("debit")
        body = {
            "order_id": str(order.uuid),
            "worker_id": str(self.manager.id),
            "amount": "10.00",
            "refund_method": "debit",
            "reason": "x",
        }
        first = self.client.post(PATH, body, format="json")
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(PATH, body, format="json")
        self.assertEqual(second.status_code, 400, second.content)

    def test_unauthorized_worker_rejected(self):
        order = self._order("debit")
        resp = self.client.post(PATH, {
            "order_id": str(order.uuid),
            "worker_id": str(self.cashier.id),
            "amount": "10.00",
            "refund_method": "debit",
            "reason": "x",
        }, format="json")
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_refund_over_total_rejected(self):
        order = self._order("debit")
        resp = self.client.post(PATH, {
            "order_id": str(order.uuid),
            "worker_id": str(self.manager.id),
            "amount": "500.00",
            "refund_method": "debit",
            "reason": "x",
        }, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
