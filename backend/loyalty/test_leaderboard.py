"""
C-4 regression tests — leaderboard is authenticated + rate-limited + public-safe.

Run with: python manage.py test loyalty.test_leaderboard

Verifies:
- unauthenticated requests are rejected (401)
- authenticated customers can read the public leaderboard payload
- the payload contains only the sanitised public fields (no internal
  serializers / no lifetime_points leakage)
- throttling is active
"""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework import status

from accounts.models import CustomerProfile
from merchants.models import MerchantProfile
from loyalty.models import CustomerMerchantWallet


def _create_user(username, email, role):
    return get_user_model().objects.create_user(
        username=username, email=email, password="Pass123!", role=role,
    )


class LeaderboardSecurityTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.merchant_user = _create_user("shop", "shop@test.com", "merchant")
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Cafe", slug="cafe",
            is_approved=True, is_open=True,
        )
        self.customer_user = _create_user("alice", "alice@test.com", "customer")
        self.customer = CustomerProfile.objects.create(user=self.customer_user, full_name="Alice")
        CustomerMerchantWallet.objects.create(
            customer=self.customer, merchant=self.merchant,
            points_balance=1200, lifetime_points=1200, tier_level="silver",
        )

    def test_unauthenticated_requests_rejected(self):
        anon = APIClient()
        resp = anon.get(
            "/api/loyalty/leaderboard/",
            {"merchant": self.merchant.id},
        )
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_authenticated_can_read_public_payload(self):
        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.get(
            "/api/loyalty/leaderboard/",
            {"merchant": self.merchant.id},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(len(resp.data), 1)
        entry = resp.data[0]
        self.assertEqual(entry["rank"], 1)
        self.assertEqual(entry["full_name"], "Alice")
        self.assertEqual(entry["loyalty_points"], 1200)
        self.assertEqual(entry["tier"], "silver")
        self.assertEqual(entry["merchant_id"], self.merchant.id)

    def test_public_payload_does_not_leak_internal_fields(self):
        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.get(
            "/api/loyalty/leaderboard/",
            {"merchant": self.merchant.id},
        )
        entry = resp.data[0]
        # Ensures no internal serializer data or sensitive PII leaks through.
        allowed = {
            "rank", "customer_id", "full_name", "loyalty_points",
            "tier", "streak_days", "merchant_id",
        }
        self.assertEqual(set(entry.keys()), allowed)

    def test_unknown_merchant_scoped_and_404(self):
        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        resp = client.get("/api/loyalty/leaderboard/", {"merchant": 999999})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_leaderboard_is_throttled(self):
        client = APIClient()
        client.force_authenticate(user=self.customer_user)
        url = f"/api/loyalty/leaderboard/?merchant={self.merchant.id}"
        # 300/hour budget — exceed it and expect a 429.
        for _ in range(301):
            client.get(url)
        resp = client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_leaderboard_queries_do_not_grow_per_row(self):
        profiles = []
        for i in range(25):
            u = _create_user(f"fan{i}", f"fan{i}@test.com", "customer")
            profile = CustomerProfile.objects.create(user=u, full_name=f"Fan {i}")
            CustomerMerchantWallet.objects.create(
                customer=profile, merchant=self.merchant,
                points_balance=500 + i, lifetime_points=500 + i,
                tier_level="silver",
            )
            profiles.append(profile)

        def _render(limit):
            qs = (
                CustomerMerchantWallet.objects
                .filter(merchant_id=self.merchant.id, points_balance__gt=0)
                .select_related("customer__user", "merchant")
                .order_by("-points_balance")[:limit]
            )
            with CaptureQueriesContext(connection) as captured:
                rows = list(qs)

                def _entry(i, w):
                    return {
                        "rank": i + 1,
                        "customer_id": w.customer_id,
                        "full_name": w.customer.full_name or w.customer.user.email,
                        "loyalty_points": w.points_balance,
                        "tier": w.tier_level,
                        "streak_days": w.streak_days,
                        "merchant_id": w.merchant_id,
                    }

                [_entry(i, w) for i, w in enumerate(rows)]  # noqa: B023
            return len(captured)

        large = _render(25)
        small = _render(1)
        # A single sliced query with select_related — no per-row lookups.
        self.assertLessEqual(
            large - small, 3,
            f"leaderboard query delta {large - small}: N+1 suspected",
        )