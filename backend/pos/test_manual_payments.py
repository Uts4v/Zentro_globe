"""
Manual payment recording, merchant QR configuration and per-method reporting.

Zentro *records* how a customer paid; it never processes the card or wallet
transaction. These tests lock in that contract:

  * every method (Cash, Card, QR, Bank Transfer, Mobile Wallet, Other) is
    recordable with no external terminal, reader or gateway reference
  * Cash keeps its tender/change behaviour
  * split tender still works and keeps each leg's own method
  * a merchant can enable/disable methods and upload/replace/remove one QR
  * merchant A can never see or use merchant B's QR or method config
  * reports keep every method in its own bucket ??? nothing collapses to Cash

Run with: python manage.py test pos.test_manual_payments
"""

import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from orders.models import Order
from pos.models import (
    CashShift, PosDevice, PosPayment, ShiftWorker,
)


MANUAL_METHODS = [
    PosPayment.METHOD_CASH,
    PosPayment.METHOD_CARD,
    PosPayment.METHOD_BANK_QR,
    PosPayment.METHOD_MOBILE_WALLET,
    PosPayment.METHOD_OTHER,
]


class PaymentTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.user = self.user_model.objects.create_user(
            username="pay-m", email="pay-m@test.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="Payment Cafe", slug="payment-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
        )
        self.other_user = self.user_model.objects.create_user(
            username="pay-o", email="pay-o@test.com", password="Pass123!",
            role="merchant",
        )
        self.other_merchant = MerchantProfile.objects.create(
            user=self.other_user, business_name="Other Cafe", slug="other-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
        )
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Alice", role="cashier",
        )
        self.device = PosDevice.objects.create(
            merchant=self.merchant, name="Till 1", is_active=True,
            device_token_hash="hash-till-1",
        )
        self.client.force_authenticate(self.user)

    # ?????? fixtures ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    def _order(self, amount, merchant=None, status=Order.STATUS_PENDING):
        return Order.objects.create(
            merchant=merchant or self.merchant,
            status=status, total_amount=amount, subtotal=amount,
        )

    def _payment_payload(self, order, method, **overrides):
        payload = {
            "order_id": str(order.uuid),
            "shift_id": str(self._open_shift().id),
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "payment_method": method,
            "amount": str(order.total_amount),
            "client_mutation_id": str(uuid.uuid4()),
        }
        payload.update(overrides)
        return payload

    def _open_shift(self):
        shift, _ = CashShift.objects.get_or_create(
            merchant=self.merchant, opened_by=self.worker, device=self.device,
            defaults={"opened_at": timezone.now(), "status": CashShift.STATUS_OPEN,
                      "opening_cash": Decimal("0")},
        )
        return shift

    def _post_payment(self, order, method, **overrides):
        return self.client.post(
            "/api/pos/payment/create/",
            self._payment_payload(order, method, **overrides),
            format="json",
        )

    def _post_split(self, order, legs):
        shift = self._open_shift()
        return self.client.post(
            "/api/pos/payment/split/",
            {
                "order_id": str(order.uuid),
                "shift_id": str(shift.id),
                "worker_id": str(self.worker.id),
                "device_id": str(self.device.id),
                "client_mutation_id": str(uuid.uuid4()),
                "payments": legs,
            },
            format="json",
        )

    def _enable_qr(self, merchant=None):
        m = merchant or self.merchant
        m.payment_qr_enabled = True
        m.payment_qr_url = "https://cdn.test.com/uploads/merchant-qr.png"
        m.payment_qr_name = "Fonepay QR"
        m.save()
        return m


class ManualPaymentRecordingTests(PaymentTestBase):
    def test_every_method_records_without_external_hardware(self):
        """
        The core fix: no method may demand a terminal, reader or gateway
        reference. Each is confirmed by staff exactly like Cash.
        """
        self._enable_qr()
        for method in MANUAL_METHODS:
            order = self._order(1250)
            with self.subTest(method=method):
                res = self._post_payment(order, method)
                self.assertEqual(res.status_code, 201, res.data)

                record = PosPayment.objects.filter(order=order).first()
                self.assertIsNotNone(record)
                # The chosen method survives, it is not flattened to Cash.
                self.assertEqual(record.payment_method, method)
                self.assertEqual(record.status, PosPayment.STATUS_COMPLETED)
                self.assertEqual(record.amount, Decimal("1250.00"))
                self.assertEqual(record.merchant, self.merchant)
                self.assertEqual(record.worker, self.worker)
                # Nothing external was demanded or stored.
                self.assertEqual(record.external_reference, "")

    def test_card_payment_needs_no_external_reference(self):
        order = self._order(1250)
        res = self._post_payment(order, PosPayment.METHOD_CARD)
        self.assertEqual(res.status_code, 201, res.data)
        record = PosPayment.objects.get(order=order)
        self.assertEqual(record.payment_method, PosPayment.METHOD_CARD)
        self.assertEqual(record.external_reference, "")

    def test_qr_payment_needs_no_external_reference(self):
        self._enable_qr()
        order = self._order(1250)
        res = self._post_payment(order, PosPayment.METHOD_BANK_QR)
        self.assertEqual(res.status_code, 201, res.data)

    def test_optional_reference_is_still_recorded(self):
        order = self._order(1250)
        res = self._post_payment(
            order, PosPayment.METHOD_CARD, external_reference="AUTH-99182",
        )
        self.assertEqual(res.status_code, 201, res.data)
        record = PosPayment.objects.get(order=order)
        self.assertEqual(record.external_reference, "AUTH-99182")

    def test_cash_keeps_tender_and_change_calculation(self):
        order = self._order(1250)
        res = self._post_payment(
            order, PosPayment.METHOD_CASH,
            amount="1500.00", change_amount="250.00",
        )
        self.assertEqual(res.status_code, 201, res.data)
        record = PosPayment.objects.get(order=order)
        self.assertEqual(record.amount, Decimal("1500.00"))
        self.assertEqual(record.change_amount, Decimal("250.00"))
        order.refresh_from_db()
        self.assertEqual(order.status, Order.STATUS_COMPLETED)
        self.assertEqual(order.payment_status, "paid")

    def test_reference_and_note_are_optional(self):
        order = self._order(500)
        res = self._post_payment(order, PosPayment.METHOD_OTHER)
        self.assertEqual(res.status_code, 201, res.data)
        record = PosPayment.objects.get(order=order)
        self.assertEqual(record.external_reference, "")

    def test_repeated_client_mutation_id_is_idempotent(self):
        order = self._order(1250)
        payload = self._payment_payload(order, PosPayment.METHOD_CARD)
        first = self.client.post("/api/pos/payment/create/", payload, format="json")
        second = self.client.post("/api/pos/payment/create/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(PosPayment.objects.filter(order=order).count(), 1)
        self.assertIn(second.status_code, (200, 201), second.data)

    def test_qr_is_rejected_when_no_qr_image_is_configured(self):
        order = self._order(1250)
        res = self._post_payment(order, PosPayment.METHOD_BANK_QR)
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("payment qr", str(res.data).lower())

    def test_qr_is_rejected_when_qr_image_was_removed(self):
        self._enable_qr()
        order = self._order(1250)
        self.assertEqual(
            self._post_payment(order, PosPayment.METHOD_BANK_QR).status_code, 201,
        )

        self.merchant.payment_qr_url = ""
        self.merchant.save()
        order2 = self._order(900)
        res = self._post_payment(order2, PosPayment.METHOD_BANK_QR)
        self.assertEqual(res.status_code, 400, res.data)

    def test_disabled_method_is_rejected(self):
        self.merchant.payment_methods_configured = True
        self.merchant.accepted_payment_methods = ["cash"]
        self.merchant.save()

        order = self._order(1250)
        res = self._post_payment(order, PosPayment.METHOD_CARD)
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("not enabled", str(res.data).lower())

        # Cash still works.
        order2 = self._order(600)
        self.assertEqual(
            self._post_payment(order2, PosPayment.METHOD_CASH).status_code, 201
        )

    def test_split_tender_across_methods_is_preserved(self):
        self._enable_qr()
        order = self._order(1500)
        res = self._post_split(order, [
            {"payment_method": PosPayment.METHOD_CASH,
             "amount": "500.00", "change_amount": "0.00"},
            {"payment_method": PosPayment.METHOD_CARD,
             "amount": "1000.00", "change_amount": "0.00"},
        ])
        self.assertEqual(res.status_code, 201, res.data)

        by_method = {
            p.payment_method: p.amount
            for p in PosPayment.objects.filter(order=order)
        }
        self.assertEqual(by_method[PosPayment.METHOD_CASH], Decimal("500.00"))
        self.assertEqual(by_method[PosPayment.METHOD_CARD], Decimal("1000.00"))

    def test_split_tender_needs_no_external_reference(self):
        self._enable_qr()
        order = self._order(1500)
        res = self._post_split(order, [
            {"payment_method": PosPayment.METHOD_CASH,
             "amount": "500.00", "change_amount": "0.00"},
            {"payment_method": PosPayment.METHOD_BANK_QR,
             "amount": "1000.00", "change_amount": "0.00"},
        ])
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(
            PosPayment.objects.filter(
                order=order, payment_method=PosPayment.METHOD_BANK_QR
            ).count(),
            1,
        )


class MerchantPaymentSettingsTests(PaymentTestBase):
    def test_settings_expose_accepted_methods_and_qr(self):
        self._enable_qr()
        res = self.client.get("/api/pos/settings/")
        self.assertEqual(res.status_code, 200, res.data)
        keys = [m["key"] for m in res.data["payment_methods"]]
        self.assertIn(PosPayment.METHOD_CASH, keys)
        self.assertIn(PosPayment.METHOD_CARD, keys)
        self.assertIn(PosPayment.METHOD_BANK_QR, keys)
        self.assertNotIn(PosPayment.METHOD_SPLIT, keys)
        self.assertEqual(res.data["payment_qr"]["url"],
                         "https://cdn.test.com/uploads/merchant-qr.png")
        self.assertEqual(res.data["payment_qr"]["name"], "Fonepay QR")

    def test_qr_is_hidden_from_methods_when_not_configured(self):
        res = self.client.get("/api/pos/settings/")
        keys = [m["key"] for m in res.data["payment_methods"]]
        self.assertNotIn(PosPayment.METHOD_BANK_QR, keys)
        self.assertIsNone(res.data["payment_qr"])

    def test_only_enabled_methods_are_offered(self):
        res = self.client.patch("/api/pos/settings/update/",
            {"accepted_payment_methods": ["cash", "card"]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(
            sorted(res.data["accepted_payment_methods"]), ["card", "cash"]
        )

    def test_cannot_enable_qr_without_an_image(self):
        res = self.client.patch("/api/pos/settings/update/",
            {"accepted_payment_methods": ["cash", "bank_qr"]},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_unknown_method_keys_are_dropped(self):
        res = self.client.patch("/api/pos/settings/update/",
            {"accepted_payment_methods": ["cash", "bitcoin", "split", "card"]},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(
            sorted(res.data["accepted_payment_methods"]), ["card", "cash"]
        )

    def test_method_labels_can_be_overridden(self):
        res = self.client.patch("/api/pos/settings/update/",
            {"payment_method_labels": {"bank_qr": "Fonepay QR"}},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self._enable_qr()
        res2 = self.client.get("/api/pos/settings/")
        labels = {m["key"]: m["label"] for m in res2.data["payment_methods"]}
        self.assertEqual(labels[PosPayment.METHOD_BANK_QR], "Fonepay QR")

    # ?????? QR upload / replace / remove ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    def test_merchant_can_upload_a_qr(self):
        self.client.patch(
            "/api/merchants/me/update/",
            {
                "payment_qr_url": "https://cdn.test.com/uploads/qr-one.png",
                "payment_qr_name": "eSewa",
                "payment_qr_instructions": "Scan and show confirmation to staff.",
                "payment_qr_account_name": "Payment Cafe",
                "payment_qr_enabled": True,
            },
            format="json",
        )
        self.merchant.refresh_from_db()
        self.assertTrue(self.merchant.payment_qr_enabled)
        self.assertEqual(self.merchant.payment_qr_name, "eSewa")
        self.assertTrue(self.merchant.can_accept_qr_payment())

    def test_merchant_can_replace_the_qr(self):
        self._enable_qr()
        first = self.merchant.payment_qr_url
        self.merchant.payment_qr_url = "https://cdn.test.com/uploads/qr-two.png"
        self.merchant.save()
        res = self.client.get("/api/pos/settings/")
        self.assertNotEqual(res.data["payment_qr"]["url"], first)
        self.assertEqual(
            res.data["payment_qr"]["url"],
            "https://cdn.test.com/uploads/qr-two.png",
        )

    def test_merchant_can_remove_the_qr(self):
        self._enable_qr()
        self.merchant.payment_qr_enabled = False
        self.merchant.payment_qr_url = ""
        self.merchant.save()
        self.assertFalse(self.merchant.can_accept_qr_payment())
        res = self.client.get("/api/pos/settings/")
        self.assertIsNone(res.data["payment_qr"])
        keys = [m["key"] for m in res.data["payment_methods"]]
        self.assertNotIn(PosPayment.METHOD_BANK_QR, keys)

    def test_qr_cannot_be_enabled_without_an_image(self):
        res = self.client.patch(
            "/api/merchants/me/update/",
            {"payment_qr_enabled": True},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_qr_url_must_be_http(self):
        for bad in ("javascript:alert(1)", "data:image/svg+xml,<svg/>"):
            with self.subTest(url=bad):
                res = self.client.patch(
                    "/api/merchants/me/update/",
                    {"payment_qr_url": bad},
                    format="json",
                )
                self.assertEqual(res.status_code, 400, res.data)

    def test_merchant_cannot_enable_another_merchants_qr(self):
        """QR config is tenant-scoped: A's payment sheet shows only A's QR."""
        self._enable_qr()
        other_res = self.client.get("/api/pos/settings/")
        self.assertEqual(
            other_res.data["payment_qr"]["url"],
            "https://cdn.test.com/uploads/merchant-qr.png",
        )

        self.client.force_authenticate(self.other_user)
        res = self.client.get("/api/pos/settings/")
        self.assertIsNone(res.data["payment_qr"])
        keys = [m["key"] for m in res.data["payment_methods"]]
        self.assertNotIn(PosPayment.METHOD_BANK_QR, keys)

    def test_one_merchant_cannot_record_against_another_merchants_order(self):
        other_worker = ShiftWorker.objects.create(
            merchant=self.other_merchant, display_name="Bob", role="cashier",
        )
        other_device = PosDevice.objects.create(
            merchant=self.other_merchant, name="Till X", is_active=True,
            device_token_hash="hash-till-x",
        )
        other_shift = CashShift.objects.create(
            merchant=self.other_merchant, opened_by=other_worker, device=other_device,
            opened_at=timezone.now(), status=CashShift.STATUS_OPEN,
            opening_cash=Decimal("0"),
        )
        foreign_order = self._order(500, merchant=self.other_merchant)

        res = self.client.post(
            "/api/pos/payment/create/",
            {
                "order_id": str(foreign_order.uuid),
                "shift_id": str(other_shift.id),
                "worker_id": str(other_worker.id),
                "device_id": str(other_device.id),
                "payment_method": PosPayment.METHOD_CASH,
                "amount": "500.00",
                "client_mutation_id": str(uuid.uuid4()),
            },
            format="json",
        )
        self.assertIn(res.status_code, (400, 404))
        self.assertEqual(PosPayment.objects.filter(order=foreign_order).count(), 0)


class PaymentReportingTests(PaymentTestBase):
    def setUp(self):
        super().setUp()
        self.shift = self._open_shift()

    def _record(self, method, amount, merchant=None):
        m = merchant or self.merchant
        order = self._order(amount, merchant=m)
        if m == self.merchant:
            PosPayment.objects.create(
                id=uuid.uuid4(), merchant=m, order=order, worker=self.worker,
                shift=self.shift,
                payment_method=method, amount=Decimal(amount),
                status=PosPayment.STATUS_COMPLETED,
                client_mutation_id=uuid.uuid4(),
            )
        else:
            PosPayment.objects.create(
                id=uuid.uuid4(), merchant=m, order=order,
                payment_method=method, amount=Decimal(amount),
                status=PosPayment.STATUS_COMPLETED,
                client_mutation_id=uuid.uuid4(),
            )
        return order

    def _z_report(self):
        today = timezone.localdate().isoformat()
        res = self.client.get(f"/api/pos/z-report/?date={today}")
        self.assertEqual(res.status_code, 200, res.data)
        return res

    def _breakdown(self, res):
        return {row["method"]: row["amount"] for row in res.data["payment_methods"]}

    def test_each_method_keeps_its_own_bucket(self):
        """
        Cash 1000 / Card 1500 / QR 2000 must not be collapsed, even though all
        three are confirmed by hand through the same sheet.
        """
        self._enable_qr()
        self._record(PosPayment.METHOD_CASH, "1000.00")
        self._record(PosPayment.METHOD_CARD, "1500.00")
        self._record(PosPayment.METHOD_BANK_QR, "2000.00")

        res = self._z_report()
        self.assertEqual(res.status_code, 200, res.data)
        rows = self._breakdown(res)

        self.assertEqual(rows[PosPayment.METHOD_CASH], "1000.00")
        self.assertEqual(rows[PosPayment.METHOD_CARD], "1500.00")
        self.assertEqual(rows[PosPayment.METHOD_BANK_QR], "2000.00")

        total = sum(Decimal(v) for v in rows.values())
        self.assertEqual(total, Decimal("4500.00"))
        self.assertEqual(res.data["total_payments"], "4500.00")

    def test_reported_methods_carry_display_labels(self):
        self._enable_qr()
        self.merchant.payment_method_labels = {
            PosPayment.METHOD_BANK_QR: 'Fonepay QR',
        }
        self.merchant.save()
        self._record(PosPayment.METHOD_BANK_QR, "2000.00")
        res = self._z_report()
        labels = {r["method"]: r["label"] for r in res.data["payment_methods"]}
        self.assertEqual(labels[PosPayment.METHOD_CASH], "Cash")
        self.assertEqual(labels[PosPayment.METHOD_CARD], "Card")
        self.assertEqual(labels[PosPayment.METHOD_BANK_QR], "Fonepay QR")

    def test_unused_methods_are_zero_filled(self):
        self._record(PosPayment.METHOD_CASH, "100.00")
        res = self._z_report()
        rows = self._breakdown(res)
        self.assertEqual(rows[PosPayment.METHOD_CARD], "0.00")
        self.assertEqual(rows[PosPayment.METHOD_OTHER], "0.00")

    def test_bank_transfer_and_wallet_are_distinct_from_other(self):
        self._record(PosPayment.METHOD_BANK_QR, "4500.00")
        self._record(PosPayment.METHOD_MOBILE_WALLET, "1200.00")
        self._record(PosPayment.METHOD_OTHER, "300.00")
        res = self._z_report()
        rows = self._breakdown(res)
        self.assertEqual(rows[PosPayment.METHOD_BANK_QR], "4500.00")
        self.assertEqual(rows[PosPayment.METHOD_MOBILE_WALLET], "1200.00")
        self.assertEqual(rows[PosPayment.METHOD_OTHER], "300.00")

    def test_split_tender_legs_are_reported_separately(self):
        order = self._order(1500)
        PosPayment.objects.create(
            id=uuid.uuid4(), merchant=self.merchant, order=order, shift=self._open_shift(),
            worker=self.worker, payment_method=PosPayment.METHOD_CASH,
            amount=Decimal("500.00"), status=PosPayment.STATUS_COMPLETED,
            client_mutation_id=uuid.uuid4(),
        )
        PosPayment.objects.create(
            id=uuid.uuid4(), merchant=self.merchant, order=order, shift=self._open_shift(),
            worker=self.worker, payment_method=PosPayment.METHOD_CARD,
            amount=Decimal("1000.00"), status=PosPayment.STATUS_COMPLETED,
            client_mutation_id=uuid.uuid4(),
        )
        res = self._z_report()
        rows = self._breakdown(res)
        self.assertEqual(rows[PosPayment.METHOD_CASH], "500.00")
        self.assertEqual(rows[PosPayment.METHOD_CARD], "1000.00")
        # `split` is a marker, never a bucket of its own.
        self.assertNotIn(PosPayment.METHOD_SPLIT, rows)

    def test_failed_payments_are_excluded(self):
        order = self._order(100)
        PosPayment.objects.create(
            id=uuid.uuid4(), merchant=self.merchant, order=order, shift=self._open_shift(),
            worker=self.worker, payment_method=PosPayment.METHOD_CARD,
            amount=Decimal("100.00"), status=PosPayment.STATUS_FAILED,
            client_mutation_id=uuid.uuid4(),
        )
        res = self._z_report()
        rows = self._breakdown(res)
        self.assertEqual(rows[PosPayment.METHOD_CARD], "0.00")

    def test_reports_are_tenant_scoped(self):
        other_worker = ShiftWorker.objects.create(
            merchant=self.other_merchant, display_name="Bob", role="cashier",
        )
        self._record(PosPayment.METHOD_CASH, "1000.00")
        other_order = self._order(9999.00, merchant=self.other_merchant)
        PosPayment.objects.create(
            id=uuid.uuid4(), merchant=self.other_merchant, order=other_order,
            worker=other_worker, payment_method=PosPayment.METHOD_CARD,
            amount=Decimal("9999.00"), status=PosPayment.STATUS_COMPLETED,
            client_mutation_id=uuid.uuid4(),
        )
        res = self._z_report()
        rows = self._breakdown(res)
        self.assertEqual(rows[PosPayment.METHOD_CASH], "1000.00")
        self.assertEqual(rows[PosPayment.METHOD_CARD], "0.00")
