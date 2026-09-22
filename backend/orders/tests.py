from decimal import Decimal

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from accounts.models import CustomerProfile
from orders.models import Order, OrderItem
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

    def test_spend_mission_tracks_pre_tax_subtotal_not_total(self):
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

        self.client.force_authenticate(user=self.merchant_user)
        for status_flag in ("confirmed", "preparing", "ready", "completed"):
            resp = self.client.patch(
                f"/api/orders/{create_response.data['id']}/update-status/",
                {"status": status_flag},
                format="json",
            )
            self.assertEqual(resp.status_code, 200, getattr(resp, "data", resp.content))

        order = Order.objects.get(id=create_response.data["id"])
        self.assertGreater(order.total_amount, order.subtotal)

        spend_progress = CustomerMission.objects.get(
            customer=self.customer_profile, mission=self.spend_mission,
        )
        # Must equal subtotal (2800), never the tax-inclusive total.
        self.assertEqual(spend_progress.current_count, int(order.subtotal))


class AddItemsTotalsTests(TestCase):
    """Adding items to an existing order must recompute subtotal, tax AND total."""

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()

        self.customer_user = self.user_model.objects.create_user(
            username="add-totals-customer",
            email="add-totals-customer@example.com",
            password="password123",
            role="customer",
        )
        self.customer_profile = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Add Totals Customer",
        )
        self.client.force_authenticate(user=self.customer_user)

        self.merchant = MerchantProfile.objects.create(
            user=self.user_model.objects.create_user(
                username="add-totals-merchant",
                email="add-totals-merchant@example.com",
                password="password123",
                role="merchant",
            ),
            business_name="Totals Cafe",
            slug="totals-cafe",
            is_open=True,
            tax_enabled=True,
            tax_components=[{"name": "VAT", "rate": 9.0}],
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Burger", price=180,
            is_available=True, loyalty_reward=True, points_per_item=1,
        )

        self.order = Order.objects.create(
            customer=self.customer_profile,
            merchant=self.merchant,
            status=Order.STATUS_PENDING,
            order_type=Order.ORDER_TYPE_REGULAR,
            subtotal=Decimal("360.00"),
            tax_amount=Decimal("32.40"),
            total_amount=Decimal("392.40"),
        )
        for _ in range(2):
            OrderItem.objects.create(
                order=self.order, menu_item=self.item, name="Burger",
                price=Decimal("180.00"), quantity=1, subtotal=Decimal("180.00"),
            )

    def test_totals_recomputed_after_adding_items(self):
        resp = self.client.post(
            f"/api/orders/{self.order.id}/add-items/",
            {"items": [{"menu_item_id": self.item.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        self.order.refresh_from_db()
        self.assertEqual(self.order.subtotal, Decimal("540.00"))
        self.assertEqual(self.order.tax_amount, Decimal("48.60"))
        self.assertEqual(self.order.total_amount, Decimal("588.60"))
        self.assertEqual(self.order.items.count(), 3)

        body = resp.data
        self.assertEqual(Decimal(str(body["subtotal"])), Decimal("540.00"))
        self.assertEqual(Decimal(str(body["tax_amount"])), Decimal("48.60"))
        self.assertEqual(Decimal(str(body["total_amount"])), Decimal("588.60"))
