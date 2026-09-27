from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from merchants.models import MerchantProfile, MerchantTable


class TableResolutionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        user = User.objects.create_user(
            username="table-test-merchant",
            email="table-test@zentro.com",
            password="Password123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=user,
            business_name="Java Cafe",
            slug="java-cafe",
            is_approved=True,
            table_ordering_enabled=True,
            is_open=True,
            onboarding_complete=True,
        )
        self.table = MerchantTable.objects.create(
            merchant=self.merchant,
            name="Table 4",
            table_number=4,
            public_token="TBL-TEST4",
            is_active=True,
        )

    def test_resolve_table_with_slug_and_token(self):
        url = f"/api/merchants/public/{self.merchant.slug}/tables/{self.table.public_token}/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["merchant"]["slug"], "java-cafe")
        self.assertEqual(response.data["merchant"]["name"], "Java Cafe")
        self.assertEqual(response.data["table"]["name"], "Table 4")
        self.assertEqual(response.data["table"]["table_number"], 4)
        self.assertEqual(response.data["table"]["public_token"], "TBL-TEST4")

    def test_resolve_table_by_token_only(self):
        url = f"/api/merchants/public/tables/{self.table.public_token}/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["merchant"]["slug"], "java-cafe")
        self.assertEqual(response.data["merchant"]["name"], "Java Cafe")
        self.assertEqual(response.data["table"]["name"], "Table 4")
        self.assertEqual(response.data["table"]["table_number"], 4)
        self.assertEqual(response.data["table"]["public_token"], "TBL-TEST4")

    def test_resolve_table_invalid_token(self):
        url = "/api/merchants/public/tables/TBL-NONEXISTENT/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_resolve_table_inactive(self):
        self.table.is_active = False
        self.table.save()
        url = f"/api/merchants/public/tables/{self.table.public_token}/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_resolve_table_ordering_disabled(self):
        self.merchant.table_ordering_enabled = False
        self.merchant.save()
        url = f"/api/merchants/public/tables/{self.table.public_token}/"
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data["merchant"]["table_ordering_enabled"])
