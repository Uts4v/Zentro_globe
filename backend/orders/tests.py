from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from loyalty.models import CustomerMerchantProfile, CustomerMission, Mission
from merchants.models import MerchantProfile, MenuItem


class OrderMissionTrackingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()

        self.customer_user = self.user_model.objects.create_user(
            username="customer",
            email="customer@example.com",
            password="password123",
            role="customer",
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user,
            full_name="Test Customer",
        )

        self.merchant_user = self.user_model.objects.create_user(
            username="merchant",
            email="merchant@example.com",
            password="password123",
            role="merchant",
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user,
            business_name="Test Merchant",
            slug="test-merchant",
            is_open=True,
        )
        CustomerMerchantProfile.objects.create(
            customer=self.customer_profile,
            merchant=self.merchant_profile,
            status=CustomerMerchantProfile.STATUS_ACTIVE,
        )

        self.menu_item = MenuItem.objects.create(
            merchant=self.merchant_profile,
            name="Latte",
            price=10,
            is_available=True,
            loyalty_reward=True,
            points_per_item=1,
        )

        self.order_count_mission = Mission.objects.create(
            title="First Order",
            description="Complete your first order",
            mission_type="order_count",
            target_count=1,
            reward_points=100,
            required_merchant=self.merchant_profile,
            is_active=True,
        )

        self.spend_mission = Mission.objects.create(
            title="Big Spender",
            description="Spend at least 2500",
            mission_type="spend_amount",
            target_count=2500,
            reward_points=100,
            required_merchant=self.merchant_profile,
            is_active=True,
        )

        self.streak_mission = Mission.objects.create(
            title="Two-day streak",
            description="Visit two days in a row",
            mission_type="visit_streak",
            target_count=2,
            reward_points=100,
            required_merchant=self.merchant_profile,
            is_active=True,
        )

    def test_order_completion_tracks_multiple_missions(self):
        self.client.force_authenticate(user=self.customer_user)

        create_response = self.client.post(
            "/api/orders/create/",
            {
                "merchant_id": self.merchant_profile.id,
                "items": [{"menu_item_id": self.menu_item.id, "quantity": 280}],
                "notes": "Test order",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        order_id = create_response.data["id"]

        self.client.force_authenticate(user=self.merchant_user)

        for status in ("confirmed", "preparing", "ready", "completed"):
            resp = self.client.patch(
                f"/api/orders/{order_id}/update-status/",
                {"status": status},
                format="json",
            )
            self.assertEqual(resp.status_code, 200,
                             f"Transition to {status} failed: {getattr(resp, 'data', resp.content)}")

        order_count_progress = CustomerMission.objects.get(customer=self.customer_profile, mission=self.order_count_mission)
        self.assertEqual(order_count_progress.current_count, 1)
        self.assertTrue(order_count_progress.is_completed)

        spend_progress = CustomerMission.objects.get(customer=self.customer_profile, mission=self.spend_mission)
        self.assertEqual(spend_progress.current_count, 2800)
        self.assertTrue(spend_progress.is_completed)

        streak_progress = CustomerMission.objects.get(customer=self.customer_profile, mission=self.streak_mission)
        self.assertEqual(streak_progress.current_count, 1)
        self.assertFalse(streak_progress.is_completed)
