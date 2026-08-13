"""
Correctness regression tests for loyalty hardening:
- Point transaction list endpoints are pagination-capped server-side
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from loyalty.models import (
    CustomerMerchantProfile,
    CustomerMerchantWallet,
    PointTransaction,
)
from merchants.models import MerchantProfile


class PointTransactionPaginationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()

        self.customer_user = self.user_model.objects.create_user(
            username="pt-cust", email="pt-cust@example.com", password="Pass123!",
            role="customer",
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Point Customer",
        )

        self.merchant_user = self.user_model.objects.create_user(
            username="pt-merch", email="pt-merch@example.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Point Cafe",
            slug="point-cafe", is_open=True,
        )

        self.membership = CustomerMerchantProfile.objects.create(
            customer=self.customer, merchant=self.merchant,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        self.wallet = CustomerMerchantWallet.objects.create(
            customer=self.customer, merchant=self.merchant,
        )
        for i in range(210):
            PointTransaction.objects.create(
                merchant=self.merchant,
                customer=self.customer,
                wallet=self.wallet,
                transaction_type="EARNED",
                points=10,
                balance_before=i,
                balance_after=i + 10,
            )

    def test_merchant_transactions_are_capped(self):
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.get("/api/loyalty/merchant/transactions/?limit=1000")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 200)

    def test_customer_transactions_are_capped(self):
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.get(
            f"/api/loyalty/transactions/?merchant={self.merchant.id}&limit=1000"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(len(resp.data), 200)
