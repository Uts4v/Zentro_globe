"""
Punch card reward claims must not count as loyalty activity.

Run with: python manage.py test loyalty.test_punch_reward_claim

Claiming a completed punch card's free reward creates a zero-value
"punch_card_redemption" order. Completing that order must keep it in the
customer's history but must NOT punch the next card, bump the wallet's
order count or visit streak, or advance missions.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile, User
from loyalty.models import (
    CustomerMerchantWallet,
    CustomerMission,
    CustomerPunchCard,
    MerchantPunchCard,
    Mission,
    PunchCardEvent,
)
from merchants.models import MerchantProfile
from orders.models import Order


class PunchRewardClaimTests(TestCase):
    def setUp(self):
        self.merchant_user = User.objects.create_user(
            username="claim-merchant", email="claim-merchant@test.com",
            password="pass1234", role=User.ROLE_MERCHANT,
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Claim Cafe", slug="claim-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        self.customer_user = User.objects.create_user(
            username="claim-customer", email="claim-customer@test.com",
            password="pass1234", role=User.ROLE_CUSTOMER,
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Claim Customer",
        )
        self.template = MerchantPunchCard.objects.create(
            merchant=self.merchant, name="Buy 2 Get 1",
            mode=MerchantPunchCard.MODE_PER_ORDER, stamps_required=2,
            reward_text="Free coffee",
        )
        self.mission = Mission.objects.create(
            title="Order 5 times", mission_type="order_count",
            target_count=5, reward_points=10, required_merchant=self.merchant,
        )
        self.merchant_client = APIClient()
        self.merchant_client.force_authenticate(self.merchant_user)
        self.customer_client = APIClient()
        self.customer_client.force_authenticate(self.customer_user)

        # Two regular completed orders fill the card.
        for _ in range(2):
            order = Order.objects.create(
                customer=self.customer, merchant=self.merchant,
                status=Order.STATUS_CONFIRMED, total_amount=100, subtotal=100,
            )
            self._complete_via_dashboard(order)

        self.completed_card = CustomerPunchCard.objects.get(
            customer=self.customer, punch_card=self.template, is_completed=True,
        )
        self.baseline = self._progress()

    def _complete_via_dashboard(self, order):
        if order.status == Order.STATUS_PENDING:
            resp = self.merchant_client.patch(
                f"/api/orders/{order.id}/update-status/", {"status": "confirmed"}, format="json",
            )
            self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.merchant_client.patch(
            f"/api/orders/{order.id}/update-status/", {"status": "completed"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def _progress(self):
        wallet = CustomerMerchantWallet.objects.get(customer=self.customer, merchant=self.merchant)
        mission = CustomerMission.objects.get(customer=self.customer, mission=self.mission)
        return {
            "order_count": wallet.order_count,
            "streak_days": wallet.streak_days,
            "points_balance": wallet.points_balance,
            "mission_count": mission.current_count,
            "punches": PunchCardEvent.objects.filter(
                customer=self.customer, event_type=PunchCardEvent.EVENT_PUNCHED,
            ).count(),
        }

    def _claim(self):
        resp = self.customer_client.post(
            f"/api/loyalty/punch-cards/{self.completed_card.id}/generate-proof/",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.merchant_client.post(
            "/api/loyalty/punch-cards/confirm-proof/",
            {"proof_code": resp.data["proof_code"]}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        return Order.objects.get(id=resp.data["order_id"])

    def _next_card(self):
        return CustomerPunchCard.objects.get(
            customer=self.customer, punch_card=self.template, is_completed=False,
        )

    def assert_claim_not_counted(self, claim):
        claim.refresh_from_db()
        self.assertEqual(claim.status, Order.STATUS_COMPLETED)
        self.assertEqual(self._progress(), self.baseline)
        self.assertEqual(self._next_card().current_stamps, 0)
        # Still recorded for history / audit.
        self.assertTrue(
            PunchCardEvent.objects.filter(
                card=self.completed_card, event_type=PunchCardEvent.EVENT_REDEEMED, order=claim,
            ).exists()
        )
        self.assertIn(
            claim.id,
            [o["id"] for o in self.customer_client.get("/api/orders/my-orders/").data],
        )

    def test_baseline_regular_orders_do_count(self):
        self.assertEqual(self.baseline["order_count"], 2)
        self.assertEqual(self.baseline["mission_count"], 2)
        self.assertEqual(self.baseline["punches"], 2)

    def test_claim_completed_from_dashboard_is_not_loyalty_activity(self):
        claim = self._claim()
        self._complete_via_dashboard(claim)
        self.assert_claim_not_counted(claim)

    def test_claim_completed_from_pos_is_not_loyalty_activity(self):
        claim = self._claim()
        for new_status in ("confirmed", "completed"):
            resp = self.merchant_client.post(
                "/api/pos/order/status/",
                {"order_id": str(claim.uuid), "status": new_status}, format="json",
            )
            self.assertEqual(resp.status_code, 200, resp.data)
        self.assert_claim_not_counted(claim)

    def test_next_regular_order_still_punches_the_new_card(self):
        claim = self._claim()
        self._complete_via_dashboard(claim)
        order = Order.objects.create(
            customer=self.customer, merchant=self.merchant,
            status=Order.STATUS_CONFIRMED, total_amount=100, subtotal=100,
        )
        self._complete_via_dashboard(order)
        self.assertEqual(self._next_card().current_stamps, 1)
        self.assertEqual(self._progress()["order_count"], self.baseline["order_count"] + 1)
        self.assertEqual(self._progress()["mission_count"], self.baseline["mission_count"] + 1)
