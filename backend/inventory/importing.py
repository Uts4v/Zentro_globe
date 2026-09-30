"""
inventory/importing.py

Safe inventory import: Upload → Read → Validate → Preview → Fix → Confirm →
Result. Uploading never changes stock.

Three intents (ImportMode):

  NEW_ITEMS     create item definitions. Opening quantity is allowed ONLY for
                newly created items and goes through
                InventoryMovementService.opening_balance().
  UPDATE_ITEMS  update names / categories / alerts / buying details of
                existing items. Never changes a quantity.
  STOCK_COUNT   imported physical quantities become a StockCount draft
                (System Says vs Imported Count). Stock changes only when that
                count is submitted and approved → COUNT_RECONCILIATION.

InventoryBalance is never written here. PDF rows (text or AI extracted) go
through the same validation, and any row that was not read with high
confidence must be confirmed by a person before it can be imported.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import (
    AnItemType,
    ImportMode,
    ImportStatus,
    InventoryAuditLog,
    InventoryBalance,
    InventoryCategory,
    InventoryImportSession,
    InventoryItem,
    InventoryLocation,
    MenuItemStockLink,
    Supplier,
    SupplierItem,
    UnitOfMeasure,
)
from .services import (
    InventoryMovementService,
    StockCountService,
    convert_quantity,
    seed_merchant_reference_data,
)

logger = logging.getLogger(__name__)

MAX_CSV_BYTES = 5 * 1024 * 1024
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 50
MAX_ROWS = 5000

# ─────────────────────────────────────────────────────────────────────────────
# Columns
# ─────────────────────────────────────────────────────────────────────────────

BASIC_COLUMNS = [
    "item_name", "item_type", "category", "unit", "location",
    "opening_quantity", "opening_unit_cost", "sku", "barcode",
    "keep_around", "warn_me_below",
]
ADVANCED_COLUMNS = [
    "very_low_level", "preferred_display_unit", "purchase_unit_label",
    "purchase_unit_quantity", "supplier", "supplier_sku",
    "menu_item_code", "quantity_per_sale",
]
COUNT_COLUMNS = ["item_name", "sku", "barcode", "location", "counted_quantity", "unit"]

HEADER_ALIASES = {
    "name": "item_name", "item": "item_name", "product": "item_name", "stock_item": "item_name",
    "item_name": "item_name", "description": "item_name",
    "type": "item_type", "kind": "item_type", "item_type": "item_type",
    "category": "category",
    "unit": "unit", "uom": "unit", "count_in": "unit", "base_unit": "unit", "units": "unit",
    "location": "location", "usually_kept_in": "location", "store": "location", "storage": "location",
    "opening_quantity": "opening_quantity", "opening_qty": "opening_quantity",
    "starting_quantity": "opening_quantity",
    "opening_unit_cost": "opening_unit_cost", "unit_cost": "opening_unit_cost", "cost": "opening_unit_cost",
    "sku": "sku", "code": "sku", "item_code": "sku",
    "barcode": "barcode", "ean": "barcode", "upc": "barcode",
    "keep_around": "keep_around", "par": "keep_around", "par_level": "keep_around",
    "warn_me_below": "warn_me_below", "reorder_point": "warn_me_below", "reorder_level": "warn_me_below",
    "very_low_level": "very_low_level", "critical_level": "very_low_level",
    "preferred_display_unit": "preferred_display_unit", "display_unit": "preferred_display_unit",
    "purchase_unit_label": "purchase_unit_label", "purchase_unit": "purchase_unit_label",
    "how_you_buy_it": "purchase_unit_label",
    "purchase_unit_quantity": "purchase_unit_quantity", "pack_size": "purchase_unit_quantity",
    "supplier": "supplier", "supplier_name": "supplier",
    "supplier_sku": "supplier_sku",
    "menu_item_code": "menu_item_code", "menu_item": "menu_item_code",
    "quantity_per_sale": "quantity_per_sale",
    "counted_quantity": "counted_quantity", "counted": "counted_quantity",
    "physical_quantity": "counted_quantity", "you_counted": "counted_quantity",
    "count": "counted_quantity",
    "zentro_id": "zentro_id", "id": "zentro_id",
    # Generic quantity columns — resolved per mode below.
    "quantity": "quantity", "qty": "quantity", "current_quantity": "quantity",
    "on_hand": "quantity", "stock": "quantity", "amount": "quantity",
}

UNIT_ALIASES = {
    "kg": "kg", "kgs": "kg", "kilo": "kg", "kilos": "kg", "kilogram": "kg", "kilograms": "kg",
    "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g", "gr": "g",
    "mg": "mg",
    "l": "L", "lt": "L", "ltr": "L", "ltrs": "L", "litre": "L", "litres": "L", "liter": "L", "liters": "L",
    "ml": "ml", "millilitre": "ml", "milliliter": "ml",
    "piece": "piece", "pieces": "piece", "pc": "piece", "pcs": "piece", "each": "piece",
    "ea": "piece", "unit": "piece", "units": "piece", "nos": "piece", "no": "piece",
}

ITEM_TYPE_ALIASES = {
    "ingredient": AnItemType.INGREDIENT, "food": AnItemType.INGREDIENT,
    "food / ingredient": AnItemType.INGREDIENT, "food/ingredient": AnItemType.INGREDIENT,
    "raw": AnItemType.INGREDIENT,
    "prepared": AnItemType.PREPARED, "prepared here": AnItemType.PREPARED, "prep": AnItemType.PREPARED,
    "direct_sale": AnItemType.DIRECT_SALE, "direct sale": AnItemType.DIRECT_SALE,
    "drink": AnItemType.DIRECT_SALE, "drink / sold as-is": AnItemType.DIRECT_SALE,
    "sold as-is": AnItemType.DIRECT_SALE, "retail": AnItemType.DIRECT_SALE,
    "supply": AnItemType.SUPPLY, "packaging": AnItemType.SUPPLY,
    "packaging / supply": AnItemType.SUPPLY, "supplies": AnItemType.SUPPLY,
}

FORMULA_PREFIX = ("=", "+", "-", "@", "\t", "\r")


class ImportFileError(ValueError):
    """The upload itself is unusable (wrong type, too big, unreadable)."""


def _norm_header(text: str) -> str:
    text = (text or "").strip().lstrip("﻿").lower()
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return HEADER_ALIASES.get(text, text)


def norm_name(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip()).casefold()


def _clean_cell(value) -> str:
    text = "" if value is None else str(value).strip()
    # Undo the apostrophe our own CSV export adds before formula-like text.
    if text.startswith("'") and text[1:2] in FORMULA_PREFIX:
        text = text[1:]
    return text


def parse_number(text):
    """Plain decimal. Accepts 1200.5, 1,200.50 (thousands), rejects 2,5."""
    if text is None:
        return None
    raw = str(text).strip().replace(" ", "")
    if raw == "":
        return None
    if "," in raw:
        if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", raw):
            raw = raw.replace(",", "")
        else:
            raise ValueError("Use a plain number like 2.5")
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise ValueError("must be a number")
    if not value.is_finite():
        raise ValueError("must be a number")
    return value


# ─────────────────────────────────────────────────────────────────────────────
# Reading files
# ─────────────────────────────────────────────────────────────────────────────


def read_upload(upload, max_bytes: int) -> bytes:
    if upload is None:
        raise ImportFileError("Choose a file to upload.")
    data = upload.read(max_bytes + 1)
    if not data:
        raise ImportFileError("The file is empty.")
    if len(data) > max_bytes:
        raise ImportFileError(f"The file is too large. The limit is {max_bytes // (1024 * 1024)} MB.")
    return data


def sniff_type(data: bytes, filename: str) -> str:
    """CSV or PDF by content (extension alone is not trusted)."""
    head = data[:1024].lstrip(b"\xef\xbb\xbf \t\r\n")
    if head.startswith(b"%PDF-"):
        return InventoryImportSession.FILE_PDF
    if b"\x00" in data[:4096]:
        raise ImportFileError("This file is not a CSV or PDF.")
    if head[:4] in (b"PK\x03\x04",) or head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ImportFileError("This looks like an Excel file. Save it as CSV (UTF-8) and upload again.")
    return InventoryImportSession.FILE_CSV


def _decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportFileError("Could not read the file. Save it as CSV (UTF-8).")


def read_csv_rows(data: bytes) -> tuple[list[str], list[dict]]:
    text = _decode(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        header = next(reader)
    except StopIteration:
        raise ImportFileError("The file has no header row.")
    columns = [_norm_header(h) for h in header]
    if not any(columns):
        raise ImportFileError("The file has no header row.")
    rows = []
    for number, values in enumerate(reader, start=2):
        if not any((v or "").strip() for v in values):
            continue
        if len(rows) >= MAX_ROWS:
            raise ImportFileError(f"The file has more than {MAX_ROWS} rows. Split it into smaller files.")
        raw = {}
        for key, value in zip(columns, values):
            if key and key not in raw:
                raw[key] = _clean_cell(value)
        rows.append({"row": number, "raw": raw, "source": {"confidence": "high"}})
    return columns, rows


# ── PDF ──────────────────────────────────────────────────────────────────────

_LINE_RE = re.compile(
    r"^\s*(?P<name>[^\d].*?)\s*[:\-–]?\s+(?P<qty>\d+(?:[.,]\d+)?)\s*(?P<unit>[A-Za-z]{1,12})?\.?\s*$"
)
_NUM_TOKEN = re.compile(r"\d+(?:[.,]\d+)?")
_SKIP_LINES = re.compile(
    r"^(page\s+\d+|total|grand total|date|inventory|stock (report|sheet|list)|item\b.*\bqty\b)", re.I
)


def _rows_from_tables(doc) -> list[dict]:
    rows = []
    for page_number, page in enumerate(doc, start=1):
        try:
            tables = page.find_tables()
        except Exception:  # pragma: no cover - older PyMuPDF
            return []
        for table in tables.tables:
            data = table.extract()
            if len(data) < 2:
                continue
            header = [_norm_header(str(h or "")) for h in data[0]]
            if "item_name" not in header or not ({"quantity", "counted_quantity", "opening_quantity"} & set(header)):
                continue
            for values in data[1:]:
                raw = {}
                for key, value in zip(header, values):
                    if key and key not in raw:
                        raw[key] = _clean_cell(value)
                if not raw.get("item_name"):
                    continue
                qty_text = raw.get("quantity") or raw.get("counted_quantity") or raw.get("opening_quantity") or ""
                try:
                    confident = parse_number(qty_text) is not None
                except ValueError:
                    confident = False
                rows.append({
                    "raw": raw,
                    "source": {
                        "confidence": "high" if confident else "low",
                        "original_text": " | ".join(str(v or "") for v in values)[:300],
                        "page": page_number,
                    },
                })
    return rows


def _rows_from_lines(text_pages) -> list[dict]:
    rows = []
    for page_number, text in text_pages:
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 3 or _SKIP_LINES.match(line):
                continue
            match = _LINE_RE.match(line)
            if match:
                unit = match.group("unit") or ""
                rows.append({
                    "raw": {"item_name": match.group("name").strip(" .:-"), "quantity": match.group("qty"),
                            "unit": unit},
                    # Read from loose text: always ask a person to confirm.
                    "source": {"confidence": "medium", "original_text": line[:300], "page": page_number},
                })
            elif re.search(r"[A-Za-z]{3,}", line) and _NUM_TOKEN.search(line) and len(line) < 80:
                rows.append({
                    "raw": {"item_name": line[:120], "quantity": ""},
                    "source": {"confidence": "low", "original_text": line[:300], "page": page_number,
                               "unreadable": True},
                })
    return rows


AI_PROMPT = """You are reading a restaurant inventory / stock sheet. Extract every stock line.
For each line return: name (the item name as written), quantity (the number only, or null when unclear),
unit (as written, e.g. kg, L, pcs, bottles; "" if none), location (storage area if the sheet shows one, else ""),
confidence ("high" only when the name AND quantity are clearly printed; "medium" if slightly unclear;
"low" if handwriting or print is hard to read), original_text (the exact characters you read for the quantity).
Never invent items or quantities. Do not include totals or headings."""

AI_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "quantity": {"type": "NUMBER", "nullable": True},
                    "unit": {"type": "STRING"},
                    "location": {"type": "STRING"},
                    "confidence": {"type": "STRING", "enum": ["high", "medium", "low"]},
                    "original_text": {"type": "STRING"},
                },
                "required": ["name", "quantity", "confidence"],
            },
        },
    },
    "required": ["items"],
}


def _rows_from_ai(data: bytes) -> list[dict]:
    """Scanned PDFs: reuse the existing Gemini document integration."""
    from merchants.ai.gemini_scanner import MenuScanError, extract_menu

    try:
        text, _truncated, _model = extract_menu(
            data, "application/pdf", prompt=AI_PROMPT, schema=AI_SCHEMA
        )
    except MenuScanError as exc:
        raise ImportFileError(
            "This PDF is a scan and automatic reading is not available right now "
            f"({exc}). Try a text PDF or a CSV."
        )
    try:
        items = json.loads(re.sub(r"^\s*```[a-zA-Z]*\s*|\s*```\s*$", "", text)).get("items") or []
    except (ValueError, AttributeError):
        raise ImportFileError("Could not read stock lines from this scanned PDF.")
    rows = []
    for entry in items[:MAX_ROWS]:
        if not isinstance(entry, dict) or not str(entry.get("name") or "").strip():
            continue
        qty = entry.get("quantity")
        confidence = entry.get("confidence") if entry.get("confidence") in ("high", "medium", "low") else "low"
        if qty is None:
            confidence = "low"
        rows.append({
            "raw": {
                "item_name": str(entry.get("name")).strip()[:255],
                "quantity": "" if qty is None else str(qty),
                "unit": str(entry.get("unit") or "")[:20],
                "location": str(entry.get("location") or "")[:120],
            },
            "source": {
                "confidence": confidence,
                "original_text": str(entry.get("original_text") or "")[:300],
                "ai": True,
            },
        })
    return rows


def read_pdf_rows(data: bytes) -> tuple[list[dict], str]:
    import pymupdf

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise ImportFileError("This PDF could not be opened.")
    try:
        if doc.needs_pass:
            raise ImportFileError("This PDF is password protected.")
        if doc.page_count == 0:
            raise ImportFileError("This PDF could not be opened.")
        if doc.page_count > MAX_PDF_PAGES:
            raise ImportFileError(f"The PDF has more than {MAX_PDF_PAGES} pages.")
        text_pages = [(i, page.get_text("text")) for i, page in enumerate(doc, start=1)]
        has_text = any(re.search(r"[^\W\d_]{2,}", t) for _, t in text_pages)
        if has_text:
            rows = _rows_from_tables(doc) or _rows_from_lines(text_pages)
            method = "pdf_text"
        else:
            rows, method = None, "pdf_ai"
    finally:
        doc.close()
    if rows is None:
        rows = _rows_from_ai(data)
    if not rows:
        raise ImportFileError("No stock lines were found in this PDF.")
    if len(rows) > MAX_ROWS:
        raise ImportFileError(f"The PDF has more than {MAX_ROWS} lines.")
    for number, row in enumerate(rows, start=1):
        row["row"] = number
    return rows, method


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────


class Lookups:
    """Merchant-scoped reference data, loaded once per validation pass."""

    def __init__(self, merchant):
        self.merchant = merchant
        items = list(
            InventoryItem.objects.filter(merchant=merchant, archived=False).select_related("base_unit")
        )
        self.items_by_id = {i.id: i for i in items}
        self.items_by_sku = {i.sku.casefold(): i for i in items if i.sku}
        self.items_by_barcode = {i.barcode: i for i in items if i.barcode}
        self.items_by_name = {}
        for item in items:
            self.items_by_name.setdefault(norm_name(item.name), []).append(item)
        self.categories = {
            norm_name(c.name): c for c in InventoryCategory.objects.filter(merchant=merchant)
        }
        self.locations = {
            norm_name(l.name): l for l in InventoryLocation.objects.filter(merchant=merchant)
        }
        self.units = {}
        for unit in UnitOfMeasure.objects.filter(Q(merchant__isnull=True) | Q(merchant=merchant), is_active=True):
            self.units.setdefault(unit.code.casefold(), unit)
            self.units.setdefault(unit.name.casefold(), unit)
        self.suppliers = {
            norm_name(s.name): s for s in Supplier.objects.filter(merchant=merchant, archived=False)
        }
        self._balances = None

    def unit(self, text):
        key = (text or "").strip().casefold().rstrip(".")
        if not key:
            return None
        code = UNIT_ALIASES.get(key)
        if code:
            return self.units.get(code.casefold())
        return self.units.get(key)

    def match_item(self, raw):
        """SKU → barcode → Zentro id → exact normalised name (only if unique)."""
        sku = (raw.get("sku") or "").casefold()
        if sku and sku in self.items_by_sku:
            return self.items_by_sku[sku], "sku"
        barcode = raw.get("barcode") or ""
        if barcode and barcode in self.items_by_barcode:
            return self.items_by_barcode[barcode], "barcode"
        zid = raw.get("zentro_id") or ""
        if zid.isdigit() and int(zid) in self.items_by_id:
            return self.items_by_id[int(zid)], "id"
        candidates = self.items_by_name.get(norm_name(raw.get("item_name") or ""), [])
        if len(candidates) == 1:
            return candidates[0], "name"
        if len(candidates) > 1:
            return None, "ambiguous"
        return None, None

    def balance(self, item, location):
        if self._balances is None:
            self._balances = {
                (b.inventory_item_id, b.location_id): b.on_hand
                for b in InventoryBalance.objects.filter(merchant=self.merchant)
            }
        return self._balances.get((item.id, location.id), Decimal("0"))


def _msg(level, text, field=""):
    return {"level": level, "text": text, "field": field}


def _decimal_field(raw, key, label, messages, *, allow_negative=False):
    try:
        value = parse_number(raw.get(key))
    except ValueError as exc:
        messages.append(_msg("error", f"{label} {exc}." if "number" in str(exc) else f"{label}: {exc}.", key))
        return None
    if value is not None and value < 0 and not allow_negative:
        messages.append(_msg("error", f"{label} cannot be negative.", key))
        return None
    return value


def _qty_key(raw, mode):
    """Which column carries the quantity for this mode."""
    if mode == ImportMode.STOCK_COUNT:
        for key in ("counted_quantity", "quantity", "opening_quantity"):
            if raw.get(key, "") != "":
                return key
        return "counted_quantity"
    if raw.get("opening_quantity", "") == "" and raw.get("quantity", "") != "":
        return "quantity"
    return "opening_quantity"


def validate_rows(merchant, rows, mode, *, fallback_location=None, decisions=None):
    """Validate every row. Returns (results, summary). Pure: writes nothing."""
    lookups = Lookups(merchant)
    decisions = decisions or {}
    results = []
    seen_names, seen_skus, seen_barcodes, seen_count_keys = {}, {}, {}, {}

    for row in rows:
        number = row["row"]
        raw = {k: v for k, v in row["raw"].items()}
        decision = decisions.get(str(number)) or decisions.get(number) or {}
        for key, value in (decision.get("fix") or {}).items():
            raw[_norm_header(key)] = _clean_cell(value)
        source = row.get("source") or {}
        messages = []
        name = (raw.get("item_name") or "").strip()[:255]
        result = {
            "row": number,
            "name": name,
            "messages": messages,
            "action": "skip",
            "match": None,
            "values": {},
            "confidence": source.get("confidence", "high"),
            "original_text": source.get("original_text", ""),
            "needs_review": source.get("confidence", "high") != "high",
            "confirmed": bool(decision.get("confirm")),
            "decision": decision.get("action") or "",
        }
        if source.get("unreadable") and not decision.get("fix"):
            messages.append(_msg("error", "Zentro could not read this line. Edit it or skip it."))

        item, matched_by = lookups.match_item(raw)
        if item is not None:
            result["match"] = {"id": item.id, "name": item.name, "by": matched_by}
        elif matched_by == "ambiguous":
            messages.append(_msg("error", "More than one stock item has this name. Add the SKU to choose.", "item_name"))

        if mode == ImportMode.STOCK_COUNT:
            _validate_count_row(raw, result, lookups, item, fallback_location, seen_count_keys)
        elif mode == ImportMode.UPDATE_ITEMS:
            _validate_update_row(raw, result, lookups, item, seen_skus, seen_barcodes)
        else:
            _validate_new_row(raw, result, lookups, item, matched_by, fallback_location,
                              seen_names, seen_skus, seen_barcodes)

        if decision.get("action") == "skip":
            result["action"] = "skip"
        if result["needs_review"] and result["action"] != "skip" and not result["confirmed"]:
            messages.append(_msg("warning", "Please confirm this line before importing."))
        has_error = any(m["level"] == "error" for m in messages)
        if has_error:
            result["status"] = "error"
        elif result["action"] == "skip":
            result["status"] = "skip"
        elif any(m["level"] == "warning" for m in messages):
            result["status"] = "warning"
        else:
            result["status"] = "ready"
        result["importable"] = (
            not has_error and result["action"] != "skip"
            and (not result["needs_review"] or result["confirmed"])
        )
        results.append(result)

    summary = {
        "rows": len(results),
        "ready": sum(1 for r in results if r["status"] == "ready"),
        "warnings": sum(1 for r in results if r["status"] == "warning"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "skipped": sum(1 for r in results if r["status"] == "skip"),
        "importable": sum(1 for r in results if r["importable"]),
        "needs_review": sum(1 for r in results if r["needs_review"] and not r["confirmed"]
                            and r["status"] != "skip"),
        "high_confidence": sum(1 for r in results if r["confidence"] == "high"),
        "unreadable": sum(1 for r in results if any("could not read" in m["text"] for m in r["messages"])),
    }
    return results, summary


def _resolve_location(raw, lookups, fallback, messages, *, required, allow_create):
    text = (raw.get("location") or "").strip()
    if text:
        loc = lookups.locations.get(norm_name(text))
        if loc:
            return loc, None
        if allow_create:
            messages.append(_msg("warning", f"Location “{text}” does not exist. It will be added.", "location"))
            return None, text[:120]
        messages.append(_msg("error", f"Location “{text}” does not exist.", "location"))
        return None, None
    if fallback is not None:
        return fallback, None
    if required:
        messages.append(_msg("error", "Say where it is stored (location).", "location"))
    return None, None


def _common_item_fields(raw, result, lookups, item_unit):
    """Alerts, codes, category, buying details shared by create and update."""
    messages, values = result["messages"], result["values"]
    for key, label, target in (
        ("keep_around", "Keep Around", "par_level"),
        ("warn_me_below", "Warn Me Below", "reorder_point"),
        ("very_low_level", "Very Low Level", "critical_level"),
    ):
        value = _decimal_field(raw, key, label, messages)
        if value is not None:
            values[target] = str(value)

    type_text = (raw.get("item_type") or "").strip()
    if type_text:
        item_type = ITEM_TYPE_ALIASES.get(type_text.casefold()) or (
            type_text.upper() if type_text.upper() in AnItemType.values else None
        )
        if item_type is None:
            messages.append(_msg("error", f"Item type “{type_text}” is not known. Use Food, Prepared, "
                                          "Drink or Packaging.", "item_type"))
        else:
            values["item_type"] = item_type

    category = (raw.get("category") or "").strip()
    if category:
        existing = lookups.categories.get(norm_name(category))
        if existing:
            values["category_id"] = existing.id
        else:
            values["new_category"] = category[:100]
            messages.append(_msg("warning", f"New category “{category}” will be added.", "category"))

    display = (raw.get("preferred_display_unit") or "").strip()
    if display:
        unit = lookups.unit(display)
        if unit is None:
            messages.append(_msg("error", f"Unit “{display}” is not configured.", "preferred_display_unit"))
        elif item_unit is not None and unit.kind != item_unit.kind:
            messages.append(_msg("error", f"“{display}” cannot display {item_unit.code} "
                                          "(different kind of unit).", "preferred_display_unit"))
        else:
            values["preferred_display_unit_id"] = unit.id

    label = (raw.get("purchase_unit_label") or "").strip()
    pack = _decimal_field(raw, "purchase_unit_quantity", "Pack size", messages)
    if label or pack is not None:
        if not label or pack is None or pack == 0:
            messages.append(_msg("error", "To set how you buy it, give both purchase_unit_label and "
                                          "purchase_unit_quantity (more than 0).", "purchase_unit_quantity"))
        else:
            values["purchase_unit_label"] = label[:80]
            values["purchase_unit_conversion"] = str(pack)

    supplier = (raw.get("supplier") or "").strip()
    if supplier:
        existing = lookups.suppliers.get(norm_name(supplier))
        if existing:
            values["supplier_id"] = existing.id
        else:
            values["new_supplier"] = supplier[:200]
            messages.append(_msg("warning", f"New supplier “{supplier}” will be added.", "supplier"))
        if raw.get("supplier_sku"):
            values["supplier_sku"] = raw["supplier_sku"][:120]

    menu_code = (raw.get("menu_item_code") or "").strip()
    if menu_code:
        from merchants.models import MenuItem

        menu_qs = MenuItem.objects.filter(merchant=lookups.merchant)
        menu_item = (
            menu_qs.filter(id=int(menu_code)).first() if menu_code.isdigit() else None
        ) or menu_qs.filter(name__iexact=menu_code).first()
        per_sale = _decimal_field(raw, "quantity_per_sale", "Quantity per sale", messages)
        if menu_item is None:
            messages.append(_msg("warning", f"Menu item “{menu_code}” was not found. The menu link "
                                            "will be skipped.", "menu_item_code"))
        elif per_sale is not None and per_sale == 0:
            messages.append(_msg("error", "Quantity per sale must be more than 0.", "quantity_per_sale"))
        else:
            values["menu_item_id"] = menu_item.id
            values["quantity_per_sale"] = str(per_sale or Decimal("1"))


def _check_codes(raw, result, lookups, item, seen_skus, seen_barcodes):
    messages, values = result["messages"], result["values"]
    sku = (raw.get("sku") or "").strip()[:120]
    barcode = (raw.get("barcode") or "").strip()[:120]
    if sku:
        other = lookups.items_by_sku.get(sku.casefold())
        if other is not None and (item is None or other.id != item.id):
            messages.append(_msg("error", f"SKU “{sku}” is already used by {other.name}.", "sku"))
        elif sku.casefold() in seen_skus:
            messages.append(_msg("error", f"SKU “{sku}” is repeated (also row {seen_skus[sku.casefold()]}).", "sku"))
        else:
            seen_skus[sku.casefold()] = result["row"]
            values["sku"] = sku
    if barcode:
        other = lookups.items_by_barcode.get(barcode)
        if other is not None and (item is None or other.id != item.id):
            messages.append(_msg("error", f"Barcode “{barcode}” is already used by {other.name}.", "barcode"))
        elif barcode in seen_barcodes:
            messages.append(_msg("error", f"Barcode “{barcode}” is repeated (also row {seen_barcodes[barcode]}).",
                                 "barcode"))
        else:
            seen_barcodes[barcode] = result["row"]
            values["barcode"] = barcode


def _validate_new_row(raw, result, lookups, item, matched_by, fallback_location,
                      seen_names, seen_skus, seen_barcodes):
    messages, values = result["messages"], result["values"]
    name = result["name"]
    decision = result["decision"]
    if not name:
        messages.append(_msg("error", "Item name is missing.", "item_name"))
        return

    if item is not None:
        # Already in Zentro: never silently duplicate.
        if decision == "update":
            result["action"] = "update"
            _validate_update_row(raw, result, lookups, item, seen_skus, seen_barcodes, from_new=True)
            return
        if decision == "create" and matched_by == "name":
            pass  # a genuinely different item that happens to share the name
        else:
            result["action"] = "skip"
            how = {"sku": "SKU", "barcode": "barcode", "id": "Zentro ID", "name": "name"}[matched_by]
            messages.append(_msg(
                "warning",
                f"Possible match: “{item.name}” already exists (same {how}). Choose Update Existing"
                + (" or Create New." if matched_by == "name" else "."),
                "item_name",
            ))
            result["choices"] = ["update", "create"] if matched_by == "name" else ["update"]
            return

    key = norm_name(name)
    if key in seen_names:
        messages.append(_msg("error", f"“{name}” is listed twice (also row {seen_names[key]}).", "item_name"))
    seen_names.setdefault(key, result["row"])

    result["action"] = "create"
    values["name"] = name
    values.setdefault("item_type", AnItemType.INGREDIENT)

    unit_text = (raw.get("unit") or "").strip()
    unit = lookups.unit(unit_text)
    if not unit_text:
        messages.append(_msg("error", "Unit is missing. Say how you count it (kg, L, piece…).", "unit"))
    elif unit is None:
        messages.append(_msg("error", f"Unit “{unit_text}” is not configured.", "unit"))
    else:
        values["base_unit_id"] = unit.id
        values["unit_code"] = unit.code

    _common_item_fields(raw, result, lookups, unit)
    _check_codes(raw, result, lookups, None, seen_skus, seen_barcodes)

    qty_key = _qty_key(raw, ImportMode.NEW_ITEMS)
    opening = _decimal_field(raw, qty_key, "Opening quantity", messages)
    location, new_location = _resolve_location(
        raw, lookups, fallback_location, messages, required=bool(opening), allow_create=True
    )
    if location:
        values["location_id"] = location.id
    if new_location:
        values["new_location"] = new_location
    if opening:
        values["opening_quantity"] = str(opening)
        cost = _decimal_field(raw, "opening_unit_cost", "Opening cost", messages)
        if cost is not None:
            values["opening_unit_cost"] = str(cost)


def _validate_update_row(raw, result, lookups, item, seen_skus, seen_barcodes, from_new=False):
    messages, values = result["messages"], result["values"]
    if item is None:
        if not any(m["field"] == "item_name" and m["level"] == "error" for m in messages):
            messages.append(_msg("error", "No existing stock item matches this row (by SKU, barcode or name).",
                                 "item_name"))
        return
    result["action"] = "update"
    name = result["name"]
    # Renaming is only safe when the row was matched by a stable identifier.
    if name and result["match"]["by"] in ("sku", "barcode", "id") and norm_name(name) != norm_name(item.name):
        values["name"] = name
    unit_text = (raw.get("unit") or "").strip()
    if unit_text:
        unit = lookups.unit(unit_text)
        if unit is None or unit.id != item.base_unit_id:
            messages.append(_msg("warning", f"Counting unit stays {item.base_unit.code}. Units cannot be "
                                            "changed by import.", "unit"))
    _common_item_fields(raw, result, lookups, item.base_unit)
    _check_codes(raw, result, lookups, item, seen_skus, seen_barcodes)
    location_text = (raw.get("location") or "").strip()
    if location_text:
        loc = lookups.locations.get(norm_name(location_text))
        if loc:
            values["location_id"] = loc.id
        else:
            values["new_location"] = location_text[:120]
            messages.append(_msg("warning", f"Location “{location_text}” does not exist. It will be added.",
                                 "location"))
    for key in ("opening_quantity", "counted_quantity", "quantity"):
        if raw.get(key, "") not in ("", None):
            messages.append(_msg(
                "warning",
                "Stock quantity is not changed for existing items. Use a Physical Stock Count import "
                "to update quantities.",
                key,
            ))
            break
    if not values:
        messages.append(_msg("warning", "Nothing to update for this item."))
        result["action"] = "skip"


def _validate_count_row(raw, result, lookups, item, fallback_location, seen_keys):
    messages, values = result["messages"], result["values"]
    if not result["name"] and item is None:
        messages.append(_msg("error", "Item name or SKU is missing.", "item_name"))
        return
    if item is None:
        if not any(m["field"] == "item_name" for m in messages):
            messages.append(_msg("error", "This item is not in Zentro yet. Import it as a New Stock Item first.",
                                 "item_name"))
        return
    result["action"] = "count"
    qty_key = _qty_key(raw, ImportMode.STOCK_COUNT)
    counted = _decimal_field(raw, qty_key, "Counted quantity", messages)
    if counted is None and not any(m["field"] == qty_key for m in messages):
        messages.append(_msg("error", "Counted quantity is missing.", qty_key))

    location = None
    text = (raw.get("location") or "").strip()
    if text:
        location = lookups.locations.get(norm_name(text))
        if location is None:
            messages.append(_msg("error", f"Location “{text}” does not exist.", "location"))
    else:
        location = fallback_location or item.default_location
        if location is None:
            messages.append(_msg("error", "Say where it was counted (location).", "location"))

    unit_text = (raw.get("unit") or "").strip()
    if counted is not None and unit_text:
        unit = lookups.unit(unit_text)
        if unit is None:
            messages.append(_msg("error", f"Unit “{unit_text}” is not configured.", "unit"))
            counted = None
        elif unit.kind != item.base_unit.kind:
            messages.append(_msg("error", f"{item.name} is counted in {item.base_unit.code}; "
                                          f"“{unit_text}” is a different kind of unit.", "unit"))
            counted = None
        elif unit.id != item.base_unit_id:
            counted = convert_quantity(counted, unit, item.base_unit)
            messages.append(_msg("warning", f"Converted to {counted.normalize():f} {item.base_unit.code}.", "unit"))

    if location is not None:
        key = (item.id, location.id)
        if key in seen_keys:
            messages.append(_msg("error", f"{item.name} at {location.name} is listed twice "
                                          f"(also row {seen_keys[key]}).", "item_name"))
        seen_keys.setdefault(key, result["row"])
        values["location_id"] = location.id
        values["location_name"] = location.name
        book = lookups.balance(item, location)
        values["system_says"] = str(book)
        if counted is not None:
            values["counted"] = str(counted)
            values["difference"] = str(counted - book)
    values["unit_code"] = item.base_unit.code


# ─────────────────────────────────────────────────────────────────────────────
# Sessions
# ─────────────────────────────────────────────────────────────────────────────


def file_hash(data: bytes, mode: str) -> str:
    return hashlib.sha256(mode.encode() + b"\x00" + data).hexdigest()


def start_session(*, merchant, user, upload, mode, fallback_location=None) -> InventoryImportSession:
    """Read + validate an upload into a session awaiting review. No stock change."""
    if mode not in ImportMode.values:
        raise ImportFileError("Choose what you are importing.")
    seed_merchant_reference_data(merchant)
    filename = (getattr(upload, "name", "") or "import")[:255]
    data = read_upload(upload, max(MAX_CSV_BYTES, MAX_PDF_BYTES))
    file_type = sniff_type(data, filename)
    if file_type == InventoryImportSession.FILE_CSV:
        if len(data) > MAX_CSV_BYTES:
            raise ImportFileError("The CSV is too large. The limit is 5 MB.")
        if not filename.lower().endswith((".csv", ".txt")):
            raise ImportFileError("Upload a .csv file (or a .pdf).")
        _, rows = read_csv_rows(data)
        method = "csv"
    else:
        if not filename.lower().endswith(".pdf"):
            raise ImportFileError("Upload a .pdf file.")
        if mode == ImportMode.UPDATE_ITEMS:
            raise ImportFileError("PDF files can add new items or a stock count. Use CSV to update item details.")
        rows, method = read_pdf_rows(data)
    if not rows:
        raise ImportFileError("The file has no data rows.")

    digest = file_hash(data, mode)
    previous = InventoryImportSession.objects.filter(
        merchant=merchant, file_hash=digest, status=ImportStatus.COMPLETED
    ).order_by("-completed_at").first()

    results, summary = validate_rows(merchant, rows, mode, fallback_location=fallback_location)
    for row, result in zip(rows, results):
        row["result"] = result
    session = InventoryImportSession.objects.create(
        merchant=merchant,
        uploaded_by=user,
        file_name=filename,
        file_type=file_type,
        file_hash=digest,
        import_mode=mode,
        status=ImportStatus.READY,
        extraction_method=method,
        location=fallback_location,
        rows=rows,
        summary=summary,
        rows_total=len(rows),
        duplicate_of=previous,
    )
    return session


def review_session(session, decisions) -> InventoryImportSession:
    """Apply a person's fixes/choices and validate again. No stock change."""
    if session.status != ImportStatus.READY:
        raise ValueError("This import is no longer waiting for review.")
    rows = session.rows
    stored = {str(r["row"]): r.get("decision") or {} for r in rows}
    for key, value in (decisions or {}).items():
        if isinstance(value, dict):
            merged = {**stored.get(str(key), {}), **value}
            if "fix" in value:
                merged["fix"] = {**(stored.get(str(key), {}).get("fix") or {}), **(value.get("fix") or {})}
            stored[str(key)] = merged
    results, summary = validate_rows(
        session.merchant, rows, session.import_mode,
        fallback_location=session.location, decisions=stored,
    )
    for row, result in zip(rows, results):
        row["decision"] = stored.get(str(row["row"])) or {}
        row["result"] = result
    session.rows = rows
    session.summary = summary
    session.save(update_fields=["rows", "summary"])
    return session


def _ensure(model, merchant, name, cache, **defaults):
    key = norm_name(name)
    if key not in cache:
        obj, _ = model.objects.get_or_create(merchant=merchant, name=name, defaults=defaults)
        cache[key] = obj
    return cache[key]


def commit_session(session, *, user, allow_duplicate=False) -> InventoryImportSession:
    """Import every importable row. Stock changes only via the movement service.

    Rows are validated once more (never trusting the stored preview), each
    item row runs in its own transaction with an idempotency key derived
    from the session and row, and a completed session can never run twice.
    """
    with transaction.atomic():
        locked = InventoryImportSession.objects.select_for_update().get(pk=session.pk)
        if locked.status == ImportStatus.COMPLETED:
            return locked
        if locked.status != ImportStatus.READY:
            raise ValueError("This import cannot be started.")
        if locked.duplicate_of_id and not allow_duplicate:
            raise DuplicateImportError(locked.duplicate_of_id)
        locked.status = ImportStatus.IMPORTING
        locked.started_at = timezone.now()
        locked.save(update_fields=["status", "started_at"])

    merchant = locked.merchant
    decisions = {str(r["row"]): r.get("decision") or {} for r in locked.rows}
    results, _ = validate_rows(
        merchant, locked.rows, locked.import_mode,
        fallback_location=locked.location, decisions=decisions,
    )
    outcomes = []
    counters = {"imported": 0, "skipped": 0, "failed": 0, "opening": 0, "created": 0, "updated": 0}
    caches = {"cat": {}, "loc": {}, "sup": {}}

    try:
        if locked.import_mode == ImportMode.STOCK_COUNT:
            _commit_count(locked, results, user, outcomes, counters)
        else:
            for result in results:
                if not result["importable"]:
                    counters["failed" if result["status"] == "error" else "skipped"] += 1
                    outcomes.append(_outcome(result, "failed" if result["status"] == "error" else "skipped",
                                             "; ".join(m["text"] for m in result["messages"]) or "Skipped"))
                    continue
                try:
                    with transaction.atomic():
                        message = _commit_item_row(locked, result, user, caches, counters)
                    counters["imported"] += 1
                    outcomes.append(_outcome(result, "imported", message))
                except Exception as exc:  # one bad row must not stop the rest
                    logger.info("inventory.import.row_failed session=%s row=%s err=%s",
                                locked.id, result["row"], exc)
                    counters["failed"] += 1
                    outcomes.append(_outcome(result, "failed", str(exc) or "Could not import this row."))
    except Exception as exc:
        locked.status = ImportStatus.FAILED
        locked.error = str(exc)[:500]
        locked.completed_at = timezone.now()
        locked.rows = outcomes
        locked.save(update_fields=["status", "error", "completed_at", "rows"])
        raise

    locked.status = ImportStatus.COMPLETED
    locked.completed_at = timezone.now()
    locked.rows_imported = counters["imported"]
    locked.rows_skipped = counters["skipped"]
    locked.rows_failed = counters["failed"]
    locked.summary = {**locked.summary, "result": counters}
    # Keep only the compact outcome list (enough for the result CSV).
    locked.rows = outcomes
    locked.save()
    InventoryAuditLog.objects.create(
        merchant=merchant, user=user, action=InventoryAuditLog.ACTION_IMPORT,
        entity_type="import", entity_id=str(locked.id),
        metadata={"file_name": locked.file_name, "file_type": locked.file_type,
                  "mode": locked.import_mode, **counters,
                  "stock_count": locked.stock_count_id},
    )
    return locked


class DuplicateImportError(ValueError):
    def __init__(self, previous_id):
        self.previous_id = previous_id
        super().__init__("This file appears to have already been imported.")


def _outcome(result, outcome, message):
    return {"row": result["row"], "name": result["name"], "outcome": outcome, "message": message[:500]}


def _commit_item_row(session, result, user, caches, counters):
    merchant = session.merchant
    values = result["values"]
    if values.get("new_category"):
        values["category_id"] = _ensure(InventoryCategory, merchant, values["new_category"], caches["cat"]).id
    if values.get("new_location"):
        values["location_id"] = _ensure(InventoryLocation, merchant, values["new_location"], caches["loc"]).id
    if values.get("new_supplier"):
        values["supplier_id"] = _ensure(Supplier, merchant, values["new_supplier"], caches["sup"]).id

    fields = {}
    for src, dst in (
        ("item_type", "item_type"), ("par_level", "par_level"), ("reorder_point", "reorder_point"),
        ("critical_level", "critical_level"), ("purchase_unit_label", "purchase_unit_label"),
        ("purchase_unit_conversion", "purchase_unit_conversion"), ("sku", "sku"), ("barcode", "barcode"),
        ("category_id", "category_id"), ("location_id", "default_location_id"),
        ("supplier_id", "primary_supplier_id"), ("preferred_display_unit_id", "preferred_display_unit_id"),
        ("name", "name"),
    ):
        if src in values:
            fields[dst] = Decimal(values[src]) if dst in (
                "par_level", "reorder_point", "critical_level", "purchase_unit_conversion"
            ) else values[src]

    if result["action"] == "update":
        item = InventoryItem.objects.select_for_update().get(merchant=merchant, id=result["match"]["id"])
        for key, value in fields.items():
            setattr(item, key, value)
        item.save()
        counters["updated"] += 1
        message = "Details updated. Stock quantity unchanged."
    else:
        if "category_id" not in fields:
            other = InventoryCategory.objects.filter(merchant=merchant, name="Other").first() or \
                InventoryCategory.objects.filter(merchant=merchant).order_by("display_order").first()
            fields["category_id"] = other.id
        item = InventoryItem.objects.create(
            merchant=merchant, base_unit_id=values["base_unit_id"], **fields
        )
        counters["created"] += 1
        message = "Created."
        if values.get("opening_quantity"):
            location = InventoryLocation.objects.get(merchant=merchant, id=values["location_id"])
            InventoryMovementService.opening_balance(
                merchant=merchant,
                item=item,
                location=location,
                opening_qty=Decimal(values["opening_quantity"]),
                unit_cost=Decimal(values["opening_unit_cost"]) if values.get("opening_unit_cost") else None,
                performed_by=user,
                idempotency_key=f"import-{session.id}-row-{result['row']}",
            )
            counters["opening"] += 1
            message = f"Created with starting stock {Decimal(values['opening_quantity']).normalize():f} " \
                      f"{values.get('unit_code', '')}."

    if values.get("supplier_id") and values.get("supplier_sku"):
        SupplierItem.objects.update_or_create(
            supplier_id=values["supplier_id"], inventory_item=item,
            defaults={"supplier_sku": values["supplier_sku"]},
        )
    if values.get("menu_item_id"):
        MenuItemStockLink.objects.update_or_create(
            menu_item_id=values["menu_item_id"], inventory_item=item,
            defaults={"merchant": merchant, "quantity_per_unit": Decimal(values["quantity_per_sale"])},
        )
    return message


def _commit_count(session, results, user, outcomes, counters):
    merchant = session.merchant
    lines, used = [], []
    items = {i.id: i for i in InventoryItem.objects.filter(
        merchant=merchant, id__in=[r["match"]["id"] for r in results if r.get("match")]
    )}
    locations = {l.id: l for l in InventoryLocation.objects.filter(merchant=merchant)}
    for result in results:
        if not result["importable"] or "counted" not in result["values"]:
            status = "failed" if result["status"] == "error" else "skipped"
            counters[status] += 1
            outcomes.append(_outcome(result, status, "; ".join(m["text"] for m in result["messages"]) or "Skipped"))
            continue
        item = items[result["match"]["id"]]
        location = locations[result["values"]["location_id"]]
        lines.append((item, location, Decimal(result["values"]["counted"])))
        used.append(result)
    if not lines:
        return
    with transaction.atomic():
        count = StockCountService.create_count_from_lines(
            merchant=merchant,
            name=f"Imported count · {session.file_name}"[:160],
            lines=lines,
            started_by=user,
            note=f"Imported from {session.file_name}. Review, then approve to update stock.",
        )
        session.stock_count = count
        session.save(update_fields=["stock_count"])
    for result in used:
        counters["imported"] += 1
        outcomes.append(_outcome(result, "imported", "Added to the count draft (stock not changed yet)."))


# ─────────────────────────────────────────────────────────────────────────────
# Templates
# ─────────────────────────────────────────────────────────────────────────────

EXAMPLE_ROWS = [
    {"item_name": "Chicken Breast", "item_type": "Food", "category": "Meat & Poultry", "unit": "kg",
     "location": "Main Kitchen", "opening_quantity": "20", "opening_unit_cost": "480", "sku": "CHK-001",
     "keep_around": "25", "warn_me_below": "10", "very_low_level": "5"},
    {"item_name": "Basmati Rice", "item_type": "Food", "category": "Dry Goods", "unit": "kg",
     "location": "Dry Storage", "opening_quantity": "50", "opening_unit_cost": "140", "sku": "RICE-25",
     "keep_around": "60", "warn_me_below": "20", "purchase_unit_label": "Sack",
     "purchase_unit_quantity": "25", "supplier": "ABC Foods"},
    {"item_name": "Paper Cups 12oz", "item_type": "Packaging", "category": "Packaging", "unit": "piece",
     "location": "Front Counter", "opening_quantity": "500", "sku": "CUP-12", "barcode": "8901234567890",
     "keep_around": "1000", "warn_me_below": "300", "purchase_unit_label": "Box",
     "purchase_unit_quantity": "50"},
]
COUNT_EXAMPLE_ROWS = [
    {"item_name": "Chicken Breast", "sku": "CHK-001", "location": "Main Kitchen", "counted_quantity": "15",
     "unit": "kg"},
    {"item_name": "Milk", "location": "Bar", "counted_quantity": "12", "unit": "L"},
]


def template_csv(kind: str, example: bool) -> tuple[str, str]:
    """(filename, csv text). Templates are header-only so nothing imports by accident."""
    if kind == "count":
        columns, rows = COUNT_COLUMNS, COUNT_EXAMPLE_ROWS
        name = "zentro_stock_count_example.csv" if example else "zentro_stock_count_template.csv"
    else:
        columns, rows = BASIC_COLUMNS + ADVANCED_COLUMNS, EXAMPLE_ROWS
        name = "zentro_inventory_example.csv" if example else "zentro_inventory_template.csv"
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(columns)
    if example:
        for row in rows:
            writer.writerow([row.get(c, "") for c in columns])
    return name, "﻿" + buffer.getvalue()
