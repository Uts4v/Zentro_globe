"""
AI Menu Scanner — upload sniffing, JSON parsing and the scan endpoint.

Run with: python manage.py test merchants.test_menu_scanner

Gemini is mocked; these tests never hit the network.
"""

import json
from decimal import Decimal
from unittest import mock

import requests
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from merchants.ai.gemini_scanner import MenuScanError, parse_menu, sniff_menu_upload
from merchants.models import MenuCategory, MenuItem, MenuOptionGroup, MerchantProfile

URL = "/api/merchants/menu-items/scan-menu/"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"\x00" * 64

MENU = {"items": [
    {
        "category": "Hot Coffee", "name": "Latte", "emoji": "☕", "price": 200,
        "description": "Espresso, steamed milk", "dietary_tags": ["Vegetarian"],
        "allergens": ["dairy"], "calories": 190, "is_featured": True,
        "variant_group": "Size",
        "variants": [{"name": "Regular", "price": 200}, {"name": "Large", "price": 280}],
        "add_ons": [{"name": "Extra shot", "price": 60}, {"name": "Oat milk", "price": 50}],
    },
    {
        "category": "Hot Coffee", "name": "Americano", "emoji": "coffee", "price": "Rs 180",
        "description": "", "dietary_tags": [], "allergens": [], "calories": None,
        "variants": [], "add_ons": [],
    },
    {
        "category": "Burgers", "name": "Veg Burger", "emoji": "🍔", "price": "1,250.50",
        "dietary_tags": ["vegetarian", "spicy"], "allergens": ["gluten", "sesame"],
        "variants": [{"name": "Only size", "price": 999}],
    },
    {"category": "Burgers", "name": "Mystery Item", "price": None, "variants": []},
]}
MENU_JSON = json.dumps(MENU, ensure_ascii=False)


PRIMARY = "gemini-3.8-flash"
FALLBACK = "gemini-3.5-flash-lite"


def _called_models(post):
    return [c.args[0].split("/models/")[1].split(":")[0] for c in post.call_args_list]


def _quota_response(*, daily):
    quota_id = "GenerateRequestsPerDayPerProjectPerModel-FreeTier" if daily else "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"
    resp = mock.Mock(status_code=429, text="RESOURCE_EXHAUSTED")
    resp.json.return_value = {"error": {"code": 429, "details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": [{"quotaId": quota_id, "quotaValue": "20"}]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "29s"},
    ]}}
    return resp


def _gemini_response(text, finish_reason="STOP"):
    resp = mock.Mock(status_code=200)
    resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish_reason}],
    }
    return resp


class ParseMenuTests(TestCase):
    def test_reads_every_field(self):
        items, skipped = parse_menu(MENU_JSON)
        self.assertEqual(skipped, 1)  # "Mystery Item" has no price anywhere
        latte, americano, burger = items

        self.assertEqual(latte.price, Decimal("200.00"))
        self.assertEqual(latte.emoji, "☕")
        self.assertEqual(latte.dietary_tags, ["vegetarian"])
        self.assertEqual(latte.allergens, ["dairy"])
        self.assertEqual(latte.calories, 190)
        self.assertTrue(latte.is_featured)
        self.assertEqual([(v.name, v.price) for v in latte.variants],
                         [("Regular", Decimal("200.00")), ("Large", Decimal("280.00"))])
        self.assertEqual([a.name for a in latte.add_ons], ["Extra shot", "Oat milk"])

        self.assertEqual(americano.price, Decimal("180.00"))
        self.assertEqual(americano.emoji, "🍽️")  # a word is not an emoji
        self.assertIsNone(americano.calories)

        self.assertEqual(burger.price, Decimal("1250.50"))  # explicit price wins
        self.assertEqual(burger.variants, [])  # a single variant is just the price
        self.assertEqual(burger.allergens, ["gluten", "sesame"])

    def test_variants_set_the_base_price_when_price_missing(self):
        items, _ = parse_menu(json.dumps({"items": [{
            "category": "Pizza", "name": "Margherita", "price": None,
            "variants": [{"name": "Large", "price": 900}, {"name": "Small", "price": 500}],
        }]}))
        self.assertEqual(items[0].price, Decimal("500.00"))

    def test_truncated_json_keeps_complete_items(self):
        cut = MENU_JSON[: MENU_JSON.index('"Veg Burger"') + 5]
        items, _ = parse_menu(cut)
        self.assertEqual([i.name for i in items], ["Latte", "Americano"])

    def test_tolerates_fences_and_blank_category(self):
        items, _ = parse_menu('```json\n{"items":[{"category":"","name":"Water","price":20}]}\n```')
        self.assertEqual(items[0].category, "Menu")


class SniffUploadTests(TestCase):
    def test_accepts_by_magic_bytes_not_name(self):
        _, mime = sniff_menu_upload(SimpleUploadedFile("menu.txt", PNG))
        self.assertEqual(mime, "image/png")
        _, mime = sniff_menu_upload(SimpleUploadedFile("menu.jpg", PDF))
        self.assertEqual(mime, "application/pdf")

    def test_rejects_other_content(self):
        with self.assertRaises(MenuScanError):
            sniff_menu_upload(SimpleUploadedFile("menu.png", b"<svg></svg>"))


@override_settings(AI_GEMINI_API_KEY="test-key", AI_MENU_SCANNER_MODELS=[PRIMARY, FALLBACK])
class ScanMenuEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(
            username="scan", email="scan@test.com", password="Pass123!", role="merchant"
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.user, business_name="Scan Cafe", slug="scan-cafe",
            is_approved=True, is_open=True,
        )
        self.client.force_authenticate(user=self.user)

    def _scan(self, content=PNG, name="menu.png"):
        return self.client.post(URL, {"file": SimpleUploadedFile(name, content)}, format="multipart")

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_saves_items_with_all_details(self, post):
        post.return_value = _gemini_response(MENU_JSON)
        resp = self._scan()

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["items_count"], 3)
        self.assertEqual(resp.data["categories_count"], 2)
        self.assertEqual(resp.data["variants_count"], 2)
        self.assertEqual(resp.data["add_ons_count"], 2)
        self.assertEqual(resp.data["rows_skipped"], 1)
        self.assertFalse(resp.data["truncated"])

        latte = MenuItem.objects.get(merchant=self.merchant, name="Latte")
        self.assertEqual(latte.category_ref.name, "Hot Coffee")
        self.assertEqual(latte.emoji, "☕")
        self.assertEqual(latte.allergens, ["dairy"])
        self.assertEqual(latte.calories, 190)
        self.assertTrue(latte.is_featured)
        self.assertEqual(latte.status, MenuItem.STATUS_ACTIVE)

        size = latte.option_groups.get(kind=MenuOptionGroup.KIND_VARIANT)
        self.assertEqual(size.name, "Size")
        self.assertTrue(size.required)
        self.assertEqual(
            list(size.options.values_list("name", "price", "is_default")),
            [("Regular", Decimal("200.00"), True), ("Large", Decimal("280.00"), False)],
        )
        addons = latte.option_groups.get(kind=MenuOptionGroup.KIND_MODIFIER)
        self.assertFalse(addons.required)
        self.assertEqual(addons.max_select, 2)
        self.assertEqual(
            list(addons.options.values_list("name", "price_delta")),
            [("Extra shot", Decimal("60.00")), ("Oat milk", Decimal("50.00"))],
        )
        self.assertFalse(MenuItem.objects.get(name="Americano").option_groups.exists())

        sent = post.call_args.kwargs
        self.assertEqual(sent["headers"], {"x-goog-api-key": "test-key"})
        self.assertEqual(sent["json"]["generationConfig"]["responseMimeType"], "application/json")

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_scan_clears_public_menu_cache(self, post):
        cache.set(f"zentro:menu:{self.merchant.pk}", ["stale"])
        post.return_value = _gemini_response(MENU_JSON)
        with self.captureOnCommitCallbacks(execute=True):
            self._scan()
        self.assertIsNone(cache.get(f"zentro:menu:{self.merchant.pk}"))

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_reuses_existing_category_and_skips_duplicates(self, post):
        cat = MenuCategory.objects.create(merchant=self.merchant, name="hot coffee")
        MenuItem.objects.create(
            merchant=self.merchant, name="LATTE", price=200, category="hot coffee", category_ref=cat,
        )
        post.return_value = _gemini_response(MENU_JSON)
        resp = self._scan()

        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["items_count"], 2)
        self.assertEqual(resp.data["duplicates_skipped"], 1)
        self.assertEqual(resp.data["categories_count"], 1)  # only "Burgers" is new
        self.assertEqual(resp.data["variants_count"], 0)  # the Latte was skipped
        self.assertEqual(MenuItem.objects.get(name="Americano").category_ref_id, cat.pk)

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_truncated_output_saves_complete_items_and_says_so(self, post):
        cut = MENU_JSON[: MENU_JSON.index('"Veg Burger"') + 5]
        post.return_value = _gemini_response(cut, "MAX_TOKENS")
        resp = self._scan(PDF, "menu.pdf")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data["truncated"])
        self.assertEqual(sorted(MenuItem.objects.values_list("name", flat=True)), ["Americano", "Latte"])

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_nothing_readable_returns_422_and_writes_nothing(self, post):
        post.return_value = _gemini_response('{"items": []}')
        resp = self._scan()
        self.assertEqual(resp.status_code, 422)
        self.assertFalse(MenuCategory.objects.exists())

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_gemini_error_is_reported(self, post):
        post.return_value = mock.Mock(status_code=400, text="bad request")
        resp = self._scan()
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(_called_models(post), [PRIMARY, FALLBACK])
        self.assertFalse(MenuItem.objects.exists())

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_overloaded_model_falls_back_to_next(self, post):
        post.side_effect = [mock.Mock(status_code=503, text="high demand"), _gemini_response(MENU_JSON)]
        resp = self._scan()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["model"], FALLBACK)
        self.assertEqual(_called_models(post), [PRIMARY, FALLBACK])

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_all_models_overloaded_returns_busy(self, post):
        post.return_value = mock.Mock(status_code=503, text="high demand")
        resp = self._scan()
        self.assertEqual(resp.status_code, 503)
        self.assertIn("busy", resp.data["error"])
        self.assertEqual(post.call_count, 2)

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_hanging_model_falls_back_and_is_skipped_next_time(self, post):
        post.side_effect = [requests.Timeout(), _gemini_response(MENU_JSON)]
        resp = self._scan()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["model"], FALLBACK)

        post.reset_mock()
        post.side_effect = [_gemini_response('{"items": [{"category": "Tea", "name": "Chai", "price": 60}]}')]
        self._scan()
        self.assertEqual(_called_models(post), [FALLBACK])

    @mock.patch("merchants.ai.gemini_scanner.SCAN_DEADLINE_SECONDS", 0)
    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_stops_trying_models_after_the_deadline(self, post):
        resp = self._scan()
        self.assertEqual(resp.status_code, 503)
        post.assert_not_called()

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_daily_quota_falls_back_without_retrying(self, post):
        post.side_effect = [_quota_response(daily=True), _gemini_response(MENU_JSON)]
        resp = self._scan()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["model"], FALLBACK)
        self.assertEqual(_called_models(post), [PRIMARY, FALLBACK])

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_exhausted_model_is_skipped_by_later_scans(self, post):
        post.side_effect = [_quota_response(daily=True), _gemini_response(MENU_JSON)]
        self._scan()
        post.reset_mock()
        post.side_effect = [_gemini_response('{"items": [{"category": "Tea", "name": "Chai", "price": 60}]}')]

        resp = self._scan()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(_called_models(post), [FALLBACK])

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_all_daily_quotas_used_says_try_tomorrow(self, post):
        post.return_value = _quota_response(daily=True)
        resp = self._scan()
        self.assertEqual(resp.status_code, 503)
        self.assertIn("tomorrow", resp.data["error"])
        self.assertEqual(post.call_count, 2)

        post.reset_mock()
        self.assertIn("tomorrow", self._scan().data["error"])
        post.assert_not_called()  # both models are known to be out until the reset

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_per_minute_limit_says_busy(self, post):
        post.return_value = _quota_response(daily=False)
        resp = self._scan()
        self.assertEqual(resp.status_code, 503)
        self.assertIn("busy", resp.data["error"])

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_retired_model_falls_back(self, post):
        post.side_effect = [mock.Mock(status_code=404, text="no longer available"), _gemini_response(MENU_JSON)]
        resp = self._scan()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["model"], FALLBACK)

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_rejected_key_stops_without_trying_other_models(self, post):
        post.return_value = mock.Mock(status_code=403, text="API key not valid")
        resp = self._scan()
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(post.call_count, 1)

    @mock.patch("merchants.ai.gemini_scanner.requests.post")
    def test_rejects_unsupported_file_without_calling_gemini(self, post):
        resp = self._scan(b"GIF89a....", "menu.gif")
        self.assertEqual(resp.status_code, 400)
        post.assert_not_called()

    @override_settings(AI_GEMINI_API_KEY="")
    def test_missing_key_returns_503(self):
        self.assertEqual(self._scan().status_code, 503)

    def test_requires_login(self):
        self.client.force_authenticate(user=None)
        self.assertIn(self._scan().status_code, (401, 403))
