"""
Manual payment recording at the POS.

Run with: python manage.py test pos.test_manual_payments

Every payment method is confirmed by the cashier — no gateway reference or
card terminal is required — and the exact method is stored and reported.
The merchant's own payment QR image is exposed to the POS.
"""

import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MenuItem, MerchantProfile
from orders.models import Order
from pos.models import CashShift, PosDevice, PosPayment, ShiftWorker

QR_URL = "https://cdn.example.test/media/merchant_7_payment_qr.webp"


class ManualPaymentTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username="pay-merchant", email="pay@test.com", password="x", role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=user, business_name="Pay Cafe", slug="pay-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.item = MenuItem.objects.create(merchant=self.merchant, name="Tea", price=100, is_available=True)
        self.device = PosDevice.objects.create(merchant=self.merchant, name="Till", device_token_hash="x")
        self.worker = ShiftWorker.objects.create(
            merchant=self.merchant, display_name="Pema", pin_hash="x", can_close_shift=True,
        )
        self.shift = CashShift.objects.create(
            merchant=self.merchant, device=self.device, opened_by=self.worker,
        )

    def order(self):
        resp = self.client.post("/api/pos/order/create/", {
            "items": [{"menu_item_id": self.item.id, "quantity": 1}],
            "fulfillment_type": "dine-in",
            "worker_id": str(self.worker.id), "device_id": str(self.device.id),
            "client_mutation_id": str(uuid.uuid4()),
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def pay(self, order, method):
        # CollectPaymentSheet sends no external_reference for any method.
        return self.client.post("/api/pos/payment/create/", {
            "order_id": order["uuid"], "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id), "device_id": str(self.device.id),
            "payment_method": method, "amount": order["total_amount"], "change_amount": "0",
            "client_mutation_id": str(uuid.uuid4()),
        }, format="json")

    def test_every_method_is_accepted_without_a_gateway_reference(self):
        for method in ("cash", "card", "bank_qr", "mobile_wallet"):
            with self.subTest(method=method):
                order = self.order()
                resp = self.pay(order, method)
                self.assertEqual(resp.status_code, 201, resp.data)
                self.assertNotIn("error", resp.data)
                saved = Order.objects.get(uuid=order["uuid"])
                self.assertEqual(saved.payment_status, "paid")
                self.assertEqual(saved.payment_method, method)
                self.assertEqual(saved.pos_payments.get().payment_method, method)

    def test_split_payment_with_qr_and_card_needs_no_reference(self):
        order = self.order()
        total = Decimal(order["total_amount"])
        resp = self.client.post("/api/pos/payment/split/", {
            "order_id": order["uuid"], "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id), "device_id": str(self.device.id),
            "payments": [
                {"payment_method": "bank_qr", "amount": str(total - 10)},
                {"payment_method": "card", "amount": "10"},
            ],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        methods = set(PosPayment.objects.filter(order__uuid=order["uuid"]).values_list("payment_method", flat=True))
        self.assertEqual(methods, {"bank_qr", "card"})

    def test_shift_reports_break_down_every_method(self):
        amounts = {}
        for method in ("cash", "bank_qr", "mobile_wallet", "card"):
            order = self.order()
            self.assertEqual(self.pay(order, method).status_code, 201)
            amounts[method] = Decimal(order["total_amount"])

        summary = self.client.get(f"/api/pos/shift/summary/?shift_id={self.shift.id}").data
        by_method = {row["method"]: Decimal(row["amount"]) for row in summary["payment_methods"]}
        self.assertEqual(by_method, amounts)
        # "Other" is everything except cash and card — not the grand total.
        self.assertEqual(
            Decimal(summary["total_other_sales"]), amounts["bank_qr"] + amounts["mobile_wallet"],
        )

        resp = self.client.post("/api/pos/shift/close/", {
            "shift_id": str(self.shift.id), "worker_id": str(self.worker.id), "closing_cash": "0",
        }, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.total_other_sales, amounts["bank_qr"] + amounts["mobile_wallet"])
        self.assertEqual(self.shift.total_cash_sales, amounts["cash"])
        self.assertEqual(self.shift.total_card_sales, amounts["card"])

        staff = self.client.get("/api/pos/staff-report/").data["staff"][0]
        self.assertEqual(Decimal(staff["qr_amount"]), amounts["bank_qr"])
        self.assertEqual(Decimal(staff["digital_amount"]), amounts["mobile_wallet"])

        z = self.client.get("/api/pos/z-report/").data
        z_methods = {row["method"] for row in z["payment_methods"]}
        self.assertTrue({"cash", "bank_qr", "mobile_wallet", "card"} <= z_methods)

    def test_exports_use_readable_method_names(self):
        for method in ("bank_qr", "mobile_wallet"):
            order = self.order()
            self.pay(order, method)
        resp = self.client.get("/api/pos/reports/export/csv/?type=payments")
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn("QR Payment", body)
        self.assertIn("Digital Payment", body)

    def test_payment_qr_is_saved_in_merchant_settings_and_exposed_to_pos(self):
        resp = self.client.patch("/api/merchants/me/update/", {"payment_qr_url": QR_URL}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.merchant.refresh_from_db()
        self.assertEqual(self.merchant.payment_qr_url, QR_URL)

        self.assertEqual(self.client.get("/api/pos/settings/").data["payment_qr_url"], QR_URL)
        boot = self.client.post("/api/pos/auth/bootstrap/", {"device_id": str(self.device.id)}, format="json")
        self.assertEqual(boot.data["pos_settings"]["payment_qr_url"], QR_URL)

        # Clearing it is allowed; the POS then shows the "not configured" message.
        self.client.patch("/api/merchants/me/update/", {"payment_qr_url": ""}, format="json")
        self.assertEqual(self.client.get("/api/pos/settings/").data["payment_qr_url"], "")
