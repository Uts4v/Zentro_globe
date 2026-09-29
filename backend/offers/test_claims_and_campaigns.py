"""
Offers: codes, claiming, discovery and the merchant campaign editor.

Run with: python manage.py test offers
"""

from decimal import Decimal

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from .codes import format_code, generate_code, normalize_code, parse_scan
from .engine import OfferError, claim_offer
from .models import PromotionCampaign, VoucherClaim
from .testing import D, OffersFixture


class CodeTests(SimpleTestCase):
    def test_round_trip_and_display(self):
        for _ in range(200):
            code = generate_code()
            self.assertEqual(normalize_code(format_code(code)), code)
            self.assertEqual(normalize_code(format_code(code).lower()), code)
            self.assertRegex(format_code(code), r"^ZNT-[0-9A-Z]{4}-[0-9A-Z]{5}$")

    def test_single_typo_is_rejected_by_the_check_character(self):
        code = generate_code()
        alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        rejected = 0
        for pos in range(8):
            for ch in alphabet:
                if ch != code[pos]:
                    typo = code[:pos] + ch + code[pos + 1:]
                    rejected += normalize_code(typo) is None
        self.assertEqual(rejected, 8 * 31)

    def test_confusable_letters_are_read_as_digits(self):
        code = "0" + generate_code()[1:]
        body = code[:-1]
        from .codes import _check_char
        code = body + _check_char(body)
        self.assertEqual(normalize_code("O" + code[1:]), code)

    def test_parse_scan(self):
        self.assertEqual(parse_scan("zentro://offer/abcdefghijklmnopqrstuv"), ("token", "abcdefghijklmnopqrstuv"))
        code = generate_code()
        self.assertEqual(parse_scan(format_code(code)), ("code", code))
        self.assertIsNone(parse_scan("hello"))
        self.assertIsNone(parse_scan(""))


class ClaimTests(OffersFixture, TestCase):
    def test_claim_returns_code_and_qr_and_is_idempotent(self):
        campaign = self.make_campaign(claim_valid_days=7, ends_at=self.days(3))
        first = self.as_customer.post(f"/api/offers/{campaign.id}/claim/", {}, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertRegex(first.data["code"], r"^ZNT-")
        self.assertTrue(first.data["qr_payload"].startswith("zentro://offer/"))
        second = self.as_customer.post(f"/api/offers/{campaign.id}/claim/", {}, format="json")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["id"], first.data["id"])
        campaign.refresh_from_db()
        self.assertEqual(campaign.claims_count, 1)
        claim = VoucherClaim.objects.get()
        self.assertEqual(claim.expires_at, campaign.ends_at)  # capped at the campaign end

    def test_max_claims(self):
        campaign = self.make_campaign(max_claims=1)
        self.claim(campaign)
        resp = self.client_for(self.c2_user).post(f"/api/offers/{campaign.id}/claim/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["code"], "LIMIT_REACHED")

    def test_link_only_offer_needs_the_token(self):
        campaign = self.make_campaign(visibility="link_only")
        self.assertEqual(self.as_customer.post(f"/api/offers/{campaign.id}/claim/", {}, format="json").status_code, 404)
        self.assertEqual(self.as_customer.get(f"/api/offers/{campaign.id}/").status_code, 404)
        ok = self.as_customer.post(f"/api/offers/{campaign.id}/claim/", {"t": campaign.link_token}, format="json")
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(VoucherClaim.objects.get().source, "link")
        self.assertEqual(self.client_for().get("/api/offers/").data["count"], 0)

    def test_states_that_cannot_be_claimed(self):
        paused = self.make_campaign(status="paused")
        self.assertEqual(self.as_customer.post(f"/api/offers/{paused.id}/claim/").data["code"], "NOT_CLAIMABLE")
        future = self.make_campaign(starts_at=self.days(2))
        self.assertEqual(self.as_customer.post(f"/api/offers/{future.id}/claim/").data["code"], "NOT_STARTED")
        hidden = self.make_campaign(is_hidden_by_admin=True)
        self.assertEqual(self.as_customer.post(f"/api/offers/{hidden.id}/claim/").status_code, 404)
        self.merchant.is_approved = False
        self.merchant.save()
        live = self.make_campaign()
        self.assertEqual(self.as_customer.post(f"/api/offers/{live.id}/claim/").status_code, 404)

    def test_only_customers_can_claim(self):
        campaign = self.make_campaign()
        self.assertEqual(self.as_merchant.post(f"/api/offers/{campaign.id}/claim/").status_code, 403)
        self.assertEqual(self.client_for().post(f"/api/offers/{campaign.id}/claim/").status_code, 401)

    def test_engine_refuses_ended_campaign(self):
        campaign = self.make_campaign(starts_at=self.days(-5), ends_at=self.days(-1))
        with self.assertRaises(OfferError) as ctx:
            claim_offer(campaign.id, self.customer)
        self.assertEqual(ctx.exception.code, "NOT_CLAIMABLE")


class DiscoveryTests(OffersFixture, TestCase):
    def test_list_shows_live_public_offers_with_details(self):
        live = self.make_campaign(title="20% off", min_order_amount=D("1000"))
        self.make_campaign(status="draft")
        self.make_campaign(status="paused")
        self.make_campaign(ends_at=self.days(-1), starts_at=self.days(-3))
        self.make_campaign(merchant=self.rival, title="rival")
        data = self.client_for().get("/api/offers/").data
        titles = {r["title"] for r in data["results"]}
        self.assertEqual(titles, {"20% off", "rival"})
        card = next(r for r in data["results"] if r["id"] == live.id)
        self.assertEqual(card["summary"], "20% off your order")
        self.assertIn("Min. spend Rs 1,000", card["conditions"])
        self.assertEqual(card["merchant"]["category"]["slug"], "cafe")
        self.assertNotIn("qr_payload", card)

    def test_filters_and_claimed_flag(self):
        mine = self.make_campaign(title="Cafe deal")
        self.make_campaign(merchant=self.rival, title="Rival deal")
        self.claim(mine)
        by_parent = self.client_for().get("/api/offers/?category=food-drink").data["results"]
        self.assertEqual([r["title"] for r in by_parent], ["Cafe deal"])
        self.assertEqual(self.client_for().get("/api/offers/?q=rival").data["count"], 1)
        self.assertEqual(self.client_for().get("/api/offers/?city=kathmandu&area=thamel").data["count"], 1)
        results = self.as_customer.get("/api/offers/").data["results"]
        self.assertEqual({r["title"]: bool(r["my_claim_id"]) for r in results}, {"Cafe deal": True, "Rival deal": False})

    def test_near_me_sorts_by_distance_and_respects_radius(self):
        self.make_campaign(title="Near")
        self.rival.latitude, self.rival.longitude = D("27.7300"), D("85.3300")
        self.rival.save()
        self.make_campaign(merchant=self.rival, title="Farther")
        data = self.client_for().get("/api/offers/?lat=27.7150&lng=85.3120&radius_km=5").data
        self.assertEqual([r["title"] for r in data["results"]], ["Near", "Farther"])
        self.assertLess(data["results"][0]["distance_km"], 0.1)
        tight = self.client_for().get("/api/offers/?lat=27.7150&lng=85.3120&radius_km=0.5").data
        self.assertEqual([r["title"] for r in tight["results"]], ["Near"])

    def test_categories_and_areas(self):
        self.make_campaign()
        cats = self.client_for().get("/api/offers/categories/").data
        food = next(c for c in cats if c["slug"] == "food-drink")
        self.assertIn("cafe", [c["slug"] for c in food["children"]])
        self.assertEqual(self.client_for().get("/api/offers/areas/").data, [{"city": "Kathmandu", "areas": ["Thamel"]}])

    def test_detail_records_views(self):
        campaign = self.make_campaign()
        self.client_for().get(f"/api/offers/{campaign.id}/")
        self.as_customer.get(f"/api/offers/{campaign.id}/")
        self.as_customer.get(f"/api/offers/{campaign.id}/")
        stats = self.as_merchant.get(f"/api/offers/merchant/campaigns/{campaign.id}/stats/").data
        self.assertEqual(stats["views"], 3)
        self.assertEqual(stats["unique_viewers"], 2)


class MerchantCampaignTests(OffersFixture, TestCase):
    def payload(self, **overrides):
        data = {
            "title": "Pizza + drink",
            "benefit": {"kind": "buy_x_get_y", "reward_quantity": 1},
            "qualifying_quantity": 1,
            "targets": [
                {"role": "qualifying", "category": self.pizza_cat.id},
                {"role": "benefit", "category": self.drinks_cat.id},
            ],
        }
        data.update(overrides)
        return data

    def test_create_publish_and_describe(self):
        resp = self.as_merchant.post("/api/offers/merchant/campaigns/", self.payload(), format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["status"], "draft")
        self.assertEqual(resp.data["summary"], "Buy 1 Pizza, get Cold Drinks free")
        self.assertEqual(resp.data["qualifying_quantity"], 1)
        pub = self.as_merchant.post(f"/api/offers/merchant/campaigns/{resp.data['id']}/publish/")
        self.assertEqual(pub.status_code, 200, pub.data)
        self.assertEqual(pub.data["effective_status"], "active")

    def test_validation(self):
        bad = [
            {"benefit": {"kind": "percent_off", "value": "150"}, "targets": []},
            {"benefit": {"kind": "amount_off"}, "targets": []},
            {"benefit": {"kind": "buy_x_get_y"}, "targets": [{"role": "benefit", "menu_item": self.coke.id}]},
            {"benefit": {"kind": "free_item"}, "targets": []},
            {"benefit": {"kind": "percent_off", "value": "10", "scope": "targets"}, "targets": []},
            {"benefit": {"kind": "percent_off", "value": "10"}, "targets": [{"role": "qualifying", "menu_item": self.coke.id}]},
            {"ends_at": timezone.now().isoformat(), "starts_at": self.days(1).isoformat()},
        ]
        for overrides in bad:
            with self.subTest(overrides=overrides):
                resp = self.as_merchant.post("/api/offers/merchant/campaigns/", self.payload(**overrides), format="json")
                self.assertEqual(resp.status_code, 400, resp.data)

    def test_cannot_target_another_merchants_products(self):
        resp = self.as_merchant.post("/api/offers/merchant/campaigns/", self.payload(targets=[
            {"role": "qualifying", "category": self.pizza_cat.id},
            {"role": "benefit", "menu_item": self.rival_item.id},
        ]), format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(PromotionCampaign.objects.exists())

    def test_rules_lock_once_claimed_but_safe_edits_work(self):
        campaign = self.make_campaign(ends_at=self.days(10))
        self.claim(campaign)
        url = f"/api/offers/merchant/campaigns/{campaign.id}/"
        locked = self.as_merchant.patch(url, {"benefit": {"kind": "percent_off", "value": "50"}}, format="json")
        self.assertEqual(locked.status_code, 400)
        self.assertIn("Duplicate", str(locked.data))
        same = self.as_merchant.get(url).data
        resend = self.as_merchant.patch(url, {"benefit": {"kind": "percent_off", "value": same["benefit"]["value"],
                                                          "scope": "order"}, "title": "Renamed"}, format="json")
        self.assertEqual(resend.status_code, 200, resend.data)
        self.assertEqual(resend.data["title"], "Renamed")
        shorter = self.as_merchant.patch(url, {"ends_at": self.days(5).isoformat()}, format="json")
        self.assertEqual(shorter.status_code, 400)
        longer = self.as_merchant.patch(url, {"ends_at": self.days(20).isoformat()}, format="json")
        self.assertEqual(longer.status_code, 200, longer.data)

    def test_partial_target_update_keeps_qualifying_quantity(self):
        resp = self.as_merchant.post("/api/offers/merchant/campaigns/", self.payload(qualifying_quantity=2), format="json")
        cid = resp.data["id"]
        patched = self.as_merchant.patch(f"/api/offers/merchant/campaigns/{cid}/", {"targets": [
            {"role": "qualifying", "menu_item": self.pizza.id},
            {"role": "benefit", "menu_item": self.coke.id},
        ]}, format="json")
        self.assertEqual(patched.status_code, 200, patched.data)
        self.assertEqual(patched.data["qualifying_quantity"], 2)

    def test_tenant_isolation(self):
        campaign = self.make_campaign()
        rival = self.client_for(self.r_user)
        self.assertEqual(rival.get(f"/api/offers/merchant/campaigns/{campaign.id}/").status_code, 404)
        self.assertEqual(rival.patch(f"/api/offers/merchant/campaigns/{campaign.id}/", {"title": "x"}, format="json").status_code, 404)
        self.assertEqual(rival.post(f"/api/offers/merchant/campaigns/{campaign.id}/pause/").status_code, 404)
        self.assertEqual(rival.get(f"/api/offers/merchant/campaigns/{campaign.id}/stats/").status_code, 404)
        self.assertEqual(self.as_customer.get("/api/offers/merchant/campaigns/").status_code, 403)

    def test_duplicate_delete_and_lifecycle_actions(self):
        campaign = self.make_campaign(kind="buy_x_get_y", qualifying_targets=[{"category": self.pizza_cat}],
                                      benefit_targets=[{"category": self.drinks_cat}], qualifying_quantity=2)
        copy = self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/duplicate/")
        self.assertEqual(copy.status_code, 201, copy.data)
        self.assertEqual(copy.data["status"], "draft")
        self.assertEqual(copy.data["qualifying_quantity"], 2)
        self.assertEqual(len(copy.data["targets"]), 2)
        self.assertEqual(self.as_merchant.delete(f"/api/offers/merchant/campaigns/{copy.data['id']}/").status_code, 204)
        self.assertEqual(self.as_merchant.delete(f"/api/offers/merchant/campaigns/{campaign.id}/").status_code, 400)
        self.assertEqual(self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/pause/").data["status"], "paused")
        self.assertEqual(self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/resume/").data["status"], "published")
        self.assertEqual(self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/end/").data["status"], "ended")
        self.assertEqual(self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/archive/").data["status"], "archived")
        listed = self.as_merchant.get("/api/offers/merchant/campaigns/").data
        self.assertNotIn(campaign.id, [c["id"] for c in listed])

    def test_end_and_revoke_stops_existing_claims(self):
        campaign = self.make_campaign()
        claim = self.claim(campaign)
        self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/end/", {"revoke_claims": True}, format="json")
        self.assertEqual(VoucherClaim.objects.get(pk=claim["id"]).status, "revoked")

    def test_end_without_revoke_honours_claims(self):
        campaign = self.make_campaign()
        claim = self.claim(campaign)
        self.as_merchant.post(f"/api/offers/merchant/campaigns/{campaign.id}/end/")
        resp = self.order_with_offer([{"menu_item_id": self.pizza.id, "quantity": 1}], claim["id"])
        self.assertEqual(Decimal(resp.data["discount_amount"]), D("120.00"))
