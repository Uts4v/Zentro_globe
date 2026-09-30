"""
Regression tests for the reward loop: a reward never earns another reward.

Run with: python manage.py test loyalty.test_reward_loop

A product received through a punch-card reward, loyalty reward, free-item
offer, Buy X Get Y, voucher, comp or any 100%-discounted reward must not earn
points, punches, qualifying order count, streak or mission progress — and so
can never trigger the next reward. Loyalty is calculated from eligible PAID
order lines (loyalty.earning), not from the existence of an order.
"""

from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile, User
from loyalty.earning import (
    REASON_NOT_PAID,
    REASON_REWARD_LINE,
    REASON_REWARD_ORDER,
    REASON_REWARD_UNITS,
    compute_loyalty_earning,
    estimate_points,
)
from loyalty.models import (
    CustomerMerchantWallet,
    CustomerMission,
    CustomerPunchCard,
    MerchantPunchCard,
    Mission,
    PunchCardEvent,
    Reward,
)
from merchants.models import MenuItem, MerchantProfile
from orders.models import Order, OrderAdjustment, OrderAdjustmentAllocation, OrderItem
from orders.views import _award_loyalty


class RewardLoopBase(TestCase):
    def setUp(self):
        self.merchant_user = User.objects.create_user(
            username="loop-merchant", email="loop-merchant@test.com",
            password="pass1234", role=User.ROLE_MERCHANT,
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Loop Cafe", slug="loop-cafe",
            is_approved=True, is_open=True, pos_enabled=True,
        )
        self.customer_user = User.objects.create_user(
            username="loop-customer", email="loop-customer@test.com",
            password="pass1234", role=User.ROLE_CUSTOMER,
        )
        self.customer = CustomerProfile.objects.create(user=self.customer_user, full_name="Loop Customer")
        self.coffee = MenuItem.objects.create(
            merchant=self.merchant, name="Coffee", price=100, is_available=True,
            loyalty_reward=True, points_per_item=5,
        )
        self.cake = MenuItem.objects.create(
            merchant=self.merchant, name="Cake", price=200, is_available=True,
            loyalty_reward=True, points_per_item=10,
        )
        self.card_template = MerchantPunchCard.objects.create(
            merchant=self.merchant, name="Buy 2 Get 1 Coffee",
            mode=MerchantPunchCard.MODE_PER_ORDER, stamps_required=2, reward_text="Free coffee",
        )
        self.count_mission = Mission.objects.create(
            title="Order 5 times", mission_type="order_count",
            target_count=5, reward_points=10, required_merchant=self.merchant,
        )
        self.spend_mission = Mission.objects.create(
            title="Spend 10000", mission_type="spend_amount",
            target_count=10000, reward_points=10, required_merchant=self.merchant,
        )
        self.merchant_client = APIClient()
        self.merchant_client.force_authenticate(self.merchant_user)
        self.customer_client = APIClient()
        self.customer_client.force_authenticate(self.customer_user)

    # ── builders ──────────────────────────────────────────────────────────
    def make_order(self, lines, *, order_type=Order.ORDER_TYPE_REGULAR, spend_rate=Decimal("0"),
                   status=Order.STATUS_CONFIRMED, **extra):
        """lines: (menu_item, qty, unit_price, discount, is_reward)"""
        order = Order.objects.create(
            customer=self.customer, merchant=self.merchant, status=status,
            order_type=order_type, total_amount=0, subtotal=0,
            loyalty_spend_rate=spend_rate, **extra,
        )
        for menu_item, qty, price, discount, is_reward in lines:
            price = Decimal(str(price))
            discount = Decimal(str(discount))
            OrderItem.objects.create(
                order=order, menu_item=menu_item, name=menu_item.name if menu_item else "Reward",
                price=price, list_unit_price=price, quantity=qty, subtotal=price * qty,
                discount_amount=discount, taxable_amount=price * qty - discount,
                total_amount=price * qty - discount, is_promotion_reward=is_reward,
            )
        return order

    def complete(self, order):
        resp = self.merchant_client.patch(
            f"/api/orders/{order.id}/update-status/", {"status": "completed"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        return order

    def wallet(self):
        return CustomerMerchantWallet.objects.filter(customer=self.customer, merchant=self.merchant).first()

    def progress(self):
        wallet = self.wallet()
        count = CustomerMission.objects.filter(customer=self.customer, mission=self.count_mission).first()
        spend = CustomerMission.objects.filter(customer=self.customer, mission=self.spend_mission).first()
        return {
            "points": wallet.points_balance if wallet else 0,
            "order_count": wallet.order_count if wallet else 0,
            "punches": PunchCardEvent.objects.filter(
                customer=self.customer, event_type=PunchCardEvent.EVENT_PUNCHED,
            ).count(),
            "count_mission": count.current_count if count else 0,
            "spend_mission": spend.current_count if spend else 0,
        }


class PunchCardRewardLoopTests(RewardLoopBase):
    """The core loop: claiming the free coffee must not start the next card."""

    def fill_card(self):
        for _ in range(2):
            self.complete(self.make_order([(self.coffee, 1, 100, 0, False)]))
        return CustomerPunchCard.objects.get(
            customer=self.customer, punch_card=self.card_template, is_completed=True,
        )

    def claim(self, card):
        resp = self.customer_client.post(f"/api/loyalty/punch-cards/{card.id}/generate-proof/")
        self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.merchant_client.post(
            "/api/loyalty/punch-cards/confirm-proof/", {"proof_code": resp.data["proof_code"]}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        return Order.objects.get(id=resp.data["order_id"])

    def test_claimed_reward_never_creates_first_punch_on_next_card(self):
        card = self.fill_card()
        before = self.progress()
        claim = self.claim(card)
        self.assertTrue(claim.is_reward_order)
        self.assertTrue(claim.items.get().is_promotion_reward)

        # Fulfil the free coffee exactly like a normal order.
        resp = self.merchant_client.patch(
            f"/api/orders/{claim.id}/update-status/", {"status": "confirmed"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        claim = self.complete(claim)

        next_card = CustomerPunchCard.objects.get(
            customer=self.customer, punch_card=self.card_template, is_completed=False,
        )
        self.assertEqual(next_card.current_stamps, 0, "A redeemed reward must not punch the next card")
        self.assertFalse(PunchCardEvent.objects.filter(
            order=claim, event_type=PunchCardEvent.EVENT_PUNCHED).exists())
        self.assertEqual(self.progress(), before)
        self.assertEqual(claim.points_earned, 0)
        self.assertTrue(claim.loyalty_awarded)

    def test_next_card_starts_only_with_a_new_paid_purchase(self):
        card = self.fill_card()
        claim = self.claim(card)
        self.merchant_client.patch(f"/api/orders/{claim.id}/update-status/", {"status": "confirmed"}, format="json")
        self.complete(claim)
        self.complete(self.make_order([(self.coffee, 1, 100, 0, False)]))
        next_card = CustomerPunchCard.objects.get(
            customer=self.customer, punch_card=self.card_template, is_completed=False,
        )
        self.assertEqual(next_card.current_stamps, 1)

    def test_full_cycle_cannot_self_perpetuate(self):
        """Repeatedly claiming rewards never completes another card."""
        card = self.fill_card()
        for _ in range(3):
            claim = self.claim(card) if not card.is_redeemed else None
            if claim is None:
                break
            self.merchant_client.patch(
                f"/api/orders/{claim.id}/update-status/", {"status": "confirmed"}, format="json",
            )
            self.complete(claim)
            card.refresh_from_db()
        self.assertEqual(
            CustomerPunchCard.objects.filter(customer=self.customer, is_completed=True).count(), 1,
        )


class LineEligibilityTests(RewardLoopBase):
    def test_mixed_order_earns_only_from_paid_lines(self):
        order = self.make_order([
            (self.cake, 1, 200, 0, False),     # paid
            (self.coffee, 1, 100, 100, True),  # offer's free coffee (reward line)
        ])
        earning = compute_loyalty_earning(order)
        self.assertTrue(earning.qualifies)
        self.assertEqual(earning.points, 10)
        self.assertEqual(earning.eligible_amount, Decimal("200.00"))
        reasons = {ln.name: ln.reason for ln in earning.lines}
        self.assertEqual(reasons["Coffee"], REASON_REWARD_LINE)

        self.complete(order)
        progress = self.progress()
        self.assertEqual(progress["points"], 10)
        self.assertEqual(progress["punches"], 1)       # one paid purchase → one punch
        self.assertEqual(progress["order_count"], 1)
        self.assertEqual(progress["spend_mission"], 200)

    def test_reward_only_order_is_a_fulfilment_with_zero_accrual(self):
        order = self.make_order([(self.coffee, 1, 100, 100, True)])
        order = self.complete(order)
        self.assertEqual(self.progress(), {
            "points": 0, "order_count": 0, "punches": 0, "count_mission": 0, "spend_mission": 0,
        })
        self.assertTrue(order.is_reward_order)
        self.assertEqual(order.points_earned, 0)
        self.assertTrue(order.items.exists(), "The free product stays on the order for KDS/receipts")

    def test_reward_line_earns_nothing_even_if_not_fully_discounted(self):
        """A 50%-off 'get Y' item is still a reward: it never earns."""
        order = self.make_order([(self.coffee, 2, 100, 0, False), (self.cake, 1, 200, 100, True)])
        earning = compute_loyalty_earning(order)
        self.assertEqual(earning.points, 10)  # 2 paid coffees × 5
        self.assertEqual(earning.eligible_amount, Decimal("200.00"))

    def test_bogo_unit_freed_on_ordinary_line_does_not_earn(self):
        """BOGO can make one unit of an ordinary (non-reward) line free."""
        order = self.make_order([(self.coffee, 2, 100, 100, False)])
        adjustment = OrderAdjustment.objects.create(
            order=order, kind="promotion", calc_type="lines", value=0, label="BOGO coffee", amount=100,
        )
        OrderAdjustmentAllocation.objects.create(
            adjustment=adjustment, order_item=order.items.get(), amount=100,
        )
        earning = compute_loyalty_earning(order)
        self.assertEqual(earning.lines[0].eligible_units, 1)
        self.assertEqual(earning.lines[0].reason, REASON_REWARD_UNITS)
        self.assertEqual(earning.points, 5)
        self.assertEqual(earning.eligible_amount, Decimal("100.00"))

    def test_bogo_where_both_units_are_free_does_not_qualify(self):
        order = self.make_order([(self.coffee, 1, 100, 100, False)])
        adjustment = OrderAdjustment.objects.create(
            order=order, kind="punch_reward", calc_type="lines", value=0, label="Free coffee", amount=100,
        )
        OrderAdjustmentAllocation.objects.create(adjustment=adjustment, order_item=order.items.get(), amount=100)
        self.complete(order)
        self.assertEqual(self.progress()["punches"], 0)
        self.assertEqual(self.progress()["order_count"], 0)

    def test_fully_discounted_complimentary_line_does_not_earn(self):
        order = self.make_order([(self.cake, 1, 200, 200, False)])  # 100% manual comp
        earning = compute_loyalty_earning(order)
        self.assertFalse(earning.qualifies)
        self.assertEqual(earning.lines[0].reason, REASON_NOT_PAID)

    def test_partial_discount_still_earns(self):
        order = self.make_order([(self.cake, 1, 200, 50, False)])  # 25% off, still paid
        earning = compute_loyalty_earning(order)
        self.assertTrue(earning.qualifies)
        self.assertEqual(earning.points, 10)
        self.assertEqual(earning.eligible_amount, Decimal("150.00"))

    def test_zero_price_line_does_not_qualify(self):
        order = self.make_order([(self.coffee, 1, 0, 0, False)])
        self.assertFalse(compute_loyalty_earning(order).qualifies)

    def test_order_without_lines_does_not_qualify(self):
        """Qualification comes from paid lines, not the existence of an order."""
        order = Order.objects.create(
            customer=self.customer, merchant=self.merchant, status=Order.STATUS_CONFIRMED,
            total_amount=100, subtotal=100, points_earned=7,
        )
        self.complete(order)
        self.assertEqual(self.progress()["punches"], 0)
        self.assertEqual(self.progress()["points"], 0)

    def test_cancelled_and_refunded_units_do_not_earn(self):
        order = self.make_order([(self.coffee, 3, 100, 0, False), (self.cake, 1, 200, 0, False)])
        coffee_line = order.items.get(name="Coffee")
        coffee_line.refunded_quantity = 1
        coffee_line.save()
        cake_line = order.items.get(name="Cake")
        cake_line.preparation_status = OrderItem.CANCELLED
        cake_line.save()
        earning = compute_loyalty_earning(order)
        self.assertEqual(earning.points, 10)  # 2 remaining coffees × 5
        self.assertEqual(earning.eligible_amount, Decimal("200.00"))

    def test_spend_points_use_only_eligible_paid_amount(self):
        order = self.make_order(
            [(self.cake, 1, 200, 0, False), (self.coffee, 1, 100, 100, True)],
            spend_rate=Decimal("1"),
        )
        earning = compute_loyalty_earning(order)
        self.assertEqual(earning.item_points, 10)
        self.assertEqual(earning.spend_points, 200)  # the free coffee's 100 never counts
        self.assertEqual(earning.points, 210)


class RewardOrderTypeTests(RewardLoopBase):
    def test_staff_comp_order_never_counts(self):
        order = self.make_order([(self.cake, 1, 0, 0, False)], order_type=Order.ORDER_TYPE_STAFF_COMP)
        self.complete(order)
        self.assertEqual(self.progress()["punches"], 0)
        self.assertEqual(self.progress()["order_count"], 0)

    def test_loyalty_reward_redemption_earns_nothing(self):
        wallet = CustomerMerchantWallet.objects.create(
            customer=self.customer, merchant=self.merchant, points_balance=500,
        )
        reward = Reward.objects.create(merchant=self.merchant, name="Free Cake", points_cost=100, is_active=True)
        resp = self.customer_client.post(f"/api/loyalty/rewards/{reward.id}/redeem/")
        self.assertIn(resp.status_code, (200, 201), resp.data)
        order = Order.objects.get(order_type=Order.ORDER_TYPE_REWARD_REDEMPTION)
        self.assertTrue(order.is_reward_order)
        self.assertTrue(order.items.get().is_promotion_reward)
        # Even if loyalty were run for it, nothing is earned.
        earning = compute_loyalty_earning(order)
        self.assertFalse(earning.qualifies)
        self.assertEqual(earning.lines[0].reason, REASON_REWARD_ORDER)
        before = self.progress()
        _award_loyalty(order)
        wallet.refresh_from_db()
        self.assertEqual(self.progress(), before)

    def test_reward_order_with_priced_lines_still_earns_nothing(self):
        """Even a punch-claim order carrying a priced line never earns."""
        order = self.make_order(
            [(self.cake, 1, 200, 0, False)], order_type=Order.ORDER_TYPE_PUNCH_REDEMPTION,
        )
        self.complete(order)
        self.assertEqual(self.progress()["punches"], 0)
        self.assertEqual(self.progress()["points"], 0)


class EstimateTests(RewardLoopBase):
    def test_creation_estimate_excludes_reward_lines(self):
        from orders.pricing import mark_reward, price_request_lines

        priced = price_request_lines(self.merchant, [{"menu_item_id": self.cake.id, "quantity": 1}])
        priced += [mark_reward(p) for p in price_request_lines(
            self.merchant, [{"menu_item_id": self.coffee.id, "quantity": 1}], key_prefix="reward",
        )]
        self.assertEqual(estimate_points(priced), 10)
        self.assertEqual(estimate_points(priced, Decimal("1")), 10 + 200)

    def test_legacy_order_keeps_estimate_minus_reward_lines(self):
        """Orders created before the spend rate existed (rate is null)."""
        order = self.make_order(
            [(self.cake, 1, 200, 0, False), (self.coffee, 1, 100, 100, True)],
            spend_rate=None, points_earned=315,  # 10 + 5 item points + 300 spend points
        )
        self.assertEqual(compute_loyalty_earning(order).points, 310)
