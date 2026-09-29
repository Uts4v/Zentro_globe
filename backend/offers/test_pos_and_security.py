"""
POS redemption, abuse protection and concurrency.

Run with: python manage.py test offers
"""

import threading
import unittest
import uuid

from django.conf import settings
from django.db import connection
from django.test import TestCase, TransactionTestCase

from orders.models import Order

from .engine import OfferError, claim_offer, reserve_for_order, CHANNEL_IN_STORE, load_claim
from .models import PromotionCampaign, VoucherClaim, VoucherRedemption
from .pos_views import LOCKOUT_ATTEMPTS
from .testing import D, OffersFixture


class PosOfferTests(OffersFixture, TestCase):
    def lookup(self, code, **extra):
        return self.as_merchant.post("/api/offers/pos/lookup/", {"code": code, **extra}, format="json")

    def test_lookup_by_code_and_qr_with_basket_evaluation(self):
        claim = self.claim(self.make_campaign(title="20% off"))
        for code in (claim["code"], claim["code"].lower().replace("-", ""), claim["qr_payload"]):
            resp = self.lookup(code, items=[{"menu_item_id": self.pizza.id, "quantity": 1}])
            self.assertEqual(resp.status_code, 200, resp.data)
            self.assertEqual(resp.data["customer_first_name"], "Asha")
            self.assertEqual(resp.data["evaluation"]["discount_amount"], "120.00")
            self.assertTrue(resp.data["evaluation"]["eligible"])

    def test_unknown_and_foreign_codes_look_identical(self):
        rival_claim = self.claim(self.make_campaign(merchant=self.rival))
        unknown = self.lookup("ZNT-0000-00000")
        foreign = self.lookup(rival_claim["code"])
        self.assertEqual((unknown.status_code, unknown.data), (foreign.status_code, foreign.data))
        self.assertEqual(foreign.data["code"], "INVALID_CODE")

    def test_lockout_after_repeated_bad_codes(self):
        claim = self.claim(self.make_campaign())
        for _ in range(LOCKOUT_ATTEMPTS):
            self.assertEqual(self.lookup("garbage-code").status_code, 404)
        locked = self.lookup(claim["code"])
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.data["code"], "LOOKUP_LOCKED")

    def test_apply_then_pay_redeems_on_the_pos_channel(self):
        claim = self.claim(self.make_campaign())
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        resp = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["discount_amount"], "120.00")
        order.refresh_from_db()
        self.assertEqual(order.total_amount, D("542.40"))
        order.payment_status = "paid"
        order.save(update_fields=["payment_status"])
        red = VoucherRedemption.objects.get()
        self.assertEqual((red.channel, red.discount_amount), ("pos", D("120.00")))

    def test_apply_with_reward_choice_and_rollback_when_it_does_not_apply(self):
        campaign = self.make_campaign(kind="free_item", benefit_targets=[{"category": self.drinks_cat}],
                                      min_order_amount=D("500"))
        claim = self.claim(campaign)
        small = self.pos_order([{"menu_item_id": self.sprite.id, "quantity": 1}])
        refused = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(small.uuid), "code": claim["code"], "worker_id": str(self.worker.id),
            "reward_choice": {"menu_item_id": self.coke.id}}, format="json")
        self.assertEqual(refused.status_code, 400, refused.data)
        self.assertEqual(refused.data["code"], "MINIMUM_ORDER_NOT_MET")
        self.assertEqual(small.items.count(), 1)  # the reward line was rolled back
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")

        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        ok = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id),
            "reward_choice": {"menu_item_id": self.coke.id}}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(order.items.filter(is_promotion_reward=True).count(), 1)

    def test_remove_frees_the_claim_and_reprices(self):
        claim = self.claim(self.make_campaign())
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        resp = self.as_merchant.post("/api/offers/pos/remove/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        order.refresh_from_db()
        self.assertEqual(order.total_amount, D("678.00"))
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")

    def test_in_store_redemption_is_idempotent(self):
        campaign = self.make_campaign(channels="in_store")
        claim = self.claim(campaign)
        key = str(uuid.uuid4())
        body = {"code": claim["code"], "worker_id": str(self.worker.id), "idempotency_key": key, "bill_amount": "500"}
        first = self.as_merchant.post("/api/offers/pos/redeem-in-store/", body, format="json")
        second = self.as_merchant.post("/api/offers/pos/redeem-in-store/", body, format="json")
        self.assertEqual((first.status_code, second.status_code), (201, 200), (first.data, second.data))
        self.assertEqual(first.data["redemption_id"], second.data["redemption_id"])
        self.assertEqual(VoucherRedemption.objects.count(), 1)
        again = self.as_merchant.post("/api/offers/pos/redeem-in-store/", {**body, "idempotency_key": str(uuid.uuid4())}, format="json")
        self.assertEqual(again.data["code"], "CLAIM_USED")
        other = self.claim(self.make_campaign(title="other", channels="in_store"), self.c2_user)
        clash = self.as_merchant.post("/api/offers/pos/redeem-in-store/", {**body, "code": other["code"]}, format="json")
        self.assertEqual(clash.status_code, 409)

    def test_pos_endpoints_need_a_pos_merchant(self):
        self.assertEqual(self.as_customer.post("/api/offers/pos/lookup/", {"code": "x"}, format="json").status_code, 403)
        rival = self.client_for(self.r_user)
        claim = self.claim(self.make_campaign())
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        resp = rival.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 404)

    def test_settled_order_cannot_take_an_offer(self):
        claim = self.claim(self.make_campaign())
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        order.payment_status = "paid"
        order.save()
        resp = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 400)


class SequentialRaceTests(OffersFixture, TestCase):
    """The outcomes the row locks guarantee, checked deterministically (any database)."""

    def test_same_claim_cannot_be_reserved_on_two_orders(self):
        claim = self.claim(self.make_campaign())
        a = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        b = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        reserve_for_order(load_claim(claim["id"]), a, channel=CHANNEL_IN_STORE)
        with self.assertRaises(OfferError) as ctx:
            reserve_for_order(load_claim(claim["id"]), b, channel=CHANNEL_IN_STORE)
        self.assertEqual(ctx.exception.code, "CLAIM_IN_USE")

    def test_reserving_twice_on_the_same_order_is_idempotent(self):
        campaign = self.make_campaign()
        claim = self.claim(campaign)
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        reserve_for_order(load_claim(claim["id"]), order, channel=CHANNEL_IN_STORE)
        reserve_for_order(load_claim(claim["id"]), order, channel=CHANNEL_IN_STORE)
        campaign.refresh_from_db()
        self.assertEqual(campaign.reserved_count, 1)
        self.assertEqual(order.adjustments.filter(status="active").count(), 1)

    def test_finalizing_twice_redeems_once(self):
        from .engine import finalize_order

        claim = self.claim(self.make_campaign())
        order = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        reserve_for_order(load_claim(claim["id"]), order, channel=CHANNEL_IN_STORE)
        order.payment_status = "paid"
        order.save()
        finalize_order(Order.objects.get(pk=order.pk))
        self.assertEqual(VoucherRedemption.objects.count(), 1)


@unittest.skipUnless(
    settings.DATABASES["default"]["ENGINE"].endswith("postgresql"),
    "Needs Postgres row locking (SQLite serialises all writes).",
)
class ParallelTests(OffersFixture, TransactionTestCase):
    def _run(self, fns):
        errors, results = [], []

        def wrap(fn):
            try:
                results.append(fn())
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=wrap, args=(fn,)) for fn in fns]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        return results, errors

    def test_parallel_claims_never_exceed_max_claims(self):
        campaign = self.make_campaign(max_claims=1)
        results, errors = self._run([
            lambda: claim_offer(campaign.id, self.customer),
            lambda: claim_offer(campaign.id, self.customer2),
        ])
        self.assertEqual(len(results), 1)
        self.assertEqual(PromotionCampaign.objects.get(pk=campaign.pk).claims_count, 1)

    def test_parallel_reserve_of_one_claim_on_two_orders(self):
        claim_obj, _ = claim_offer(self.make_campaign().id, self.customer)
        a = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        b = self.pos_order([{"menu_item_id": self.pizza.id, "quantity": 1}])
        results, errors = self._run([
            lambda: reserve_for_order(load_claim(claim_obj.id), a, channel=CHANNEL_IN_STORE),
            lambda: reserve_for_order(load_claim(claim_obj.id), b, channel=CHANNEL_IN_STORE),
        ])
        self.assertEqual(len(results), 1)
        self.assertEqual(VoucherClaim.objects.get(pk=claim_obj.pk).status, "reserved")
