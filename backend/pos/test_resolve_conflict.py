"""
C-3 regression tests — offline conflict resolution hardening.

Run with: python manage.py test pos.test_resolve_conflict

Verifies that `keep_client` conflict resolution NEVER blindly trusts the
device:
- order total_amount supplied by the client is ignored and recomputed on the
  server from the persisted line items
- order status is validated against model choices and valid transitions
- fulfillment_type / notes are validated and bounded
- payment method/status are allow-listed
- payment amounts must be positive and cannot exceed the order total
  (plus returned cash change)
- entities are merchant-scoped
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem
from pos.models import PosPayment


def _make_merchant(slug="conflict-cafe"):
    user = get_user_model().objects.create_user(
        username=slug, email=f"{slug}@test.com", password="Pass123!", role="merchant"
    )
    merchant = MerchantProfile.objects.create(
        user=user,
        business_name="Conflict Cafe",
        slug=slug,
        is_open=True,
        onboarding_complete=True,
        pos_enabled=True,
        shift_management_enabled=False,
        table_ordering_enabled=True,
    )
    return user, merchant


class ResolveConflictOrderTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user, self.merchant = _make_merchant()
        self.client.force_authenticate(user=self.merchant_user)
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Momo", price=100, is_available=True,
        )
        # Tax-free merchant so subtotal == total.
        self.order = Order.objects.create(
            merchant=self.merchant,
            status=Order.STATUS_PENDING,
            order_type=Order.ORDER_TYPE_REGULAR,
            total_amount=Decimal("200.00"),
            subtotal=Decimal("200.00"),
        )
        OrderItem.objects.create(
            order=self.order,
            menu_item=self.item,
            name="Momo",
            price=Decimal("100.00"),
            quantity=2,
            subtotal=Decimal("200.00"),
        )

    def _resolve(self, client_data, resolution="keep_client"):
        return self.client.post(
            "/api/pos/conflicts/resolve/",
            data={
                "entity_type": "order",
                "entity_id": self.order.id,
                "resolution": resolution,
                "client_data": client_data,
            },
            format="json",
        )

    def test_client_supplied_total_is_ignored_and_recomputed(self):
        resp = self._resolve({"total_amount": 999999, "status": "confirmed"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        # Server recomputed the total from items — never 999999.
        self.assertEqual(self.order.subtotal, Decimal("200.00"))
        from config.tax_utils import calculate_tax
        expected_tax, _ = calculate_tax(Decimal("200.00"), self.merchant)
        self.assertEqual(self.order.total_amount, Decimal("200.00") + expected_tax)

    def test_invalid_status_rejected(self):
        resp = self._resolve({"status": "hacked"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_status_transition_rejected(self):
        # pending -> completed is not a valid transition.
        resp = self._resolve({"status": "completed"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_PENDING)

    def test_valid_status_transition_applied(self):
        resp = self._resolve({"status": "confirmed"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_CONFIRMED)
        self.assertEqual(self.order.source, "pos_offline_resolved")

    def test_invalid_fulfillment_type_rejected(self):
        resp = self._resolve({"fulfillment_type": "teleport"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_valid_fulfillment_type_applied(self):
        resp = self._resolve({"fulfillment_type": "dine_in"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.fulfillment_type, "dine_in")

    def test_keep_server_does_not_modify_order(self):
        original_total = self.order.total_amount
        resp = self._resolve(
            {"status": "completed", "total_amount": 999999},
            resolution="keep_server",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, Order.STATUS_PENDING)
        self.assertEqual(self.order.total_amount, original_total)


class ResolveConflictPaymentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.merchant_user, self.merchant = _make_merchant(slug="conflict-pay")
        self.client.force_authenticate(user=self.merchant_user)
        self.order = Order.objects.create(
            merchant=self.merchant,
            status=Order.STATUS_CONFIRMED,
            order_type=Order.ORDER_TYPE_REGULAR,
            total_amount=Decimal("500.00"),
            subtotal=Decimal("500.00"),
        )
        self.payment = PosPayment.objects.create(
            merchant=self.merchant,
            order=self.order,
            payment_method=PosPayment.METHOD_CASH,
            amount=Decimal("500.00"),
            status=PosPayment.STATUS_COMPLETED,
            sync_status="conflict",
            client_mutation_id="11111111-1111-1111-1111-111111111111",
        )

    def _resolve(self, client_data):
        return self.client.post(
            "/api/pos/conflicts/resolve/",
            data={
                "entity_type": "payment",
                "entity_id": str(self.payment.id),
                "resolution": "keep_client",
                "client_data": client_data,
            },
            format="json",
        )

    def test_payment_amount_cannot_exceed_order_total(self):
        resp = self._resolve({"amount": "999999.00"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount, Decimal("500.00"))

    def test_cash_with_change_can_exceed_total(self):
        # Tendering Rs 800 for a Rs 500 order with Rs 300 change is legitimate.
        self.payment.change_amount = Decimal("300.00")
        self.payment.save(update_fields=["change_amount"])
        resp = self._resolve({"amount": "800.00"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.amount, Decimal("800.00"))

    def test_invalid_payment_method_rejected(self):
        resp = self._resolve({"payment_method": "hamster"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_status_rejected(self):
        resp = self._resolve({"status": "shipped"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_valid_payment_fields_applied(self):
        resp = self._resolve({
            "payment_method": "card",
            "status": "completed",
            "amount": "500.00",
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.payment_method, "card")
        self.assertEqual(self.payment.status, "completed")
        self.assertEqual(self.payment.sync_status, "resolved")


class ResolveConflictScopingTests(TestCase):
    def test_order_and_payment_are_merchant_scoped(self):
        user, merchant = _make_merchant(slug="conflict-owner")
        other_user, other_merchant = _make_merchant(slug="conflict-stranger")

        order = Order.objects.create(
            merchant=other_merchant,
            status=Order.STATUS_PENDING,
            total_amount=Decimal("10.00"),
            subtotal=Decimal("10.00"),
        )
        payment = PosPayment.objects.create(
            merchant=other_merchant,
            order=order,
            payment_method=PosPayment.METHOD_CASH,
            amount=Decimal("10.00"),
            status=PosPayment.STATUS_COMPLETED,
            client_mutation_id="22222222-2222-2222-2222-222222222222",
        )

        client = APIClient()
        client.force_authenticate(user=user)

        resp = client.post(
            "/api/pos/conflicts/resolve/",
            data={
                "entity_type": "order",
                "entity_id": order.id,
                "resolution": "keep_client",
                "client_data": {"status": "confirmed"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

        resp = client.post(
            "/api/pos/conflicts/resolve/",
            data={
                "entity_type": "payment",
                "entity_id": str(payment.id),
                "resolution": "keep_client",
                "client_data": {"status": "completed"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)