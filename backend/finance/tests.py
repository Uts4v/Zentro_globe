"""
The merchant Accounts section.

Run with: python manage.py test finance
"""

import uuid
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventory.models import InventoryLocation, InventoryReceiving, Supplier
from merchants.models import MerchantProfile
from orders.models import Order
from pos import rbac
from pos.models import CashShift, PosCashMovement, PosDevice, PosPayment, ShiftWorker

from . import services
from .models import MoneyEntry, StaffSalary


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="fin-owner", email="fin-owner@test.com", password="Owner123!", role="merchant",
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner, business_name="Books Cafe", slug="books-cafe", pos_enabled=True,
        )
        cls.other_owner = User.objects.create_user(
            username="fin-other", email="fin-other@test.com", password="Other123!", role="merchant",
        )
        cls.other = MerchantProfile.objects.create(
            user=cls.other_owner, business_name="Other", slug="fin-other", pos_enabled=True,
        )
        cls.roles = rbac.ensure_default_roles(cls.merchant)
        cls.supplier = Supplier.objects.create(merchant=cls.merchant, name="Fresh Farm")
        cls.location = InventoryLocation.objects.create(merchant=cls.merchant, name="Store", is_default=True)

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.other_client = APIClient()
        self.other_client.force_authenticate(self.other_owner)

    def order(self, total="0"):
        return Order.objects.create(
            merchant=self.merchant, total_amount=Decimal(total), subtotal=Decimal(total),
            status=Order.STATUS_CONFIRMED,
        )

    def pay(self, method, amount, change="0", status=PosPayment.STATUS_COMPLETED):
        return PosPayment.objects.create(
            merchant=self.merchant, order=self.order(amount), payment_method=method,
            amount=Decimal(amount), change_amount=Decimal(change), status=status,
            client_mutation_id=uuid.uuid4(),
        )

    def entry(self, **body):
        return self.client.post("/api/finance/entries/", body, format="json")

    def worker(self, name, role_key, pin="1234"):
        resp = self.client.post("/api/pos/workers/team/", {
            "display_name": name, "pin": pin, "staff_role": self.roles[role_key].id,
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        return ShiftWorker.objects.get(id=resp.data["id"])

    def as_staff(self, worker, pin="1234"):
        resp = self.client.post("/api/pos/staff/session/", {"worker_id": str(worker.id), "pin": pin}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        client = APIClient()
        client.force_authenticate(self.owner)
        client.credentials(HTTP_X_ZENTRO_STAFF=resp.data["token"])
        return client


class BalanceTests(Base):
    def test_cash_and_bank_balances_follow_every_kind_of_money(self):
        self.client.put("/api/finance/settings/", {"opening_cash": "1000", "opening_bank": "5000"}, format="json")
        self.pay("cash", "500", change="100")          # cash +400
        self.pay("bank_qr", "300")                     # bank +300
        self.pay("card", "200")                        # bank +200
        self.pay("credit", "150")                      # a sale, but no money yet
        self.pay("cash", "-50", status=PosPayment.STATUS_REFUNDED)   # cash -50

        device = PosDevice.objects.create(merchant=self.merchant, name="Till 1", device_token_hash="x")
        shift = CashShift.objects.create(
            merchant=self.merchant, device=device, opened_by=self.worker("Opener", "manager"),
            status=CashShift.STATUS_OPEN,
        )
        PosCashMovement.objects.create(shift=shift, movement_type="payin", amount=Decimal("20"))
        PosCashMovement.objects.create(shift=shift, movement_type="payout", amount=Decimal("30"))
        PosCashMovement.objects.create(shift=shift, movement_type="cashdrop", amount=Decimal("100"))

        self.assertEqual(self.entry(kind="expense", amount="60", payment_method="cash", category="rent").status_code, 201)
        self.assertEqual(self.entry(kind="expense", amount="40", payment_method="bank_transfer").status_code, 201)
        self.assertEqual(self.entry(kind="bank_deposit", amount="200").status_code, 201)
        self.assertEqual(self.entry(kind="bank_withdrawal", amount="70").status_code, 201)
        self.assertEqual(self.entry(kind="other_income", amount="25", payment_method="online").status_code, 201)

        # cash: 1000 +400 +20 +70  -50 -30 -100 -60 -200 = 1050
        # bank: 5000 +300 +200 +100 +200 +25  -40 -70    = 5715
        resp = self.client.get("/api/finance/summary/")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["balances"], {"cash": "1050.00", "bank": "5715.00", "total": "6765.00"})
        self.assertEqual(resp.data["sales"]["cash"], "400.00")
        self.assertEqual(resp.data["sales"]["online"], "500.00")
        self.assertEqual(resp.data["sales"]["on_account"], "150.00")
        self.assertEqual(resp.data["sales"]["total"], "1050.00")
        self.assertEqual(resp.data["money_out"]["refunds"], "50.00")
        self.assertEqual(resp.data["money_out"]["expenses"], "100.00")
        self.assertEqual(resp.data["money_out"]["pos_payouts"], "30.00")
        # net = 1050 sales + 25 income - (50 + 100 + 30)
        self.assertEqual(resp.data["net"], "895.00")

        cash = self.client.get("/api/finance/cash/").data
        self.assertEqual(cash["closing_balance"], "1050.00")
        self.assertEqual(cash["money_in"], "490.00")
        self.assertEqual(cash["money_out"], "440.00")
        self.assertTrue(any(r["label"] == "Cash sales" for r in cash["rows"]))
        bank = self.client.get("/api/finance/bank/").data
        self.assertEqual(bank["closing_balance"], "5715.00")

        online = self.client.get("/api/finance/online/").data
        self.assertEqual(online["received"], "500.00")
        self.assertEqual(len(online["rows"]), 2)
        self.assertEqual({m["key"] for m in online["by_method"]}, {"bank_qr", "card"})

    def test_a_cancelled_record_stops_counting_but_stays_in_history(self):
        created = self.entry(kind="expense", amount="80", payment_method="cash").data
        self.assertEqual(self.client.get("/api/finance/summary/").data["balances"]["cash"], "-80.00")
        resp = self.client.post(f"/api/finance/entries/{created['id']}/void/", {}, format="json")
        self.assertEqual(resp.status_code, 400)   # a reason is required
        resp = self.client.post(
            f"/api/finance/entries/{created['id']}/void/", {"reason": "Entered twice"}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(self.client.get("/api/finance/summary/").data["balances"]["cash"], "0.00")
        rows = self.client.get("/api/finance/entries/?include_void=1").data["rows"]
        self.assertTrue(rows[0]["is_void"])
        self.assertEqual(rows[0]["void_reason"], "Entered twice")
        self.assertEqual(rows[0]["voided_by"], "Owner")

    def test_double_tap_records_the_money_once(self):
        body = {"kind": "expense", "amount": "10", "payment_method": "cash", "client_key": "abc-1"}
        first = self.entry(**body)
        second = self.entry(**body)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(MoneyEntry.objects.count(), 1)

    def test_bad_input_is_refused(self):
        self.assertEqual(self.entry(kind="expense", amount="0").status_code, 400)
        self.assertEqual(self.entry(kind="expense", amount="-5").status_code, 400)
        self.assertEqual(self.entry(kind="nonsense", amount="5").status_code, 400)
        tomorrow = (services.today(self.merchant) + timezone.timedelta(days=1)).isoformat()
        self.assertEqual(self.entry(kind="expense", amount="5", date=tomorrow).status_code, 400)


class SupplierTests(Base):
    def receiving(self, value, supplier=None):
        return InventoryReceiving.objects.create(
            merchant=self.merchant, supplier=supplier or self.supplier, location=self.location,
            total_value=Decimal(value),
        )

    def test_outstanding_is_purchases_minus_payments(self):
        first = self.receiving("1000")
        self.receiving("500")
        resp = self.entry(
            kind="supplier_payment", amount="600", payment_method="bank_transfer",
            supplier_id=self.supplier.id, receiving_id=first.id, reference="TXN-1",
        )
        self.assertEqual(resp.status_code, 201, resp.data)

        row = self.client.get("/api/finance/suppliers/").data["rows"][0]
        self.assertEqual(row["name"], "Fresh Farm")
        self.assertEqual(row["purchase_amount"], "1500.00")
        self.assertEqual(row["amount_paid"], "600.00")
        self.assertEqual(row["outstanding"], "900.00")
        self.assertIsNotNone(row["last_payment"])

        detail = self.client.get(f"/api/finance/suppliers/{self.supplier.id}/").data
        by_id = {p["id"]: p for p in detail["purchases"]}
        self.assertEqual(by_id[first.id]["paid"], "600.00")
        self.assertEqual(by_id[first.id]["outstanding"], "400.00")
        self.assertEqual(detail["payments"][0]["payment_method_label"], "Bank transfer")
        self.assertEqual(detail["payments"][0]["reference"], "TXN-1")
        # The payment left the bank, not the cash drawer.
        self.assertEqual(self.client.get("/api/finance/summary/").data["balances"]["bank"], "-600.00")

    def test_supplier_is_required_and_must_be_ours(self):
        self.assertEqual(self.entry(kind="supplier_payment", amount="10").data["code"], "supplier_required")
        theirs = Supplier.objects.create(merchant=self.other, name="Not ours")
        resp = self.entry(kind="supplier_payment", amount="10", supplier_id=theirs.id)
        self.assertEqual(resp.data["code"], "supplier_required")
        self.assertEqual(self.client.get(f"/api/finance/suppliers/{theirs.id}/").status_code, 404)


class SalaryTests(Base):
    def test_salary_is_paid_in_parts_and_never_overpaid(self):
        ram = self.worker("Ram", "cashier")
        resp = self.client.post("/api/finance/salaries/", {
            "worker_id": str(ram.id), "period": "2026-09", "amount": "20000",
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        salary_id = resp.data["id"]
        self.assertEqual(resp.data["status"], "unpaid")
        self.assertEqual(resp.data["period_label"], "September 2026")

        # The same month twice is refused.
        resp = self.client.post("/api/finance/salaries/", {
            "worker_id": str(ram.id), "period": "2026-09", "amount": "20000",
        }, format="json")
        self.assertEqual(resp.status_code, 409)

        self.assertEqual(self.entry(kind="salary_payment", amount="12000", salary_id=salary_id).status_code, 201)
        row = self.client.get("/api/finance/salaries/").data["rows"][0]
        self.assertEqual((row["status"], row["paid"], row["outstanding"]), ("partial", "12000.00", "8000.00"))

        resp = self.entry(kind="salary_payment", amount="9000", salary_id=salary_id)
        self.assertEqual(resp.data["code"], "salary_overpaid")
        self.assertEqual(self.entry(kind="salary_payment", amount="8000", salary_id=salary_id, payment_method="bank_transfer").status_code, 201)

        data = self.client.get("/api/finance/salaries/").data
        self.assertEqual(data["rows"][0]["status"], "paid")
        self.assertEqual(len(data["rows"][0]["payments"]), 2)
        self.assertEqual(data["outstanding"], "0.00")
        self.assertEqual(self.client.get("/api/finance/summary/").data["money_out"]["salaries"], "20000.00")

        # A salary with payments is history: it cannot be deleted or cut below what was paid.
        self.assertEqual(self.client.delete(f"/api/finance/salaries/{salary_id}/").status_code, 409)
        resp = self.client.patch(f"/api/finance/salaries/{salary_id}/", {"amount": "100"}, format="json")
        self.assertEqual(resp.data["code"], "below_paid")

        staff = self.client.get("/api/finance/salaries/staff/").data
        self.assertEqual(staff[0]["last_salary"], "20000.00")


class AccessTests(Base):
    def test_another_merchant_sees_none_of_it(self):
        self.pay("cash", "500")
        self.entry(kind="expense", amount="60", payment_method="cash")
        data = self.other_client.get("/api/finance/summary/").data
        self.assertEqual(data["sales"]["total"], "0.00")
        self.assertEqual(data["balances"]["cash"], "0.00")
        self.assertEqual(self.other_client.get("/api/finance/entries/").data["rows"], [])
        entry = MoneyEntry.objects.get()
        resp = self.other_client.post(f"/api/finance/entries/{entry.id}/void/", {"reason": "x"}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_staff_need_the_accounts_permissions(self):
        cashier = self.as_staff(self.worker("Chandra", "cashier"))
        self.assertEqual(cashier.get("/api/finance/summary/").status_code, 403)
        self.assertEqual(cashier.post("/api/finance/entries/", {"kind": "expense", "amount": "5"}, format="json").status_code, 403)

        viewer_role = self.client.post(
            "/api/pos/roles/", {"name": "Bookkeeper (read)", "permissions": ["accounts.view"]}, format="json",
        ).data
        resp = self.client.post("/api/pos/workers/team/", {
            "display_name": "Bina", "pin": "1234", "staff_role": viewer_role["id"],
        }, format="json")
        viewer = self.as_staff(ShiftWorker.objects.get(id=resp.data["id"]))
        self.assertEqual(viewer.get("/api/finance/summary/").status_code, 200)
        self.assertEqual(viewer.post("/api/finance/entries/", {"kind": "expense", "amount": "5"}, format="json").status_code, 403)

        manager = self.as_staff(self.worker("Mina", "manager"))
        resp = manager.post("/api/finance/entries/", {"kind": "expense", "amount": "5", "payment_method": "cash"}, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["created_by"], "Mina")

    def test_signed_out_requests_are_refused(self):
        self.assertIn(APIClient().get("/api/finance/summary/").status_code, (401, 403))
