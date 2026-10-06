"""
Tests for the POS loyalty redemption routes.

Staff working a terminal must be able to hand over a punch card reward and a
points reward without a merchant dashboard login, but only when their role
allows it: a free item costs the merchant money, so the same `rewards.manage`
permission that guards the dashboard guards the terminal.
"""

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from django.contrib.auth import get_user_model
from accounts.models import CustomerProfile
from merchants.models import MerchantProfile
from orders.models import Order
from pos.models import PosAuditLog, ShiftWorker, StaffRole
from pos import rbac
from loyalty.models import (
    CustomerMerchantWallet,
    CustomerPunchCard,
    MerchantPunchCard,
    PointTransaction,
    Redemption,
    Reward,
)


def make_merchant(username, email, business_name, slug, customer_email=None,
                  customer_name="Asha Rai", phone="9800000001"):
    """A merchant with an approved POS, plus one enrolled customer."""
    user = get_user_model().objects.create_user(
        username=username, email=email, password="Owner123!", role="merchant",
    )
    merchant = MerchantProfile.objects.create(
        user=user,
        business_name=business_name,
        slug=slug,
        is_approved=True,
        is_open=True,
        pos_enabled=True,
    )
    rbac.ensure_default_roles(merchant)
    customer = CustomerProfile.objects.create(
        user=get_user_model().objects.create_user(
            username=f"{slug}-customer",
            email=customer_email or f"{slug}-customer@test.com",
            password="Customer123!",
            role="customer",
        ),
        full_name=customer_name,
    )
    return user, merchant, customer


def staff_client_for(worker):
    """A client authenticated only by a staff token, like a real terminal."""
    client = APIClient()
    token = rbac.issue_staff_token(worker)
    client.credentials(
        HTTP_AUTHORIZATION=f"Staff {token}", HTTP_X_ZENTRO_STAFF=token,
    )
    return client


class PosLoyaltyRedeemTestCase(APITestCase):
    def setUp(self):
        self.owner, self.merchant, self.customer = make_merchant(
            "lr-owner", "lr-owner@test.com", "Counter Cafe", "counter-cafe",
        )
        roles = StaffRole.objects.filter(merchant=self.merchant)

        # A manager may redeem; a plain cashier may not.
        self.manager = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Manager", staff_code="4001",
            pin_hash="", role="manager", is_active=True,
        )
        self.manager.set_pin("1357")
        self.manager.save()
        rbac.assign_role(self.manager, roles.get(system_key="manager"))

        self.cashier = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Cashier", staff_code="4002",
            pin_hash="", role="cashier", is_active=True,
        )
        self.cashier.set_pin("2468")
        self.cashier.save()
        rbac.assign_role(self.cashier, roles.get(system_key="cashier"))

        self.client = APIClient()

    # â”€â”€ punch cards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _completed_card(self, proof_code="ABC123"):
        template = MerchantPunchCard.objects.create(
            merchant=self.merchant,
            name="Coffee Club",
            mode="per_order",
            stamps_required=3,
            reward_text="Free coffee",
        )
        card = CustomerPunchCard.objects.create(
            customer=self.customer,
            punch_card=template,
            merchant=self.merchant,
            current_stamps=3,
            is_completed=True,
            completed_at=timezone.now(),
            proof_code=proof_code,
            proof_code_expires_at=timezone.now() + timedelta(minutes=30),
            proof_code_used=False,
        )
        return card

    def test_manager_confirms_punch_card_and_starts_next_card(self):
        self._completed_card()
        response = staff_client_for(self.manager).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"proof_code": "abc123", "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["reward_text"], "Free coffee")
        self.assertEqual(response.data["customer_name"], "Asha Rai")

        # A zero-value reward order exists so the item shows on KDS/receipts.
        order = Order.objects.get(id=response.data["order_id"])
        self.assertEqual(order.order_type, Order.ORDER_TYPE_PUNCH_REDEMPTION)
        self.assertEqual(order.total_amount, 0)

        # The spent card is marked used and a fresh one is running.
        card = CustomerPunchCard.objects.get(
            customer=self.customer, is_completed=True,
        )
        self.assertTrue(card.is_redeemed)
        self.assertTrue(card.proof_code_used)
        self.assertIsNotNone(card.redeemed_at)
        self.assertEqual(
            CustomerPunchCard.objects.filter(
                customer=self.customer, current_stamps=0, is_completed=False,
            ).count(),
            1,
        )

    def test_punch_card_confirm_is_audited_to_the_employee(self):
        self._completed_card("XYZ789")
        staff_client_for(self.manager).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"proof_code": "XYZ789", "worker_id": str(self.manager.id)},
            format="json",
        )
        log = PosAuditLog.objects.filter(
            action=PosAuditLog.ACTION_PUNCH_CARD_REDEEM,
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.worker_id, self.manager.id)
        self.assertEqual(log.metadata["customer_name"], "Asha Rai")

    def test_used_punch_card_code_cannot_be_redeemed_twice(self):
        self._completed_card("DUP01")
        staff = staff_client_for(self.manager)
        payload = {"proof_code": "DUP01", "worker_id": str(self.manager.id)}
        self.assertEqual(staff.post("/api/pos/loyalty/punch-cards/confirm/",
                                    payload, format="json").status_code, 200)
        # Second attempt must fail: the code is consumed.
        self.assertEqual(staff.post("/api/pos/loyalty/punch-cards/confirm/",
                                    payload, format="json").status_code, 404)

    def test_expired_punch_card_code_is_rejected(self):
        card = self._completed_card("EXP123")
        card.proof_code_expires_at = timezone.now() - timedelta(minutes=1)
        card.save(update_fields=["proof_code_expires_at"])
        response = staff_client_for(self.manager).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"proof_code": "EXP123", "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response.data["error"].lower())

    def test_cashier_cannot_confirm_a_punch_card(self):
        self._completed_card()
        response = staff_client_for(self.cashier).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"proof_code": "ABC123", "worker_id": str(self.cashier.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "no_permission")
        self.assertEqual(response.data["required_permission"], "rewards.manage")

    def test_punch_card_code_from_another_merchant_is_not_found(self):
        self._completed_card("OTHER1")
        _, other_merchant, _ = make_merchant(
            "lr-other", "lr-other@test.com", "Other Cafe", "other-cafe",
        )
        other_worker = ShiftWorker.objects.create(
            merchant=other_merchant, display_name="Other Manager",
            staff_code="4100", pin_hash="", role="manager", is_active=True,
        )
        other_worker.set_pin("1357")
        other_worker.save()
        rbac.assign_role(
            other_worker,
            StaffRole.objects.get(merchant=other_merchant, system_key="manager"),
        )
        response = staff_client_for(other_worker).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"proof_code": "OTHER1", "worker_id": str(other_worker.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_punch_card_confirm_requires_a_code(self):
        response = staff_client_for(self.manager).post(
            "/api/pos/loyalty/punch-cards/confirm/",
            {"worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # â”€â”€ rewards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _pending_redemption(self, code="RW1234"):
        reward = Reward.objects.create(
            merchant=self.merchant,
            name="Free pastry",
            points_cost=50,
            stock=5,
        )
        return Redemption.objects.create(
            customer=self.customer,
            reward=reward,
            points_spent=50,
            code=code,
            status=Redemption.STATUS_PENDING,
            expires_at=timezone.now() + timedelta(minutes=10),
        )

    def test_manager_confirms_reward_redemption(self):
        redemption = self._pending_redemption()
        response = staff_client_for(self.manager).post(
            "/api/pos/loyalty/rewards/confirm/",
            {"code": "rw1234", "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["reward_name"], "Free pastry")
        self.assertEqual(response.data["points_spent"], 50)

        redemption.refresh_from_db()
        self.assertEqual(redemption.status, Redemption.STATUS_CONFIRMED)
        self.assertIsNotNone(redemption.confirmed_at)

    def test_reward_confirm_is_audited(self):
        self._pending_redemption("AUD123")
        staff_client_for(self.manager).post(
            "/api/pos/loyalty/rewards/confirm/",
            {"code": "AUD123", "worker_id": str(self.manager.id)},
            format="json",
        )
        log = PosAuditLog.objects.filter(
            action=PosAuditLog.ACTION_REWARD_REDEEM,
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.worker_id, self.manager.id)
        self.assertEqual(log.metadata["points_spent"], 50)

    def test_reward_code_cannot_be_confirmed_twice(self):
        self._pending_redemption("TWICE1")
        staff = staff_client_for(self.manager)
        payload = {"code": "TWICE1", "worker_id": str(self.manager.id)}
        self.assertEqual(staff.post("/api/pos/loyalty/rewards/confirm/",
                                    payload, format="json").status_code, 200)
        self.assertEqual(staff.post("/api/pos/loyalty/rewards/confirm/",
                                    payload, format="json").status_code, 404)

    def test_expired_reward_code_is_rejected_and_marked(self):
        redemption = self._pending_redemption("EXP999")
        redemption.expires_at = timezone.now() - timedelta(minutes=1)
        redemption.save(update_fields=["expires_at"])
        response = staff_client_for(self.manager).post(
            "/api/pos/loyalty/rewards/confirm/",
            {"code": "EXP999", "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        redemption.refresh_from_db()
        self.assertEqual(redemption.status, Redemption.STATUS_EXPIRED)

    def test_cashier_cannot_confirm_a_reward(self):
        self._pending_redemption()
        response = staff_client_for(self.cashier).post(
            "/api/pos/loyalty/rewards/confirm/",
            {"code": "RW1234", "worker_id": str(self.cashier.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    # â”€â”€ history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _record_points(self, points, transaction_type="REDEEMED",
                       description="Free pastry", merchant=None):
        merchant = merchant or self.merchant
        wallet, _ = CustomerMerchantWallet.objects.get_or_create(
            merchant=merchant, customer=self.customer,
        )
        return PointTransaction.objects.create(
            merchant=merchant,
            customer=self.customer,
            wallet=wallet,
            transaction_type=transaction_type,
            points=points,
            balance_before=100,
            balance_after=100 + points,
            description=description,
        )

    def test_staff_can_read_point_transactions(self):
        self._record_points(-50)
        response = staff_client_for(self.cashier).get(
            "/api/pos/loyalty/transactions/",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["points"], -50)
        self.assertEqual(response.data[0]["customer_name"], "Asha Rai")

    def test_transactions_are_scoped_to_this_merchant(self):
        _, other_merchant, _ = make_merchant(
            "lr-hist", "lr-hist@test.com", "Hist Cafe", "hist-cafe",
        )
        self._record_points(10, transaction_type="EARNED",
                            merchant=other_merchant)
        response = staff_client_for(self.cashier).get(
            "/api/pos/loyalty/transactions/",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    def test_transactions_require_a_staff_session(self):
        self.assertEqual(self.client.get(
            "/api/pos/loyalty/transactions/",
        ).status_code, 401)