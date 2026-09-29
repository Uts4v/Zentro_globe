"""
Offers through real orders: every benefit type, reserve → redeem / release /
void, the one-discount slot, and each refusal reason.

Run with: python manage.py test offers
"""

from django.test import TestCase
from django.utils import timezone

from notifications.models import Notification
from orders.models import Order, OrderItem
from orders.pricing import reprice_order

from .engine import backfill_return_rates, end_finished_campaigns, expire_claims
from .models import PromotionCampaign, PromotionDailyStats, VoucherClaim, VoucherRedemption
from .testing import D, OffersFixture

PIZZA = lambda self, q=1: {"menu_item_id": self.pizza.id, "quantity": q}  # noqa: E731
COKE = lambda self, q=1: {"menu_item_id": self.coke.id, "quantity": q}  # noqa: E731


class PercentAndAmountTests(OffersFixture, TestCase):
    def test_percent_offer_end_to_end(self):
        campaign = self.make_campaign(value=D("20"))
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self, 2), COKE(self)], claim["id"])
        order = Order.objects.get(pk=resp.data["id"])
        # 1320 subtotal, 20% = 264 off, VAT 13% on 1056 = 137.28.
        self.assertEqual(order.subtotal, D("1320.00"))
        self.assertEqual(order.discount_amount, D("264.00"))
        self.assertEqual(order.tax_amount, D("137.28"))
        self.assertEqual(order.total_amount, D("1193.28"))
        self.assertEqual(sum(i.discount_amount for i in order.items.all()), D("264.00"))
        vc = VoucherClaim.objects.get(pk=claim["id"])
        self.assertEqual((vc.status, vc.reserved_order_id), ("reserved", order.id))
        campaign.refresh_from_db()
        self.assertEqual(campaign.reserved_count, 1)

        self.set_status(order.id, "confirmed")
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "reserved")  # not final yet
        with self.captureOnCommitCallbacks(execute=True):
            self.set_status(order.id, "completed")

        vc.refresh_from_db()
        campaign.refresh_from_db()
        self.assertEqual((vc.status, vc.uses_count, vc.reserved_order_id), ("redeemed", 1, None))
        self.assertEqual((campaign.reserved_count, campaign.redemptions_count), (0, 1))
        red = VoucherRedemption.objects.get()
        self.assertEqual((red.discount_amount, red.order_total, red.channel), (D("264.00"), D("1193.28"), "online"))
        self.assertTrue(red.is_new_customer)
        self.assertEqual(red.rules_snapshot["benefit"]["kind"], "percent_off")
        stats = PromotionDailyStats.objects.get(campaign=campaign)
        self.assertEqual((stats.redemptions, stats.discount_total, stats.new_customers), (1, D("264.00"), 1))
        self.assertTrue(Notification.objects.filter(user=self.c_user, title__contains="You saved").exists())

    def test_amount_off_capped_and_max_discount(self):
        campaign = self.make_campaign(kind="amount_off", value=D("500"), max_discount_amount=D("300"))
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self)], claim["id"])
        self.assertEqual(Order.objects.get(pk=resp.data["id"]).discount_amount, D("300.00"))

    def test_minimum_spend_refused_with_a_helpful_message(self):
        campaign = self.make_campaign(min_order_amount=D("1000"))
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self), COKE(self, 2)], claim["id"], expect=400)  # 840
        self.assertEqual(resp.data["code"], "MINIMUM_ORDER_NOT_MET")
        self.assertEqual(resp.data["error"], "Add Rs 160.00 more to use this offer.")
        self.assertFalse(Order.objects.exists())
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")

    def test_targeted_scope_only_discounts_matching_lines(self):
        campaign = self.make_campaign(value=D("50"), scope="targets", benefit_targets=[{"category": self.drinks_cat}])
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self), COKE(self)], claim["id"])
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.discount_amount, D("60.00"))
        self.assertEqual(order.items.get(menu_item=self.pizza).discount_amount, D("0.00"))

    def test_variant_targeted_offer(self):
        campaign = self.make_campaign(value=D("25"), scope="targets", benefit_targets=[{"option": self.large}])
        claim = self.claim(campaign)
        large = {"menu_item_id": self.coffee.id, "quantity": 1,
                 "selections": [{"group_id": self.size.id, "option_id": self.large.id}]}
        resp = self.order_with_offer([large, {"menu_item_id": self.coffee.id, "quantity": 1}], claim["id"])
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.discount_amount, D("100.00"))  # 25% of the Large (400) only

    def test_special_items_excluded_by_default(self):
        campaign = self.make_campaign(value=D("10"))
        claim = self.claim(campaign)
        only_special = self.order_with_offer([{"menu_item_id": self.momo.id, "quantity": 1}], claim["id"], expect=400)
        self.assertEqual(only_special.data["code"], "NO_ELIGIBLE_ITEMS")
        resp = self.order_with_offer([{"menu_item_id": self.momo.id, "quantity": 1}, PIZZA(self)], claim["id"])
        self.assertEqual(Order.objects.get(pk=resp.data["id"]).discount_amount, D("60.00"))


class FreeItemAndBxgyTests(OffersFixture, TestCase):
    def free_drink_campaign(self, **kw):
        return self.make_campaign(kind="free_item", benefit_targets=[{"category": self.drinks_cat}],
                                  min_order_amount=D("500"), **kw)

    def test_free_item_customer_choice(self):
        claim = self.claim(self.free_drink_campaign())
        needs = self.order_with_offer([PIZZA(self)], claim["id"], expect=400)
        self.assertEqual(needs.data["code"], "REWARD_ITEM_REQUIRED")
        self.assertEqual({o["name"] for o in needs.data["reward_options"]}, {"Coke", "Sprite", "Iced Tea"})

        resp = self.order_with_offer([PIZZA(self)], claim["id"], reward_choice={"menu_item_id": self.coke.id})
        order = Order.objects.get(pk=resp.data["id"])
        reward = order.items.get(is_promotion_reward=True)
        self.assertEqual((reward.name, reward.price, reward.discount_amount, reward.total_amount),
                         ("Coke", D("120.00"), D("120.00"), D("0.00")))
        self.assertEqual(order.discount_amount, D("120.00"))
        self.assertEqual(order.total_amount, D("678.00"))  # 600 + 13% VAT

    def test_reward_choice_must_be_part_of_the_offer(self):
        claim = self.claim(self.free_drink_campaign())
        resp = self.order_with_offer([PIZZA(self)], claim["id"], reward_choice={"menu_item_id": self.pizza.id}, expect=400)
        self.assertEqual(resp.data["code"], "INVALID_REWARD")

    def test_free_item_min_spend_ignores_the_free_item_itself(self):
        claim = self.claim(self.free_drink_campaign(title="free drink over 500"))
        resp = self.order_with_offer([COKE(self, 3)], claim["id"], reward_choice={"menu_item_id": self.sprite.id}, expect=400)
        self.assertEqual(resp.data["code"], "MINIMUM_ORDER_NOT_MET")  # 360 of paid items < 500

    def bxgy(self, **kw):
        return self.make_campaign(kind="buy_x_get_y", qualifying_targets=[{"category": self.pizza_cat}],
                                  benefit_targets=[{"category": self.drinks_cat}], **kw)

    def test_buy_pizza_get_cheapest_drink_free(self):
        claim = self.claim(self.bxgy())
        resp = self.order_with_offer([PIZZA(self), COKE(self), {"menu_item_id": self.sprite.id, "quantity": 1}], claim["id"])
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.items.get(menu_item=self.sprite).discount_amount, D("100.00"))
        self.assertEqual(order.discount_amount, D("100.00"))

    def test_bxgy_refusals(self):
        claim = self.claim(self.bxgy())
        drinks_only = self.order_with_offer([COKE(self)], claim["id"], expect=400)
        self.assertEqual(drinks_only.data["code"], "QUALIFYING_ITEMS_REQUIRED")
        self.assertEqual(drinks_only.data["error"], "Add 1 more qualifying item to use this offer.")
        pizza_only = self.order_with_offer([PIZZA(self)], claim["id"], expect=400)
        self.assertEqual(pizza_only.data["code"], "REWARD_ITEM_REQUIRED")

    def test_max_applications(self):
        once = self.claim(self.bxgy(title="once"))
        resp = self.order_with_offer([PIZZA(self, 2), COKE(self, 2)], once["id"])
        self.assertEqual(Order.objects.get(pk=resp.data["id"]).discount_amount, D("120.00"))
        twice = self.claim(self.bxgy(title="twice", max_applications=2), self.c2_user)
        resp = self.order_with_offer([PIZZA(self, 2), COKE(self, 2)], twice["id"], user=self.c2_user)
        self.assertEqual(Order.objects.get(pk=resp.data["id"]).discount_amount, D("240.00"))

    def test_same_set_bogo_never_counts_one_unit_twice(self):
        campaign = self.make_campaign(kind="buy_x_get_y", qualifying_targets=[{"category": self.pizza_cat}],
                                      benefit_targets=[{"category": self.pizza_cat}])
        claim = self.claim(campaign)
        one = self.order_with_offer([PIZZA(self)], claim["id"], expect=400)
        self.assertEqual(one.data["code"], "REWARD_ITEM_REQUIRED")
        resp = self.order_with_offer([PIZZA(self), {"menu_item_id": self.big_pizza.id, "quantity": 1}], claim["id"])
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.items.get(menu_item=self.pizza).discount_amount, D("600.00"))  # the cheaper one
        self.assertEqual(order.items.get(menu_item=self.big_pizza).discount_amount, D("0.00"))


class RefusalTests(OffersFixture, TestCase):
    def test_someone_elses_claim_is_not_found(self):
        claim = self.claim(self.make_campaign())
        resp = self.order_with_offer([PIZZA(self)], claim["id"], user=self.c2_user, expect=404)
        self.assertEqual(resp.data["code"], "NOT_FOUND")

    def test_wrong_merchant(self):
        rival_campaign = self.make_campaign(merchant=self.rival)
        claim = self.claim(rival_campaign)
        resp = self.order_with_offer([PIZZA(self)], claim["id"], expect=400)
        self.assertEqual(resp.data["code"], "WRONG_MERCHANT")

    def test_used_claim_cannot_be_reused_but_limit_two_can(self):
        single = self.claim(self.make_campaign(title="single"))
        first = self.order_with_offer([PIZZA(self)], single["id"])
        self.complete(first.data["id"])
        again = self.order_with_offer([PIZZA(self)], single["id"], expect=400)
        self.assertEqual(again.data["code"], "CLAIM_USED")

        double = self.claim(self.make_campaign(title="double", per_customer_limit=2))
        for _ in range(2):
            resp = self.order_with_offer([PIZZA(self)], double["id"])
            self.complete(resp.data["id"])
        vc = VoucherClaim.objects.get(pk=double["id"])
        self.assertEqual((vc.uses_count, vc.status), (2, "redeemed"))

    def test_claim_in_use_on_another_order(self):
        claim = self.claim(self.make_campaign())
        self.order_with_offer([PIZZA(self)], claim["id"])
        resp = self.order_with_offer([PIZZA(self)], claim["id"], expect=400)
        self.assertEqual(resp.data["code"], "CLAIM_IN_USE")

    def test_expired_and_channel(self):
        expired = self.claim(self.make_campaign(title="exp"))
        VoucherClaim.objects.filter(pk=expired["id"]).update(expires_at=timezone.now())
        self.assertEqual(self.order_with_offer([PIZZA(self)], expired["id"], expect=400).data["code"], "CLAIM_EXPIRED")
        store_only = self.claim(self.make_campaign(title="store", channels="in_store"))
        self.assertEqual(self.order_with_offer([PIZZA(self)], store_only["id"], expect=400).data["code"], "CHANNEL")

    def test_max_redemptions_counts_reservations(self):
        campaign = self.make_campaign(max_redemptions=1)
        a, b = self.claim(campaign), self.claim(campaign, self.c2_user)
        self.order_with_offer([PIZZA(self)], a["id"])  # reserved, not yet redeemed
        resp = self.order_with_offer([PIZZA(self)], b["id"], user=self.c2_user, expect=400)
        self.assertEqual(resp.data["code"], "LIMIT_REACHED")

    def test_one_discount_slot(self):
        claim = self.claim(self.make_campaign())
        order = self.pos_order([PIZZA(self)])
        disc = self.as_merchant.post("/api/pos/discount/apply/", {
            "order_id": str(order.uuid), "worker_id": str(self.worker.id),
            "discount_type": "percentage", "discount_value": "10"}, format="json")
        self.assertEqual(disc.status_code, 201)
        resp = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(resp.status_code, 409, resp.data)
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")


class LifecycleTests(OffersFixture, TestCase):
    def test_cancel_before_completion_frees_the_claim(self):
        campaign = self.make_campaign()
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self)], claim["id"])
        cancel = self.as_customer.patch(f"/api/orders/{resp.data['id']}/cancel/", {"reason": "changed_mind"}, format="json")
        self.assertEqual(cancel.status_code, 200, cancel.data)
        vc = VoucherClaim.objects.get(pk=claim["id"])
        campaign.refresh_from_db()
        self.assertEqual((vc.status, vc.reserved_order_id, campaign.reserved_count), ("available", None, 0))
        self.assertFalse(VoucherRedemption.objects.exists())
        # …and it can be used again.
        self.order_with_offer([PIZZA(self)], claim["id"])

    def test_refund_after_payment_voids_and_restores(self):
        campaign = self.make_campaign()
        claim = self.claim(campaign)
        order = self.pos_order([PIZZA(self)])
        applied = self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["qr_payload"], "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(applied.status_code, 200, applied.data)
        order.refresh_from_db()
        order.payment_status = "paid"
        order.status = Order.STATUS_COMPLETED
        order.save()
        red = VoucherRedemption.objects.get()
        self.assertEqual((red.status, red.channel), ("applied", "pos"))

        refund = self.as_merchant.post("/api/pos/refund/", {"order_id": str(order.uuid), "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(refund.status_code, 200, refund.data)
        red.refresh_from_db()
        vc = VoucherClaim.objects.get(pk=claim["id"])
        campaign.refresh_from_db()
        self.assertEqual(red.status, "voided")
        self.assertEqual((vc.status, vc.uses_count, campaign.redemptions_count), ("available", 0, 0))

    def test_refund_without_restore(self):
        campaign = self.make_campaign(restore_on_cancel=False)
        claim = self.claim(campaign)
        order = self.pos_order([PIZZA(self)])
        self.as_merchant.post("/api/offers/pos/apply/", {
            "order_id": str(order.uuid), "code": claim["code"], "worker_id": str(self.worker.id)}, format="json")
        order.refresh_from_db()
        order.payment_status = "paid"
        order.save()
        self.as_merchant.post("/api/pos/refund/", {"order_id": str(order.uuid), "worker_id": str(self.worker.id)}, format="json")
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "redeemed")

    def test_offer_follows_order_changes_and_is_not_burned_if_it_stops_applying(self):
        campaign = self.make_campaign(min_order_amount=D("1000"))
        claim = self.claim(campaign)
        resp = self.order_with_offer([PIZZA(self, 2)], claim["id"])  # 1200
        order = Order.objects.get(pk=resp.data["id"])
        self.assertEqual(order.discount_amount, D("240.00"))

        added = self.as_customer.post(f"/api/orders/{order.id}/add-items/", {"items": [COKE(self)]}, format="json")
        self.assertEqual(added.status_code, 200, added.data)
        order.refresh_from_db()
        self.assertEqual(order.discount_amount, D("264.00"))

        pizza_line = order.items.get(menu_item=self.pizza)
        pizza_line.quantity = 1
        pizza_line.subtotal = D("600.00")
        pizza_line.save()
        result = reprice_order(order)  # 720 < 1000
        self.assertEqual(result.discount_total, D("0.00"))
        self.assertEqual(result.messages[0]["code"], "MINIMUM_ORDER_NOT_MET")

        self.complete(order.id)
        vc = VoucherClaim.objects.get(pk=claim["id"])
        self.assertEqual((vc.status, vc.uses_count), ("available", 0))
        self.assertFalse(VoucherRedemption.objects.exists())
        campaign.refresh_from_db()
        self.assertEqual(campaign.reserved_count, 0)

    def test_deleting_an_open_order_releases_the_claim(self):
        claim = self.claim(self.make_campaign())
        resp = self.order_with_offer([PIZZA(self)], claim["id"])
        Order.objects.get(pk=resp.data["id"]).delete()
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "available")

    def test_redemption_history_survives_order_and_customer_deletion(self):
        claim = self.claim(self.make_campaign())
        resp = self.order_with_offer([PIZZA(self)], claim["id"])
        self.complete(resp.data["id"])
        Order.objects.get(pk=resp.data["id"]).delete()
        self.c_user.delete()
        red = VoucherRedemption.objects.get()
        self.assertIsNone(red.order_id)
        self.assertEqual(red.discount_amount, D("120.00"))

    def test_second_order_is_a_returning_customer(self):
        OrderItem  # noqa: B018  (imported for clarity)
        first_claim = self.claim(self.make_campaign(title="a"))
        self.complete(self.order_with_offer([PIZZA(self)], first_claim["id"]).data["id"])
        second_claim = self.claim(self.make_campaign(title="b"))
        self.complete(self.order_with_offer([PIZZA(self)], second_claim["id"]).data["id"])
        self.assertEqual(
            list(VoucherRedemption.objects.order_by("id").values_list("is_new_customer", flat=True)), [True, False],
        )


class PreviewAndMyOffersTests(OffersFixture, TestCase):
    def test_order_preview_with_offer(self):
        claim = self.claim(self.make_campaign(min_order_amount=D("1000")))
        ok = self.as_customer.post("/api/orders/preview/", {
            "merchant_id": self.merchant.id, "items": [PIZZA(self, 2)], "claim_id": claim["id"]}, format="json")
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(ok.data["offer"], {"eligible": True, "discount_amount": "240.00"})
        self.assertEqual(ok.data["discount_amount"], "240.00")
        self.assertEqual(ok.data["total_amount"], "1084.80")
        short = self.as_customer.post("/api/orders/preview/", {
            "merchant_id": self.merchant.id, "items": [PIZZA(self)], "claim_id": claim["id"]}, format="json")
        self.assertFalse(short.data["offer"]["eligible"])
        self.assertEqual(short.data["offer"]["error"], "Add Rs 400.00 more to use this offer.")
        self.assertEqual(short.data["discount_amount"], "0.00")
        other = self.client_for(self.c2_user).post("/api/orders/preview/", {
            "merchant_id": self.merchant.id, "items": [PIZZA(self)], "claim_id": claim["id"]}, format="json")
        self.assertEqual(other.status_code, 404)

    def test_my_offers_tabs(self):
        live = self.claim(self.make_campaign(title="live"))
        used = self.claim(self.make_campaign(title="used"))
        old = self.claim(self.make_campaign(title="old"))
        VoucherClaim.objects.filter(pk=old["id"]).update(expires_at=timezone.now())
        self.complete(self.order_with_offer([PIZZA(self)], used["id"]).data["id"])

        def tab(name):
            return {c["offer"]["title"] for c in self.as_customer.get(f"/api/offers/mine/?tab={name}").data}

        self.assertEqual(tab("available"), {"live"})
        self.assertEqual(tab("used"), {"used"})
        self.assertEqual(tab("expired"), {"old"})
        self.assertEqual(self.client_for(self.c2_user).get(f"/api/offers/mine/{live['id']}/").status_code, 404)

    def test_claim_preview_endpoint(self):
        claim = self.claim(self.make_campaign(kind="free_item", benefit_targets=[{"menu_item": self.coke}]))
        resp = self.as_customer.post(f"/api/offers/mine/{claim['id']}/preview/", {"items": [PIZZA(self)]}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data["eligible"])
        self.assertEqual(resp.data["reward_options"][0]["name"], "Coke")
        resp = self.as_customer.post(f"/api/offers/mine/{claim['id']}/preview/", {
            "items": [PIZZA(self)], "reward_choice": {"menu_item_id": self.coke.id}}, format="json")
        self.assertTrue(resp.data["eligible"])
        self.assertEqual(resp.data["discount_amount"], "120.00")


class MaintenanceTests(OffersFixture, TestCase):
    def test_expire_end_and_return_rates(self):
        campaign = self.make_campaign(ends_at=self.days(1))
        claim = self.claim(campaign)
        self.complete(self.order_with_offer([PIZZA(self)], claim["id"]).data["id"])
        spare = self.claim(campaign, self.c2_user)
        VoucherClaim.objects.filter(pk=spare["id"]).update(expires_at=timezone.now())
        PromotionCampaign.objects.filter(pk=campaign.pk).update(ends_at=timezone.now(), starts_at=None)
        self.assertEqual(expire_claims(), 1)
        self.assertEqual(end_finished_campaigns(), 1)

        red = VoucherRedemption.objects.get()
        VoucherRedemption.objects.filter(pk=red.pk).update(created_at=timezone.now() - timezone.timedelta(days=31))
        later = Order.objects.create(customer=self.customer, merchant=self.merchant, total_amount=10, subtotal=10)
        Order.objects.filter(pk=later.pk).update(created_at=timezone.now() - timezone.timedelta(days=29))
        self.assertEqual(backfill_return_rates(), 2)
        red.refresh_from_db()
        self.assertEqual((red.returned_within_7d, red.returned_within_30d), (True, True))
