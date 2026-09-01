"""
H-1/H-2/H-6 regression tests — menu item input validation.

Run with: python manage.py test merchants.test_menu_item_validation

Verifies the merchant menu-item create/update endpoints reject invalid
price / points / blank name inputs instead of persisting them.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile, MenuItem


class MenuItemValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="h-menu", email="h-menu@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="H Cafe", slug="h-cafe",
            is_approved=True, is_open=True,
        )
        self.client.force_authenticate(user=self.user)

    def _create(self, **overrides):
        payload = {
            "name": "Latte",
            "price": "150.00",
            "category": "Drinks",
            "points_per_item": 5,
        }
        payload.update(overrides)
        return self.client.post("/api/merchants/menu-items/", payload, format="json")

    def test_valid_item_created(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(MenuItem.objects.count(), 1)

    def test_rejects_zero_or_negative_price(self):
        for bad in ("0", "-5", "0.00"):
            with self.subTest(price=bad):
                resp = self._create(price=bad)
                self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MenuItem.objects.count(), 0)

    def test_rejects_negative_points(self):
        for bad in (-1, "-3"):
            with self.subTest(points=bad):
                resp = self._create(points_per_item=bad)
                self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MenuItem.objects.count(), 0)

    def test_rejects_blank_name(self):
        resp = self._create(name="   ")
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MenuItem.objects.count(), 0)

    def test_rejects_overlong_name_and_category(self):
        resp = self._create(name="x" * 256)
        self.assertEqual(resp.status_code, 400, resp.data)
        resp = self._create(category="c" * 101)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MenuItem.objects.count(), 0)

    def test_update_rejects_bad_price(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 201, resp.data)
        item_id = resp.data["id"]
        resp = self.client.patch(
            f"/api/merchants/menu-items/{item_id}/",
            {"price": "-1"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(MenuItem.objects.get(id=item_id).price, Decimal("150.00"))