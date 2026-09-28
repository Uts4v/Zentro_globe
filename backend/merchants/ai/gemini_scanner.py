"""
merchants/ai/gemini_scanner.py

AI Menu Scanner: a merchant's menu photo or PDF goes to Gemini, which returns
structured JSON for every item: category, name, emoji, price, description,
dietary tags, allergens, calories, featured flag, variants (sizes) and add-ons.
This module owns the upload sniffing, the Gemini call and the parsing;
persisting the items is the view's job.

The uploaded file is never stored, only forwarded to Gemini, so the check here
is magic-byte sniffing (the client's filename and Content-Type carry no
authority) rather than the re-encoding done for images we serve back.
"""

import base64
import json
import logging
import math
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import requests
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

MAX_SCAN_UPLOAD_BYTES = 10 * 1024 * 1024
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.8-flash"
# Gemini answers 500/503 when a model is briefly overloaded and 429 when a
# quota is used up; in both cases the next model is tried instead.
OVERLOADED_STATUSES = {500, 503}
# An overloaded model can hang instead of refusing; a long menu legitimately
# takes a while, so the per-model cap stays generous.
MODEL_TIMEOUT_SECONDS = 120
# Total time a merchant may wait across all models.
SCAN_DEADLINE_SECONDS = 300
MIN_ATTEMPT_SECONDS = 30
# An overloaded model can take a minute just to refuse, so give it a while.
OVERLOAD_COOLDOWN_SECONDS = 300
TIMEOUT_COOLDOWN_SECONDS = 300
_PACIFIC = ZoneInfo("America/Los_Angeles")

EXTRACTION_PROMPT = """You are an expert restaurant menu extractor. Read the provided menu image or document and extract EVERY food and beverage item on it. Do not skip, merge or summarise items, and do not invent anything that is not on the menu.

For each item return:
- category: the section heading it appears under (e.g. Hot Coffee, Burgers, Starters, Desserts).
- name: the item name as written, without the price and without markers such as (V), (VG), (GF), * or chilli symbols; put what those markers mean in dietary_tags instead.
- emoji: one emoji that best represents the item (🍔 burger, ☕ coffee, 🍕 pizza, 🥟 momo, 🍰 cake).
- price: the numeric price only (e.g. 250 or 15.50), no currency symbols. If the item has several sizes or portions, use the lowest one.
- description: ingredients or description text printed for the item, else "".
- dietary_tags: lowercase tags printed or shown by icons/legend: vegetarian, non-vegetarian, vegan, spicy, gluten-free, jain, halal, contains-egg, bestseller, new. Indian-style green dot/square = vegetarian, red/brown dot = non-vegetarian. Chilli icons = spicy.
- allergens: lowercase allergens the menu states for the item, via text, icons or an allergen legend (e.g. dairy, nuts, peanuts, gluten, egg, soy, shellfish, fish, sesame, mustard, celery). Only list what the menu indicates; never guess from the dish name.
- calories: kcal per serving as an integer if printed on the menu, else null. Never estimate.
- is_featured: true if marked as chef's special, signature, recommended, bestseller, popular or starred.
- variant_group: what the variants choose between, e.g. "Size", "Portion", "Serving", "Temperature". Use "Size" if unclear.
- variants: when the item is sold in different sizes/portions/versions at different prices (Small/Medium/Large, Half/Full, Regular/Large, Hot/Iced, 6pc/12pc, or price columns headed by sizes), list each one with its own full price. Otherwise [].
- add_ons: optional extras with their additional price (e.g. "Extra cheese +50", "Add chicken 80"). If an add-on list applies to a whole section, include it on every item in that section. Otherwise [].

Include items whose price is missing with price null. Menus may span several pages or columns; read all of them."""

_OPTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {"name": {"type": "STRING"}, "price": {"type": "NUMBER"}},
    "required": ["name", "price"],
    "propertyOrdering": ["name", "price"],
}

RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "category": {"type": "STRING"},
                    "name": {"type": "STRING"},
                    "emoji": {"type": "STRING"},
                    "price": {"type": "NUMBER", "nullable": True},
                    "description": {"type": "STRING"},
                    "dietary_tags": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "allergens": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "calories": {"type": "INTEGER", "nullable": True},
                    "is_featured": {"type": "BOOLEAN"},
                    "variant_group": {"type": "STRING"},
                    "variants": {"type": "ARRAY", "items": _OPTION_SCHEMA},
                    "add_ons": {"type": "ARRAY", "items": _OPTION_SCHEMA},
                },
                "required": ["category", "name", "price"],
                "propertyOrdering": [
                    "category", "name", "emoji", "price", "description", "dietary_tags",
                    "allergens", "calories", "is_featured", "variant_group", "variants", "add_ons",
                ],
            },
        },
    },
    "required": ["items"],
}

# Field limits mirror the model columns.
MAX_CATEGORY_LEN = 100
MAX_NAME_LEN = 255
MAX_OPTION_NAME_LEN = 100
MAX_EMOJI_LEN = 10
MAX_PRICE = Decimal("99999999.99")  # DecimalField(10, 2)
MAX_CALORIES = 10000
MAX_TAGS = 20
DEFAULT_CATEGORY = "Menu"
DEFAULT_EMOJI = "🍽️"
DEFAULT_VARIANT_GROUP = "Size"


class MenuScanError(Exception):
    """A scan failed in a way the merchant should be told about."""

    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class ScannedOption:
    name: str
    price: Decimal


@dataclass
class ScannedItem:
    category: str
    name: str
    price: Decimal
    emoji: str = DEFAULT_EMOJI
    description: str = ""
    dietary_tags: list[str] = field(default_factory=list)
    allergens: list[str] = field(default_factory=list)
    calories: int | None = None
    is_featured: bool = False
    variant_group: str = DEFAULT_VARIANT_GROUP
    variants: list[ScannedOption] = field(default_factory=list)
    add_ons: list[ScannedOption] = field(default_factory=list)


# ── Upload sniffing ───────────────────────────────────────────────────────────

def sniff_menu_upload(uploaded_file) -> tuple[bytes, str]:
    """Return ``(bytes, mime_type)`` for a JPEG/PNG/WEBP/PDF upload, else raise."""
    if uploaded_file is None:
        raise MenuScanError("No file provided. Use multipart field 'file'.")

    data = uploaded_file.read(MAX_SCAN_UPLOAD_BYTES + 1)
    if not data:
        raise MenuScanError("The uploaded file is empty.")
    if len(data) > MAX_SCAN_UPLOAD_BYTES:
        raise MenuScanError("File is too large. The limit is 10 MB.")

    if data.startswith(b"\xff\xd8\xff"):
        return data, "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return data, "image/webp"
    if data[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"%PDF-"):
        return data, "application/pdf"
    raise MenuScanError("Unsupported file. Upload a JPG, PNG, WEBP photo or a PDF.")


# ── Gemini call ───────────────────────────────────────────────────────────────

def _cooldown_key(model: str) -> str:
    return f"menu_scan:cooldown:{model}"


def _seconds_until_quota_reset() -> int:
    """Gemini's per-day quotas reset at midnight Pacific time."""
    now = datetime.now(_PACIFIC)
    reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=30, microsecond=0)
    return max(60, int((reset - now).total_seconds()))


def _classify_quota_error(resp) -> tuple[str, int]:
    """
    Return ``("daily", seconds_until_reset)`` when the model's daily quota is
    used up, else ``("minute", retry_after_seconds)`` for a short-term limit.
    """
    try:
        details = (resp.json().get("error") or {}).get("details") or []
    except ValueError:
        details = []
    daily, retry_after = False, 60
    for detail in details:
        for violation in detail.get("violations") or []:
            if "PerDay" in (violation.get("quotaId") or ""):
                daily = True
        delay = detail.get("retryDelay")
        if isinstance(delay, str) and delay.endswith("s"):
            try:
                retry_after = max(1, min(300, math.ceil(float(delay[:-1]))))
            except ValueError:
                pass
    return ("daily", _seconds_until_quota_reset()) if daily else ("minute", retry_after)


def _no_model_available(reasons: list[str]) -> MenuScanError:
    if "busy" in reasons or "minute" in reasons:
        return MenuScanError("Gemini is busy right now. Please try again in a minute.", status_code=503)
    if "daily" in reasons:
        return MenuScanError(
            "Today's AI scan limit has been reached. Please try again tomorrow.", status_code=503,
        )
    return MenuScanError("Gemini could not process this file.", status_code=502)


def extract_menu(data: bytes, mime_type: str) -> tuple[str, bool, str]:
    """
    Send the menu to Gemini. Returns ``(json_text, truncated, model_used)``.

    Models in ``AI_MENU_SCANNER_MODELS`` are tried in order; one that is out of
    quota, overloaded, hanging or unavailable hands over to the next. A failed
    model is skipped by later scans for a while (until midnight Pacific for a
    used-up daily quota), so they do not spend a request, and the merchant's
    time, on a likely refusal.
    """
    started = time.monotonic()
    api_key = getattr(settings, "AI_GEMINI_API_KEY", "")
    if not api_key:
        raise MenuScanError("AI Menu Scanner is not configured on this server.", status_code=503)

    models = list(getattr(settings, "AI_MENU_SCANNER_MODELS", None) or [DEFAULT_MODEL])
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(data).decode()}},
                {"text": EXTRACTION_PROMPT},
            ],
        }],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": getattr(settings, "AI_MENU_SCANNER_MAX_OUTPUT_TOKENS", 65536),
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }

    reasons: list[str] = []
    for model in models:
        cooling = cache.get(_cooldown_key(model))
        if cooling:
            logger.info("menu_scan.skip_model model=%s reason=%s", model, cooling)
            reasons.append(cooling)
            continue

        remaining = SCAN_DEADLINE_SECONDS - (time.monotonic() - started)
        if remaining < MIN_ATTEMPT_SECONDS:
            logger.warning("menu_scan.deadline_reached tried=%s", len(reasons))
            reasons.append("busy")
            break

        try:
            # The key goes in a header rather than ?key= so it never lands in
            # proxy or request logs that record URLs.
            resp = requests.post(
                GEMINI_ENDPOINT.format(model=model),
                json=payload,
                headers={"x-goog-api-key": api_key},
                timeout=(10, min(MODEL_TIMEOUT_SECONDS, remaining)),
            )
        except requests.Timeout:
            logger.warning("menu_scan.model_failed model=%s reason=timeout", model)
            cache.set(_cooldown_key(model), "busy", TIMEOUT_COOLDOWN_SECONDS)
            reasons.append("busy")
            continue
        except requests.RequestException as exc:
            logger.warning("menu_scan.gemini_unreachable: %s", exc)
            raise MenuScanError("Could not reach Gemini. Please try again.", status_code=502)

        if resp.status_code == 200:
            return (*_read_response(resp, model), model)

        if resp.status_code in (401, 403):
            logger.error("menu_scan.key_rejected model=%s body=%s", model, resp.text[:300])
            raise MenuScanError("AI Menu Scanner is misconfigured on this server.", status_code=503)
        if resp.status_code == 429:
            reason, ttl = _classify_quota_error(resp)
            cache.set(_cooldown_key(model), reason, ttl)
        elif resp.status_code in OVERLOADED_STATUSES:
            reason = "busy"
            cache.set(_cooldown_key(model), reason, OVERLOAD_COOLDOWN_SECONDS)
        elif resp.status_code == 404:
            reason = "unavailable"
            cache.set(_cooldown_key(model), reason, 3600)
        else:
            reason = "error"
        logger.warning(
            "menu_scan.model_failed model=%s status=%s reason=%s body=%s",
            model, resp.status_code, reason, " ".join(resp.text[:300].split()),
        )
        reasons.append(reason)

    raise _no_model_available(reasons)


def _read_response(resp, model: str) -> tuple[str, bool]:
    body = resp.json()
    block_reason = (body.get("promptFeedback") or {}).get("blockReason")
    candidates = body.get("candidates") or []
    if block_reason or not candidates:
        raise MenuScanError("Gemini could not read a menu from this file.", status_code=422)

    candidate = candidates[0]
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    truncated = candidate.get("finishReason") == "MAX_TOKENS"
    if truncated:
        logger.info("menu_scan.truncated model=%s", model)
    return text, truncated


# ── Parsing ───────────────────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$")
_PRICE_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _decode_items(text: str) -> list:
    """
    Return the raw item dicts. When the output was cut off mid-way the JSON is
    invalid, so fall back to decoding item objects one by one and keep every
    complete one.
    """
    text = _FENCE_RE.sub("", (text or "").strip())
    try:
        data = json.loads(text)
        items = data.get("items") if isinstance(data, dict) else data
        return items if isinstance(items, list) else []
    except json.JSONDecodeError:
        pass

    start = text.find("[")
    if start < 0:
        return []
    decoder = json.JSONDecoder()
    items, pos = [], start + 1
    while True:
        while pos < len(text) and text[pos] in " \t\r\n,":
            pos += 1
        try:
            obj, pos = decoder.raw_decode(text, pos)
        except json.JSONDecodeError:
            return items
        items.append(obj)


def _clean_price(raw) -> Decimal | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        raw = str(raw)
    match = _PRICE_RE.search(str(raw))
    if not match:
        return None
    try:
        price = Decimal(match.group(0).replace(",", "")).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    if price < 0 or price > MAX_PRICE:
        return None
    return price


def _clean_text(raw, limit: int | None = None) -> str:
    value = raw.strip() if isinstance(raw, str) else ""
    return value[:limit] if limit else value


def _clean_tags(raw) -> list[str]:
    if isinstance(raw, str):
        raw = re.split(r"[;,]", raw)
    if not isinstance(raw, list):
        return []
    tags = [t.strip().lower() for t in raw if isinstance(t, str) and t.strip()]
    return list(dict.fromkeys(tags))[:MAX_TAGS]


def _clean_emoji(raw) -> str:
    value = _clean_text(raw)
    # Anything containing letters or digits is a word, not an emoji.
    if not value or len(value) > MAX_EMOJI_LEN or any(c.isascii() and c.isalnum() for c in value):
        return DEFAULT_EMOJI
    return value


def _clean_calories(raw) -> int | None:
    if isinstance(raw, bool):
        return None
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        return None
    return value if 0 < value <= MAX_CALORIES else None


def _clean_options(raw) -> list[ScannedOption]:
    if not isinstance(raw, list):
        return []
    options, seen = [], set()
    for opt in raw:
        if not isinstance(opt, dict):
            continue
        name = _clean_text(opt.get("name"), MAX_OPTION_NAME_LEN)
        price = _clean_price(opt.get("price"))
        if not name or price is None or name.lower() in seen:
            continue
        seen.add(name.lower())
        options.append(ScannedOption(name=name, price=price))
    return options


def parse_menu(json_text: str) -> tuple[list[ScannedItem], int]:
    """
    Turn Gemini's JSON into items. Returns ``(items, skipped_count)``.

    Items without a name, or without any usable price (neither a price nor a
    priced variant), are skipped rather than saved with a made-up price.
    """
    items: list[ScannedItem] = []
    skipped = 0
    for raw in _decode_items(json_text):
        if not isinstance(raw, dict):
            continue
        name = _clean_text(raw.get("name"), MAX_NAME_LEN)
        variants = _clean_options(raw.get("variants"))
        price = _clean_price(raw.get("price"))

        if len(variants) >= 2:
            price = min(v.price for v in variants)
        elif variants:
            # A single "variant" is just the price.
            price = price if price is not None else variants[0].price
            variants = []

        if not name or price is None:
            skipped += 1
            continue

        items.append(ScannedItem(
            category=_clean_text(raw.get("category"), MAX_CATEGORY_LEN) or DEFAULT_CATEGORY,
            name=name,
            price=price,
            emoji=_clean_emoji(raw.get("emoji")),
            description=_clean_text(raw.get("description")),
            dietary_tags=_clean_tags(raw.get("dietary_tags")),
            allergens=_clean_tags(raw.get("allergens")),
            calories=_clean_calories(raw.get("calories")),
            is_featured=raw.get("is_featured") is True,
            variant_group=_clean_text(raw.get("variant_group"), MAX_OPTION_NAME_LEN) or DEFAULT_VARIANT_GROUP,
            variants=variants,
            add_ons=_clean_options(raw.get("add_ons")),
        ))
    return items, skipped
