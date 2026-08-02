from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from loyalty.models import CustomerMerchantWallet
from orders.models import Order, OrderItem
from merchants.models import MenuItem
from accounts.models import CustomerProfile


class APISecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()

        self.merchant_user_1 = User.objects.create_user(
            username="m1", email="m1@test.com", password="p", role="merchant",
        )
        self.merchant_1 = MerchantProfile.objects.create(
            user=self.merchant_user_1, business_name="M1", slug="m1",
            ai_enabled=True,
        )

        self.merchant_user_2 = User.objects.create_user(
            username="m2", email="m2@test.com", password="p", role="merchant",
        )
        self.merchant_2 = MerchantProfile.objects.create(
            user=self.merchant_user_2, business_name="M2", slug="m2",
            ai_enabled=True,
        )

    def _create_artifact(self, merchant):
        from ai_core.models import AIArtifact, AIRequest
        req = AIRequest.objects.create(
            merchant=merchant, use_case="daily_insights",
            model_alias="test", status="completed",
        )
        from datetime import date
        return AIArtifact.objects.create(
            merchant=merchant, request=req,
            artifact_type="daily_insight",
            effective_date=date.today(),
            structured_content={"test": True},
            prompt_name="daily_merchant_insights",
            prompt_version="1.0.0",
        )

    def test_merchant_a_cannot_access_merchant_b_artifact(self):
        from ai_core.models import AIArtifact
        art = self._create_artifact(self.merchant_2)

        self.client.force_authenticate(user=self.merchant_user_1)
        resp = self.client.get(f"/api/ai/requests/{art.request_id}/")
        self.assertEqual(resp.status_code, 404)

    def test_unauthenticated_cannot_access_ai(self):
        resp = self.client.get("/api/ai/insights/daily/")
        self.assertEqual(resp.status_code, 401)

    def test_merchant_without_ai_enabled_cannot_generate(self):
        self.merchant_1.ai_enabled = False
        self.merchant_1.save(update_fields=["ai_enabled"])

        self.client.force_authenticate(user=self.merchant_user_1)
        resp = self.client.post("/api/ai/insights/daily/generate/", {}, format="json")
        self.assertEqual(resp.status_code, 403)
