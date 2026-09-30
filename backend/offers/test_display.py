"""
Presentation fields the customer Offers screens read: badge, "what you get"
lines, the used-voucher receipt, and search by category / product.

Run with: python manage.py test offers.test_display
"""

import uuid

from django.test import TestCase

from .testing import D, OffersFixture


class BadgeAndRewardLineTests(OffersFixture, TestCase):
    def card(self, campaign):
        resp = self.client_for().get(f"/api/offers/{campaign.id}/")
        self.assertEqual(resp.status_code, 200, resp.data)
        return resp.data

    def test_badges(self):
        cases = [
            (self.make_campaign(value=D("20"), title="a"), "20% OFF"),
            (self.make_campaign("amount_off", value=D("150"), title="b"), "Rs 150 OFF"),
            (self.make_campaign("free_item", benefit_targets=[{"menu_item": self.coke}], title="c"), "FREE ITEM"),
            (self.make_campaign("buy_x_get_y", qualifying_targets=[{"menu_item": self.pizza}],
                                benefit_targets=[{"menu_item": self.coke}], title="d"), "BUY 1 GET 1 FREE"),
            (self.make_campaign("buy_x_get_y", qualifying_quantity=2, reward_quantity=2,
                                qualifying_targets=[{"menu_item": self.pizza}],
                                benefit_targets=[{"menu_item": self.coke}], title="e"), "BUY 2 GET 2 FREE"),
        ]
        for campaign, badge in cases:
            self.assertEqual(self.card(campaign)["badge"], badge)

    def test_what_you_get_splits_buy_x_get_y(self):
        campaign = self.make_campaign("buy_x_get_y", qualifying_targets=[{"menu_item": self.pizza}],
                                      benefit_targets=[{"menu_item": self.coke}])
        self.assertEqual(self.card(campaign)["what_you_get"], ["Buy 1 × Pizza", "Get 1 × Coke free"])
        percent = self.make_campaign(value=D("10"), title="p")
        self.assertEqual(self.card(percent)["what_you_get"], ["10% off your order"])

    def test_claim_carries_the_same_display_fields(self):
        claim = self.claim(self.make_campaign(value=D("20"), description="On everything."))
        self.assertEqual(claim["offer"]["badge"], "20% OFF")
        self.assertEqual(claim["offer"]["description"], "On everything.")
        self.assertIsNone(claim["last_use"])


class LastUseTests(OffersFixture, TestCase):
    def test_used_voucher_from_an_order_links_the_order(self):
        claim = self.claim(self.make_campaign(value=D("20")))
        resp = self.order_with_offer([{"menu_item_id": self.pizza.id, "quantity": 1}], claim["id"])
        self.complete(resp.data["id"])
        used = self.as_customer.get("/api/offers/mine/?tab=used").data
        self.assertEqual(len(used), 1)
        self.assertEqual(used[0]["last_use"]["discount_amount"], "120.00")
        self.assertEqual(used[0]["last_use"]["order_id"], resp.data["id"])

    def test_counter_use_has_no_order_link(self):
        self.merchant.pos_enabled = False
        self.merchant.save()
        claim = self.claim(self.make_campaign(value=D("10")))
        self.as_merchant.post("/api/offers/merchant/redeem/confirm/", {
            "code": claim["code"], "idempotency_key": str(uuid.uuid4()), "bill_amount": "500",
        }, format="json")
        mine = self.as_customer.get(f"/api/offers/mine/{claim['id']}/").data
        self.assertEqual(mine["tab"], "used")
        self.assertEqual(mine["last_use"]["discount_amount"], "50.00")
        self.assertIsNone(mine["last_use"]["order_id"])


class SearchTests(OffersFixture, TestCase):
    def search(self, q):
        return [o["id"] for o in self.client_for().get("/api/offers/", {"q": q}).data["results"]]

    def test_search_by_category_and_product(self):
        drinks = self.make_campaign("free_item", benefit_targets=[{"menu_item": self.coke}], title="Thirsty")
        other = self.make_campaign(value=D("5"), title="Plain")
        self.assertEqual(self.search("coke"), [drinks.id])
        self.assertEqual(sorted(self.search("café")), sorted([drinks.id, other.id]))
        self.assertEqual(self.search("nothing-like-this"), [])
