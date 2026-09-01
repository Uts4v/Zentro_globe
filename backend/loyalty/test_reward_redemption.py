"""
C-2 regression tests — reward redemptions are financially atomic.

Run with: python manage.py test loyalty.test_reward_redemption

Verifies:
- points are deducted atomically at redemption time (single transaction)
- order completion never deducts a second time
- order cancellation refunds the deducted points (REDEMPTION_REFUND),
  idempotently
- insufficient balance aborts cleanly without writing anything
- concurrent redemptions of the same wallet cannot over-spend (PostgreSQL)
"""

import threading

from django.db import connection
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from rest_framework import status

from accounts.models import User, CustomerProfile
from merchants.models import MerchantProfile
from loyalty.models import (
    CustomerMerchantWallet,
    PointTransaction,
    Redemption,
    Reward,
)
from orders.models import Order


def _create_customer(username, email):
    user = User.objects.create_user(
        username=username, email=email, password="pass1234",
        role=User.ROLE_CUSTOMER,
    )
    profile = CustomerProfile.objects.create(user=user, full_name=username.title())
    return user, profile


def _create_merchant(username, email, name, slug):
    user = User.objects.create_user(
        username=username, email=email, password="pass1234",
        role=User.ROLE_MERCHANT,
    )
    profile = MerchantProfile.objects.create(
        user=user, business_name=name, slug=slug,
        is_approved=True, is_open=True,
    )
    return user, profile


class RewardRedemptionAtomicTests(TestCase):
    def setUp(self):
        self.customer_user, self.customer = _create_customer(
            "alice", "alice@example.com",
        )
        self.merchant_user, self.merchant = _create_merchant(
            "shopkeeper", "shop@test.com", "Cafe Aroma", "cafe-aroma",
        )
        self.wallet = CustomerMerchantWallet.objects.create(
            customer=self.customer,
            merchant=self.merchant,
            points_balance=1000,
            lifetime_points=1000,
        )
        self.reward = Reward.objects.create(
            merchant=self.merchant,
            name="Free Coffee",
            points_cost=300,
            stock=5,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.customer_user)

    def _redeem(self):
        return self.client.post(
            f"/api/loyalty/rewards/{self.reward.pk}/redeem/"
        )

    def _get_order(self, response):
        order_id = response.data.get("order_id")
        return Order.objects.get(pk=order_id)

    def _complete_order(self, order):
        merchant_client = APIClient()
        merchant_client.force_authenticate(user=self.merchant_user)
        resp = merchant_client.patch(
            f"/api/orders/{order.pk}/update-status/",
            data={"status": Order.STATUS_CONFIRMED},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        resp = merchant_client.patch(
            f"/api/orders/{order.pk}/update-status/",
            data={"status": Order.STATUS_COMPLETED},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return resp

    # ── Deduction at redemption time ───────────────────────────────────────────

    def test_points_deducted_at_redeem_time(self):
        resp = self._redeem()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 700)

        # A REDEEMED ledger entry with a negative amount exists immediately.
        txn = PointTransaction.objects.get(
            wallet=self.wallet, transaction_type="REDEEMED",
        )
        self.assertEqual(txn.points, -300)
        self.assertEqual(txn.balance_after, 700)

        redemption = Redemption.objects.get(code=resp.data["code"])
        self.assertEqual(redemption.points_spent, 300)
        self.assertEqual(redemption.status, Redemption.STATUS_PENDING)

        # Order is created pre-awarded so completion cannot deduct again.
        order = self._get_order(resp)
        self.assertTrue(order.loyalty_awarded)

    def test_order_completion_does_not_double_deduct(self):
        resp = self._redeem()
        order = self._get_order(resp)

        self._complete_order(order)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 700)
        redeemed_count = PointTransaction.objects.filter(
            wallet=self.wallet, transaction_type="REDEEMED",
        ).count()
        self.assertEqual(redeemed_count, 1)

    # ── Cancellation refund ────────────────────────────────────────────────────

    def test_cancel_refunds_points(self):
        resp = self._redeem()
        order = self._get_order(resp)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 700)

        cancel_resp = self.client.patch(
            f"/api/orders/{order.pk}/cancel/",
            data={"reason": ""},
            format="json",
        )
        self.assertEqual(cancel_resp.status_code, status.HTTP_200_OK, cancel_resp.data)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 1000)

        refund_txn = PointTransaction.objects.get(
            wallet=self.wallet, transaction_type="REDEMPTION_REFUND",
        )
        self.assertEqual(refund_txn.points, 300)
        self.assertEqual(refund_txn.balance_after, 1000)

        order.refresh_from_db()
        redemption = order.reward_redemption
        self.assertEqual(redemption.status, Redemption.STATUS_CANCELLED)

    def test_cancel_refund_is_idempotent(self):
        resp = self._redeem()
        order = self._get_order(resp)

        self.client.patch(
            f"/api/orders/{order.pk}/cancel/",
            data={"reason": ""},
            format="json",
        )
        # Second cancel is not valid (order no longer pending) but the refund
        # path must not have double-credited.
        self.client.patch(
            f"/api/orders/{order.pk}/cancel/",
            data={"reason": ""},
            format="json",
        )

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 1000)
        refund_count = PointTransaction.objects.filter(
            wallet=self.wallet, transaction_type="REDEMPTION_REFUND",
        ).count()
        self.assertEqual(refund_count, 1)

    def test_cancel_completed_order_does_not_refund(self):
        resp = self._redeem()
        order = self._get_order(resp)

        self._complete_order(order)

        # A completed order cannot be cancelled (no valid transition).
        cancel_resp = self.client.patch(
            f"/api/orders/{order.pk}/cancel/",
            data={"reason": ""},
            format="json",
        )
        self.assertIn(cancel_resp.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN))

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 700)

    # ── Insufficient balance ───────────────────────────────────────────────────

    def test_insufficient_balance_returns_400_and_writes_nothing(self):
        self.wallet.points_balance = 100
        self.wallet.save(update_fields=["points_balance"])

        resp = self._redeem()
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 100)

        self.assertFalse(Redemption.objects.exists())
        self.assertEqual(Redemption.objects.count(), 0)
        self.assertEqual(PointTransaction.objects.filter(
            wallet=self.wallet, transaction_type="REDEEMED").count(), 0)
        self.reward.refresh_from_db()
        self.assertEqual(self.reward.stock, 5)

    def test_redeem_success_and_failure_then_retry(self):
        # Success once, wallet at 700.
        self._redeem()
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 700)

        # Second redemption also succeeds (700 >= 300).
        resp = self._redeem()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 400)
        self.assertEqual(Redemption.objects.count(), 2)


class RewardRedemptionConcurrencyTests(TransactionTestCase):
    """Row-locking depends on real transactions — PostgreSQL only."""

    def setUp(self):
        super().setUp()
        self.customer_user, self.customer = _create_customer(
            "bob", "bob@example.com",
        )
        self.merchant_user, self.merchant = _create_merchant(
            "shopkeeper2", "shop2@test.com", "Cafe Aroma", "cafe-aroma",
        )
        self.wallet = CustomerMerchantWallet.objects.create(
            customer=self.customer,
            merchant=self.merchant,
            points_balance=300,
            lifetime_points=300,
        )
        self.reward = Reward.objects.create(
            merchant=self.merchant,
            name="Free Coffee",
            points_cost=300,
            stock=5,
        )

    def _redeem_once(self, results, idx):
        from django.db import connections, close_old_connections

        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(user=self.customer_user)
            resp = client.post(f"/api/loyalty/rewards/{self.reward.pk}/redeem/")
            results[idx] = resp.status_code
        finally:
            # Close this worker thread's DB connections so the test database
            # can be torn down without a lingering "accessed by other users".
            connections.close_all()

    def test_concurrent_redemptions_cannot_overspend(self):
        if connection.vendor != "postgresql":
            self.skipTest("select_for_update row locking requires PostgreSQL")

        results = {}
        threads = [
            threading.Thread(target=self._redeem_once, args=(results, i))
            for i in range(2)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(sorted(results.values()), [status.HTTP_201_CREATED, status.HTTP_400_BAD_REQUEST])

        self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.points_balance, 0)
        self.assertEqual(Redemption.objects.count(), 1)
        self.assertEqual(
            PointTransaction.objects.filter(transaction_type="REDEEMED").count(),
            1,
        )