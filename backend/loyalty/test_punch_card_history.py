"""
Punch card history — audit-trail tests.

Run with: python manage.py test loyalty.test_punch_card_history

Verifies:
- STARTED / PUNCHED / COMPLETED / REDEEMED events are written at each
  lifecycle step of a customer's punch card journey
- each punch event preserves which order earned it and its stamp number
- the merchant history endpoint returns summary counters + a filtrable,
  categorize-able event feed (event type, card template, customer name)
- non-merchant users cannot read the history endpoint
"""

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import User, CustomerProfile
from merchants.models import MerchantProfile
from loyalty.models import MerchantPunchCard, CustomerPunchCard, PunchCardEvent
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


class PunchCardEventModelTests(TestCase):
    def setUp(self):
        self.customer_user, self.customer = _create_customer("alice", "alice@example.com")
        self.merchant_user, self.merchant = _create_merchant(
            "shopkeeper", "shop@test.com", "Cafe Aroma", "cafe-aroma",
        )
        self.template = MerchantPunchCard.objects.create(
            merchant=self.merchant,
            name="Buy 5 Get 1",
            mode=MerchantPunchCard.MODE_PER_ORDER,
            stamps_required=5,
            reward_text="Free coffee",
        )
        self.card = CustomerPunchCard.objects.create(
            customer=self.customer,
            punch_card=self.template,
            merchant=self.merchant,
            current_stamps=0,
        )

    def test_record_event_writes_immutable_audit(self):
        event = self.card.record_event(PunchCardEvent.EVENT_STARTED, note="journey start")
        self.assertEqual(event.event_type, PunchCardEvent.EVENT_STARTED)
        self.assertEqual(event.card_id, self.card.id)
        self.assertEqual(event.merchant_id, self.merchant.id)
        self.assertEqual(event.customer_id, self.customer.id)
        self.assertIsNone(event.order_id)
        self.assertIsNone(event.stamp_number)

    def test_add_punch_writes_punch_and_complete_events(self):
        for _ in range(4):
            self.assertFalse(self.card.add_punch())
        self.assertEqual(
            self.card.events.filter(event_type=PunchCardEvent.EVENT_PUNCHED).count(), 4,
        )
        self.assertFalse(
            self.card.events.filter(event_type=PunchCardEvent.EVENT_COMPLETED).exists(),
        )

        self.assertTrue(self.card.add_punch())
        self.assertEqual(
            self.card.events.filter(event_type=PunchCardEvent.EVENT_PUNCHED).count(), 5,
        )
        self.assertTrue(
            self.card.events.filter(event_type=PunchCardEvent.EVENT_COMPLETED).exists(),
        )

        stamps = sorted(
            self.card.events
            .filter(event_type=PunchCardEvent.EVENT_PUNCHED)
            .values_list("stamp_number", flat=True),
        )
        self.assertEqual(stamps, [1, 2, 3, 4, 5])

    def test_punch_event_references_earned_order(self):
        order = Order.objects.create(
            customer=self.customer,
            merchant=self.merchant,
            status=Order.STATUS_PENDING,
            total_amount=100,
            points_earned=0,
        )
        self.card.add_punch(order=order)
        event = self.card.events.get(event_type=PunchCardEvent.EVENT_PUNCHED)
        self.assertEqual(event.order_id, order.id)

    def test_redeem_writes_claimed_event(self):
        for _ in range(5):
            self.card.add_punch()
        order = Order.objects.create(
            customer=self.customer,
            merchant=self.merchant,
            status=Order.STATUS_PENDING,
            order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
            total_amount=0,
            points_earned=0,
            punch_card_redemption=self.card,
        )
        self.card.redeem(order=order)
        event = self.card.events.get(event_type=PunchCardEvent.EVENT_REDEEMED)
        self.assertEqual(event.order_id, order.id)
        self.assertEqual(event.stamp_number, self.template.stamps_required)


class MerchantPunchCardHistoryApiTests(TestCase):
    def setUp(self):
        self.customer_user, self.customer = _create_customer("alice", "alice@example.com")
        self.merchant_user, self.merchant = _create_merchant(
            "shopkeeper", "shop@test.com", "Cafe Aroma", "cafe-aroma",
        )
        self.template = MerchantPunchCard.objects.create(
            merchant=self.merchant,
            name="Buy 5 Get 1",
            mode=MerchantPunchCard.MODE_PER_ORDER,
            stamps_required=5,
            reward_text="Free coffee",
        )
        self.client = APIClient()

        # Customer starts their journey (GET auto-initializes progress).
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.get(f"/api/loyalty/punch-cards/?merchant={self.merchant.id}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.card = CustomerPunchCard.objects.get(customer=self.customer, punch_card=self.template)
        self.client.force_authenticate(user=None)

    def _complete_and_claim(self):
        order = Order.objects.create(
            customer=self.customer,
            merchant=self.merchant,
            status=Order.STATUS_PENDING,
            order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
            total_amount=0,
            points_earned=0,
            punch_card_redemption=self.card,
        )
        for _ in range(self.template.stamps_required):
            self.card.add_punch(order=order)
        self.card.redeem(order=order)
        return order

    def test_history_summary_and_events(self):
        self._complete_and_claim()
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.get("/api/loyalty/merchant/punch-cards/history/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        data = resp.json()
        self.assertEqual(data["summary"]["cards_started"], 1)
        self.assertEqual(data["summary"]["punches_awarded"], 5)
        self.assertEqual(data["summary"]["cards_completed"], 1)
        self.assertEqual(data["summary"]["claimed"], 1)

        types = [e["event_type"] for e in data["events"]]
        self.assertIn(PunchCardEvent.EVENT_STARTED, types)
        self.assertEqual(types.count(PunchCardEvent.EVENT_PUNCHED), 5)
        self.assertIn(PunchCardEvent.EVENT_COMPLETED, types)
        self.assertIn(PunchCardEvent.EVENT_REDEEMED, types)

        punch = next(e for e in data["events"] if e["event_type"] == PunchCardEvent.EVENT_PUNCHED)
        self.assertIsNotNone(punch["order_id"])
        self.assertEqual(punch["customer_name"], "Alice")
        self.assertEqual(punch["card_name"], "Buy 5 Get 1")
        self.assertEqual(punch["stamps_required"], 5)
        self.assertEqual(punch["card_state"]["current_stamps"], 5)
        self.assertTrue(punch["card_state"]["is_redeemed"])

    def test_history_filter_by_event_type(self):
        self._complete_and_claim()
        self.client.force_authenticate(user=self.merchant_user)
        resp = self.client.get(
            "/api/loyalty/merchant/punch-cards/history/",
            {"event_type": PunchCardEvent.EVENT_REDEEMED},
        )
        data = resp.json()
        self.assertEqual(
            [e["event_type"] for e in data["events"]],
            [PunchCardEvent.EVENT_REDEEMED],
        )

    def test_history_filter_by_card_and_customer(self):
        self._complete_and_claim()
        self.client.force_authenticate(user=self.merchant_user)

        resp = self.client.get(
            "/api/loyalty/merchant/punch-cards/history/",
            {"card": str(self.template.id)},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(len(resp.json()["events"]) > 0)

        resp = self.client.get(
            "/api/loyalty/merchant/punch-cards/history/",
            {"customer": "Alice"},
        )
        self.assertTrue(len(resp.json()["events"]) > 0)

        resp = self.client.get(
            "/api/loyalty/merchant/punch-cards/history/",
            {"customer": "no-such-customer"},
        )
        self.assertEqual(len(resp.json()["events"]), 0)

    def test_history_requires_merchant(self):
        self.client.force_authenticate(user=self.customer_user)
        resp = self.client.get("/api/loyalty/merchant/punch-cards/history/")
        self.assertIn(resp.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN))