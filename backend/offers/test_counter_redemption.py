"""
Counter redemption without a POS: the merchant dashboard confirm flow, bill
amounts for money offers, and the store-PIN fallback.

Run with: python manage.py test offers.test_counter_redemption
"""

import uuid

from django.test import TestCase

from notifications.models import Notification

from .models import PromotionCampaign, VoucherClaim, VoucherRedemption
from .pin import CUSTOMER_MAX_FAILURES, STORE_MAX_FAILURES
from .testing import D, OffersFixture


class DashboardRedeemTests(OffersFixture, TestCase):
    def setUp(self):
        super().setUp()
        # A store that does not use the Zentro POS at all.
        self.merchant.pos_enabled = False
        self.merchant.save()

    def lookup(self, code):
        return self.as_merchant.post("/api/offers/merchant/redeem/lookup/", {"code": code}, format="json")

    def confirm(self, code, **extra):
        body = {"code": code, "idempotency_key": str(uuid.uuid4()), **extra}
        return self.as_merchant.post("/api/offers/merchant/redeem/confirm/", body, format="json")

    def test_percent_offer_needs_and_prices_the_bill(self):
        claim = self.claim(self.make_campaign(value=D("20"), min_order_amount=D("1000"), max_discount_amount=D("150")))
        card = self.lookup(claim["code"])
        self.assertEqual(card.status_code, 200, card.data)
        self.assertTrue(card.data["needs_bill_amount"])
        self.assertTrue(card.data["evaluation"]["eligible"])

        self.assertEqual(self.confirm(claim["code"]).data["code"], "BILL_AMOUNT_REQUIRED")
        short = self.confirm(claim["code"], bill_amount="800")
        self.assertEqual(short.data["code"], "MINIMUM_ORDER_NOT_MET")
        self.assertEqual(short.data["error"], "Add Rs 200.00 more to use this offer.")

        ok = self.confirm(claim["code"], bill_amount="1200")
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data["discount_amount"], "150.00")  # 20% = 240, capped at 150
        red = VoucherRedemption.objects.get()
        self.assertEqual((red.confirmed_via, red.order_subtotal, red.order_total), ("dashboard", D("1200.00"), D("1050.00")))
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "redeemed")
        campaign = PromotionCampaign.objects.get()
        self.assertEqual(campaign.redemptions_count, 1)

    def test_free_item_without_min_spend_needs_no_bill(self):
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        card = self.lookup(claim["qr_payload"])
        self.assertFalse(card.data["needs_bill_amount"])
        resp = self.confirm(claim["qr_payload"])
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(resp.data["discount_amount"])

    def test_used_and_foreign_codes(self):
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        self.confirm(claim["code"])
        again = self.lookup(claim["code"])
        self.assertFalse(again.data["evaluation"]["eligible"])
        self.assertEqual(again.data["evaluation"]["reason"]["code"], "CLAIM_USED")
        self.assertEqual(self.confirm(claim["code"]).data["code"], "CLAIM_USED")

        rival_claim = self.claim(self.make_campaign(merchant=self.rival))
        self.assertEqual(self.lookup(rival_claim["code"]).data["code"], "INVALID_CODE")

    def test_online_only_offer_is_refused_at_the_counter(self):
        claim = self.claim(self.make_campaign(kind="free_item", channels="online",
                                              benefit_targets=[{"menu_item": self.coke}]))
        self.assertEqual(self.confirm(claim["code"]).data["code"], "CHANNEL")

    def test_customers_cannot_use_the_merchant_endpoints(self):
        self.assertEqual(self.as_customer.post("/api/offers/merchant/redeem/lookup/", {"code": "x"}, format="json").status_code, 403)
        self.assertEqual(self.as_customer.get("/api/offers/merchant/redemption-pin/").status_code, 403)


class StorePinTests(OffersFixture, TestCase):
    def set_pin(self, pin="4829"):
        return self.as_merchant.put("/api/offers/merchant/redemption-pin/", {"pin": pin}, format="json")

    def use_pin(self, claim_id, pin, user=None, **extra):
        body = {"pin": pin, "idempotency_key": str(uuid.uuid4()), **extra}
        return self.client_for(user or self.c_user).post(f"/api/offers/mine/{claim_id}/redeem-with-pin/", body, format="json")

    def test_pin_settings(self):
        self.assertEqual(self.as_merchant.get("/api/offers/merchant/redemption-pin/").data["enabled"], False)
        for weak in ("12", "abcd", "1111", "1234", "9876", "1234567"):
            self.assertEqual(self.set_pin(weak).status_code, 400, weak)
        self.assertTrue(self.set_pin().data["enabled"])
        claim = self.claim(self.make_campaign())
        self.assertTrue(self.as_customer.get(f"/api/offers/mine/{claim['id']}/").data["store_pin_enabled"])
        self.assertFalse(self.as_merchant.delete("/api/offers/merchant/redemption-pin/").data["enabled"])

    def test_redeem_with_pin_and_merchant_is_notified(self):
        self.set_pin()
        claim = self.claim(self.make_campaign(value=D("10")))
        with self.captureOnCommitCallbacks(execute=True):
            resp = self.use_pin(claim["id"], "4829", bill_amount="500")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["discount_amount"], "50.00")
        self.assertEqual(resp.data["claim"]["tab"], "used")
        self.assertEqual(VoucherRedemption.objects.get().confirmed_via, "pin")
        self.assertTrue(Notification.objects.filter(user=self.m_user, title__contains="store PIN").exists())

    def test_wrong_pin_counts_down_and_locks_the_customer(self):
        self.set_pin()
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        first = self.use_pin(claim["id"], "0000")
        self.assertEqual((first.status_code, first.data["attempts_left"]), (403, CUSTOMER_MAX_FAILURES - 1))
        for _ in range(CUSTOMER_MAX_FAILURES - 1):
            self.use_pin(claim["id"], "0000")
        locked = self.use_pin(claim["id"], "4829")
        self.assertEqual((locked.status_code, locked.data["code"]), (429, "PIN_LOCKED"))
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")

    def test_store_wide_lock_after_many_failures(self):
        from django.core.cache import cache
        from .pin import _store_key

        self.set_pin()
        cache.set(_store_key(self.merchant.pk), STORE_MAX_FAILURES, 3600)
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        resp = self.use_pin(claim["id"], "4829")
        self.assertEqual(resp.status_code, 429)
        self.set_pin("5937")  # changing the PIN lifts the pause
        self.assertEqual(self.use_pin(claim["id"], "5937").status_code, 201)

    def test_pin_refusals(self):
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        self.assertEqual(self.use_pin(claim["id"], "4829").data["code"], "PIN_NOT_ENABLED")
        self.set_pin()
        self.assertEqual(self.use_pin(claim["id"], "4829", user=self.c2_user).status_code, 404)
        money = self.claim(self.make_campaign(title="money", value=D("10")))
        self.assertEqual(self.use_pin(money["id"], "4829").data["code"], "BILL_AMOUNT_REQUIRED")

    def test_pin_retry_is_idempotent(self):
        self.set_pin()
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        key = str(uuid.uuid4())
        body = {"pin": "4829", "idempotency_key": key}
        url = f"/api/offers/mine/{claim['id']}/redeem-with-pin/"
        first = self.as_customer.post(url, body, format="json")
        second = self.as_customer.post(url, body, format="json")
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(VoucherRedemption.objects.count(), 1)
