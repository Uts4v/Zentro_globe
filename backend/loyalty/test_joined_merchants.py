# loyalty/test_joined_merchants.py
"""
Tests for GET /api/loyalty/merchant-profiles/joined/

Run with: python manage.py test loyalty.test_joined_merchants
"""

from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection
from rest_framework.test import APIClient
from rest_framework import status

from accounts.models import User, CustomerProfile
from merchants.models import MerchantProfile
from loyalty.models import CustomerMerchantProfile, CustomerMerchantWallet, Reward
from orders.models import Order


class JoinedMerchantsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Customer
        self.customer_user = User.objects.create_user(
            username="cust1", email="cust1@example.com", password="pass1234",
            role=User.ROLE_CUSTOMER,
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Test Customer"
        )

        # Merchant A — joined, with points
        self.merchant_a_user = User.objects.create_user(
            username="merchA", email="merchA@example.com", password="pass1234",
            role=User.ROLE_MERCHANT,
        )
        self.merchant_a = MerchantProfile.objects.create(
            user=self.merchant_a_user,
            business_name="Cafe A",
            slug="cafe-a",
            is_approved=True,
            is_open=True,
        )

        # Merchant B — joined, with different points
        self.merchant_b_user = User.objects.create_user(
            username="merchB", email="merchB@example.com", password="pass1234",
            role=User.ROLE_MERCHANT,
        )
        self.merchant_b = MerchantProfile.objects.create(
            user=self.merchant_b_user,
            business_name="Cafe B",
            slug="cafe-b",
            is_approved=True,
            is_open=True,
        )

        # Merchant C — NOT joined by this customer, should never appear
        self.merchant_c_user = User.objects.create_user(
            username="merchC", email="merchC@example.com", password="pass1234",
            role=User.ROLE_MERCHANT,
        )
        self.merchant_c = MerchantProfile.objects.create(
            user=self.merchant_c_user,
            business_name="Cafe C",
            slug="cafe-c",
            is_approved=True,
            is_open=True,
        )

        # Join customer to A and B only
        CustomerMerchantProfile.objects.create(
            customer=self.customer, merchant=self.merchant_a,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        CustomerMerchantProfile.objects.create(
            customer=self.customer, merchant=self.merchant_b,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )

        # Deliberately different point balances per merchant
        CustomerMerchantWallet.objects.create(
            customer=self.customer, merchant=self.merchant_a,
            points_balance=150, lifetime_points=150,
        )
        CustomerMerchantWallet.objects.create(
            customer=self.customer, merchant=self.merchant_b,
            points_balance=9999, lifetime_points=9999,
        )

        # Active rewards per merchant
        Reward.objects.create(
            merchant=self.merchant_a, name="Free coffee", points_cost=100, is_active=True
        )
        Reward.objects.create(
            merchant=self.merchant_b, name="Free pastry", points_cost=50, is_active=True
        )
        Reward.objects.create(
            merchant=self.merchant_b, name="Inactive reward", points_cost=50, is_active=False
        )

        # Pending order only at merchant A
        Order.objects.create(
            customer=self.customer, merchant=self.merchant_a,
            total_amount=250, points_earned=10, status=Order.STATUS_PENDING,
        )

        self.client.force_authenticate(user=self.customer_user)

    def test_returns_only_joined_merchants(self):
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        slugs = {item["merchant_slug"] for item in resp.data}
        self.assertEqual(slugs, {"cafe-a", "cafe-b"})
        self.assertNotIn("cafe-c", slugs)

    def test_points_are_never_mixed_between_merchants(self):
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        by_slug = {item["merchant_slug"]: item for item in resp.data}

        self.assertEqual(by_slug["cafe-a"]["points_balance"], 150)
        self.assertEqual(by_slug["cafe-b"]["points_balance"], 9999)

        # Sanity check: they must differ, proving no shared/aggregated total
        self.assertNotEqual(
            by_slug["cafe-a"]["points_balance"],
            by_slug["cafe-b"]["points_balance"],
        )

    def test_active_rewards_count_is_correct_and_excludes_inactive(self):
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        by_slug = {item["merchant_slug"]: item for item in resp.data}

        self.assertEqual(by_slug["cafe-a"]["active_rewards_count"], 1)
        # Merchant B has 1 active + 1 inactive reward — only active counts
        self.assertEqual(by_slug["cafe-b"]["active_rewards_count"], 1)

    def test_pending_orders_count_is_scoped_per_merchant(self):
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        by_slug = {item["merchant_slug"]: item for item in resp.data}

        self.assertEqual(by_slug["cafe-a"]["pending_orders_count"], 1)
        self.assertEqual(by_slug["cafe-b"]["pending_orders_count"], 0)

    def test_wallet_with_no_orders_yet_defaults_to_zero_points(self):
        # A third join with no wallet created yet should not error, just show 0
        merchant_d_user = User.objects.create_user(
            username="merchD", email="merchD@example.com", password="pass1234",
            role=User.ROLE_MERCHANT,
        )
        merchant_d = MerchantProfile.objects.create(
            user=merchant_d_user, business_name="Cafe D", slug="cafe-d",
            is_approved=True, is_open=True,
        )
        CustomerMerchantProfile.objects.create(
            customer=self.customer, merchant=merchant_d,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )
        # Deliberately no wallet created for merchant_d

        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        by_slug = {item["merchant_slug"]: item for item in resp.data}
        self.assertEqual(by_slug["cafe-d"]["points_balance"], 0)

    def test_inactive_join_is_excluded(self):
        merchant_e_user = User.objects.create_user(
            username="merchE", email="merchE@example.com", password="pass1234",
            role=User.ROLE_MERCHANT,
        )
        merchant_e = MerchantProfile.objects.create(
            user=merchant_e_user, business_name="Cafe E", slug="cafe-e",
            is_approved=True, is_open=True,
        )
        CustomerMerchantProfile.objects.create(
            customer=self.customer, merchant=merchant_e,
            status=CustomerMerchantProfile.STATUS_INACTIVE,
        )

        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        slugs = {item["merchant_slug"] for item in resp.data}
        self.assertNotIn("cafe-e", slugs)

    def test_merchant_account_cannot_access_endpoint(self):
        self.client.force_authenticate(user=self.merchant_a_user)
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_query_count_does_not_grow_with_joined_merchants(self):
        # Regression guard against N+1: query count must stay bounded as the
        # number of joined merchants grows (uses annotations, not per-row queries).
        for i in range(8):
            mu = User.objects.create_user(
                username=f"merchN{i}", email=f"merchN{i}@example.com",
                password="pass1234", role=User.ROLE_MERCHANT,
            )
            mp = MerchantProfile.objects.create(
                user=mu, business_name=f"Cafe N{i}", slug=f"cafe-n{i}",
                is_approved=True, is_open=True,
            )
            CustomerMerchantProfile.objects.create(
                customer=self.customer, merchant=mp,
                status=CustomerMerchantProfile.STATUS_ACTIVE,
            )
            CustomerMerchantWallet.objects.create(
                customer=self.customer, merchant=mp,
                points_balance=50, lifetime_points=50,
            )
            Reward.objects.create(
                merchant=mp, name=f"R{i}", points_cost=10, is_active=True,
            )
            Order.objects.create(
                customer=self.customer, merchant=mp,
                total_amount=10, points_earned=1, status=Order.STATUS_PENDING,
            )

        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/loyalty/merchant-profiles/joined/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2 + 8)
        # 1 (mount/url resolver) + 1 (auth) + 1 (profiles query) + small fixed overhead.
        self.assertLess(len(ctx.captured_queries), 8)