"""
inventory/reports.py

One source of truth for every inventory report. The JSON report endpoint,
CSV downloads and PDF downloads all read rows from here, straight from the
authoritative tables (never from whatever the browser happened to show).

Every query is merchant-scoped. Cost columns are dropped entirely when the
viewer may not see costs, so an export can never become a cost leak.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Callable, Iterable, Iterator
from zoneinfo import ZoneInfo

from django.db.models import Count, Prefetch, Q
from django.utils import timezone

from .models import (
    CountStatus,
    InventoryBalance,
    InventoryItem,
    InventoryMovement,
    InventoryReceiving,
    InventoryWasteRecord,
    MovementType,
    PurchaseOrder,
    StockCount,
    StockCountLine,
    WasteReason,
)
from .services import suggested_order_qty, with_stock_totals, items_stored_at

STATUS_LABEL = {
    "HEALTHY": "Good",
    "LOW": "Low",
    "CRITICAL": "Very Low",
    "OUT": "Out",
    "OVERSTOCK": "More Than Usual",
}

ITEM_TYPE_LABEL = {
    "INGREDIENT": "Food / Ingredient",
    "PREPARED": "Prepared Here",
    "DIRECT_SALE": "Drink / Sold As-Is",
    "SUPPLY": "Packaging / Supply",
}

MOVEMENT_LABEL = {
    MovementType.OPENING_BALANCE: "Starting stock",
    MovementType.RECEIVE: "Delivery",
    MovementType.TRANSFER_IN: "Moved in",
    MovementType.TRANSFER_OUT: "Moved out",
    MovementType.EXPLICIT_WASTE: "Waste",
    MovementType.MANUAL_ADJUSTMENT: "Stock fixed",
    MovementType.COUNT_RECONCILIATION: "Stock count",
    MovementType.RETURN_TO_SUPPLIER: "Returned to supplier",
    MovementType.REVERSAL: "Undo",
    MovementType.SALE: "Sold",
}

# Friendly history filters → movement types
MOVEMENT_GROUPS = {
    "deliveries": [MovementType.RECEIVE, MovementType.OPENING_BALANCE],
    "counts": [MovementType.COUNT_RECONCILIATION],
    "waste": [MovementType.EXPLICIT_WASTE],
    "moves": [MovementType.TRANSFER_IN, MovementType.TRANSFER_OUT],
    "corrections": [MovementType.MANUAL_ADJUSTMENT, MovementType.RETURN_TO_SUPPLIER],
    "sales": [MovementType.SALE],
    "undo": [MovementType.REVERSAL],
}

WASTE_REASON_LABEL = dict(WasteReason.choices)
COUNT_STATUS_LABEL = {
    CountStatus.DRAFT: "Not started",
    CountStatus.IN_PROGRESS: "Counting",
    CountStatus.SUBMITTED: "Waiting for review",
    CountStatus.APPROVED: "Stock updated",
    CountStatus.CANCELLED: "Cancelled",
}
PO_STATUS_LABEL = {
    "DRAFT": "Draft",
    "SENT": "Ordered",
    "PARTIALLY_RECEIVED": "Partly delivered",
    "RECEIVED": "Delivered",
    "CANCELLED": "Cancelled",
}


def _d(value) -> str:
    """Machine-friendly decimal: no thousands separators, no trailing zeros."""
    if value is None or value == "":
        return ""
    value = Decimal(value)
    text = format(value.normalize(), "f")
    return "0" if text in ("-0", "") else text


def _money(value) -> str:
    if value is None:
        return ""
    return _d(Decimal(value).quantize(Decimal("0.01")))


def _date(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _datetime(value) -> str:
    if value is None:
        return ""
    return value.replace(microsecond=0).isoformat()


def _person(user, label=""):
    if label:
        return label
    if not user:
        return ""
    return user.get_full_name() or user.email


@dataclass
class Column:
    key: str
    label: str
    cost: bool = False
    numeric: bool = False
    pdf_width: float = 1.0  # relative width in PDF tables


@dataclass
class Report:
    key: str
    title: str
    columns: list[Column]
    rows_fn: Callable[[], Iterable[dict]]
    count_fn: Callable[[], int]
    page_fn: Callable[[int, int], list[dict]]
    include_cost: bool = False
    summary: dict = field(default_factory=dict)
    date_filtered: bool = False

    @property
    def visible_columns(self) -> list[Column]:
        return [c for c in self.columns if self.include_cost or not c.cost]

    def _strip(self, row: dict) -> dict:
        return {c.key: row.get(c.key, "") for c in self.visible_columns}

    def iter_rows(self) -> Iterator[dict]:
        for row in self.rows_fn():
            yield self._strip(row)

    def count(self) -> int:
        return self.count_fn()

    def page(self, offset: int, limit: int) -> list[dict]:
        return [self._strip(r) for r in self.page_fn(offset, limit)]


# ─────────────────────────────────────────────────────────────────────────────
# Filters
# ─────────────────────────────────────────────────────────────────────────────


def _int_param(params, key):
    value = params.get(key)
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _date_param(params, key):
    value = params.get(key)
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _date_range(qs, params, merchant=None, field_name="created_at"):
    """Filter a queryset to whole local days in the merchant's own timezone.

    `from_date`/`to_date` are calendar days in the merchant's local day (e.g.
    a Kathmandu merchant's Friday runs 23:45–21:59 UTC). This matches how the
    POS reports and merchant analytics bucket days, so a report never mixes
    rows across the UTC calendar boundary.
    """
    start, end = _date_param(params, "from_date"), _date_param(params, "to_date")
    if not (start or end):
        return qs
    tz_name = (merchant.timezone or "Asia/Kathmandu") if merchant else None
    tz = ZoneInfo(tz_name) if tz_name else timezone.get_current_timezone()
    if start:
        qs = qs.filter(**{
            f"{field_name}__gte": timezone.make_aware(datetime.combine(start, datetime.min.time()), tz),
        })
    if end:
        end = end + timedelta(days=1)
        qs = qs.filter(**{
            f"{field_name}__lt": timezone.make_aware(datetime.combine(end, datetime.min.time()), tz),
        })
    return qs


def _queryset_report(qs, row_fn, chunk=1000):
    """rows/count/page callables for a queryset + row mapper."""

    def rows():
        for obj in qs.iterator(chunk_size=chunk):
            yield row_fn(obj)

    def page(offset, limit):
        return [row_fn(obj) for obj in qs[offset: offset + limit]]

    return rows, qs.count, page


# ─────────────────────────────────────────────────────────────────────────────
# Stock (current + low)
# ─────────────────────────────────────────────────────────────────────────────


def filtered_items(merchant, params):
    """Active items with stock totals/status, filtered like the Stock page."""
    qs = InventoryItem.objects.filter(merchant=merchant, archived=False)
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(name__icontains=q) | Q(sku__icontains=q) | Q(barcode__icontains=q)
            | Q(category__name__icontains=q)
        )
    item_type = params.get("type")
    if item_type:
        qs = qs.filter(item_type=item_type)
    category = _int_param(params, "category")
    if category:
        qs = qs.filter(category_id=category)
    supplier = _int_param(params, "supplier")
    if supplier:
        qs = qs.filter(primary_supplier_id=supplier)
    location = _int_param(params, "location")
    if location:
        qs = items_stored_at(qs, merchant, location)
    qs = with_stock_totals(qs, merchant)
    status = params.get("status")
    if status:
        wanted = [s.strip().upper() for s in str(status).split(",") if s.strip()]
        qs = qs.filter(stock_state__in=wanted)
    return qs


def _stock_report(merchant, params, include_cost):
    location_id = _int_param(params, "location")
    items = (
        filtered_items(merchant, params)
        .select_related("category", "default_location", "base_unit")
        .prefetch_related(
            Prefetch(
                "balances",
                queryset=InventoryBalance.objects.filter(merchant=merchant).select_related("location"),
            )
        )
        .order_by("name", "id")
    )

    def expand(item):
        balances = [b for b in item.balances.all() if b.on_hand or b.location_id == location_id]
        if location_id:
            balances = [b for b in balances if b.location_id == location_id]
        base = {
            "item": item.name,
            "item_type": ITEM_TYPE_LABEL.get(item.item_type, item.item_type),
            "category": item.category.name if item.category else "",
            "unit": item.base_unit.code,
            "status": STATUS_LABEL.get(item.stock_state, item.stock_state),
            "keep_around": _d(item.par_level),
            "warn_me_below": _d(item.reorder_point),
            "very_low_level": _d(item.critical_level),
            "last_counted": _date(item.last_count_at),
            "last_received": _date(item.last_received_at),
            "sku": item.sku,
        }
        if not balances:
            yield {
                **base,
                "location": item.default_location.name if item.default_location else "",
                "quantity": "0",
                "average_cost": "",
                "latest_cost": "",
                "stock_value": "0" if include_cost else "",
            }
            return
        for b in sorted(balances, key=lambda x: x.location.name):
            yield {
                **base,
                "location": b.location.name,
                "quantity": _d(b.on_hand),
                "average_cost": _d(b.avg_cost),
                "latest_cost": _d(b.latest_cost),
                "stock_value": _money(b.on_hand * b.avg_cost),
            }

    def rows():
        for item in items.iterator(chunk_size=500):
            yield from expand(item)

    def page(offset, limit):
        out = []
        for item in items[offset: offset + limit]:
            out.extend(expand(item))
        return out

    columns = [
        Column("item", "Item", pdf_width=2.2),
        Column("item_type", "Item Type", pdf_width=1.3),
        Column("category", "Category", pdf_width=1.3),
        Column("location", "Location", pdf_width=1.3),
        Column("quantity", "Current Quantity", numeric=True),
        Column("unit", "Unit", pdf_width=0.6),
        Column("status", "Status", pdf_width=1.0),
        Column("keep_around", "Keep Around", numeric=True),
        Column("warn_me_below", "Warn Me Below", numeric=True),
        Column("very_low_level", "Very Low Level", numeric=True),
        Column("last_counted", "Last Counted"),
        Column("last_received", "Last Received"),
        Column("average_cost", "Average Cost", cost=True, numeric=True),
        Column("latest_cost", "Latest Cost", cost=True, numeric=True),
        Column("stock_value", "Stock Value", cost=True, numeric=True),
    ]
    return Report(
        key="current-stock", title="Current Stock", columns=columns,
        rows_fn=rows, count_fn=items.count, page_fn=page, include_cost=include_cost,
    )


def _low_stock_report(merchant, params, include_cost):
    params = {**params, "status": params.get("status") or "LOW,CRITICAL,OUT"}
    items = (
        filtered_items(merchant, params)
        .select_related("default_location", "base_unit", "primary_supplier")
        .order_by("name", "id")
    )
    order = {"OUT": 0, "CRITICAL": 1, "LOW": 2}

    def row(item):
        return {
            "item": item.name,
            "location": item.default_location.name if item.default_location else "",
            "quantity": _d(item.total_on_hand),
            "unit": item.base_unit.code,
            "status": STATUS_LABEL.get(item.stock_state, item.stock_state),
            "keep_around": _d(item.par_level),
            "warn_me_below": _d(item.reorder_point),
            "suggested_order": _d(suggested_order_qty(item, item.total_on_hand)),
            "supplier": item.primary_supplier.name if item.primary_supplier else "",
        }

    def rows():
        # Low-stock lists are small by nature; sort most urgent first.
        ordered = sorted(items, key=lambda i: (order.get(i.stock_state, 9), i.name.lower()))
        for item in ordered:
            yield row(item)

    def page(offset, limit):
        return list(rows())[offset: offset + limit]

    columns = [
        Column("item", "Item", pdf_width=2.2),
        Column("location", "Usually Kept In", pdf_width=1.4),
        Column("quantity", "Quantity", numeric=True),
        Column("unit", "Unit", pdf_width=0.6),
        Column("status", "Status"),
        Column("keep_around", "Keep Around", numeric=True),
        Column("warn_me_below", "Warn Me Below", numeric=True),
        Column("suggested_order", "Suggested Order", numeric=True),
        Column("supplier", "Supplier", pdf_width=1.4),
    ]
    return Report(
        key="low-stock", title="Low Stock", columns=columns,
        rows_fn=rows, count_fn=items.count, page_fn=page, include_cost=include_cost,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Movements / waste / counts / purchasing
# ─────────────────────────────────────────────────────────────────────────────


def movements_queryset(merchant, params):
    qs = InventoryMovement.objects.filter(merchant=merchant).select_related(
        "inventory_item__base_unit", "location", "performed_by", "approved_by"
    )
    qs = _date_range(qs, params, merchant=merchant)
    group = params.get("group")
    if group in MOVEMENT_GROUPS:
        qs = qs.filter(movement_type__in=MOVEMENT_GROUPS[group])
    movement_type = params.get("movement_type")
    if movement_type:
        qs = qs.filter(movement_type=str(movement_type).upper())
    item = _int_param(params, "item")
    if item:
        qs = qs.filter(inventory_item_id=item)
    location = _int_param(params, "location")
    if location:
        qs = qs.filter(location_id=location)
    category = _int_param(params, "category")
    if category:
        qs = qs.filter(inventory_item__category_id=category)
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(inventory_item__name__icontains=q)
    return qs.order_by("-created_at", "-id")


def _movements_report(merchant, params, include_cost):
    qs = movements_queryset(merchant, params)

    def row(m):
        return {
            "date": _datetime(m.created_at),
            "item": m.inventory_item.name,
            "location": m.location.name,
            "change": _d(m.quantity_change),
            "unit": m.inventory_item.base_unit.code,
            "type": MOVEMENT_LABEL.get(m.movement_type, m.movement_type),
            "reason": WASTE_REASON_LABEL.get(m.reason, m.reason),
            "before": _d(m.balance_before),
            "after": _d(m.balance_after),
            "by": _person(m.performed_by, m.actor_label),
            "unit_cost": _d(m.unit_cost),
        }

    rows, count, page = _queryset_report(qs, row)
    columns = [
        Column("date", "Date / Time", pdf_width=1.5),
        Column("item", "Item", pdf_width=1.8),
        Column("location", "Location", pdf_width=1.2),
        Column("change", "Change", numeric=True, pdf_width=0.8),
        Column("unit", "Unit", pdf_width=0.5),
        Column("type", "What Happened", pdf_width=1.1),
        Column("reason", "Reason", pdf_width=1.3),
        Column("before", "Before", numeric=True, pdf_width=0.8),
        Column("after", "After", numeric=True, pdf_width=0.8),
        Column("by", "By", pdf_width=1.2),
        Column("unit_cost", "Unit Cost", cost=True, numeric=True, pdf_width=0.8),
    ]
    return Report(
        key="stock-history", title="Stock History", columns=columns,
        rows_fn=rows, count_fn=count, page_fn=page, include_cost=include_cost,
        date_filtered=True,
    )


def waste_queryset(merchant, params):
    qs = InventoryWasteRecord.objects.filter(merchant=merchant).select_related(
        "inventory_item__base_unit", "location", "performed_by"
    )
    qs = _date_range(qs, params, merchant=merchant)
    for key, lookup in (("item", "inventory_item_id"), ("location", "location_id"),
                        ("category", "inventory_item__category_id")):
        value = _int_param(params, key)
        if value:
            qs = qs.filter(**{lookup: value})
    reason = params.get("reason")
    if reason:
        qs = qs.filter(reason=reason)
    return qs.order_by("-created_at", "-id")


def _waste_report(merchant, params, include_cost):
    qs = waste_queryset(merchant, params)

    def row(w):
        cost = (w.quantity * w.per_unit_cost) if w.per_unit_cost is not None else None
        reason = WASTE_REASON_LABEL.get(w.reason, w.reason)
        if w.custom_reason:
            reason = f"{reason}: {w.custom_reason}"
        return {
            "date": _datetime(w.created_at),
            "item": w.inventory_item.name,
            "location": w.location.name,
            "quantity": _d(w.quantity),
            "unit": w.inventory_item.base_unit.code,
            "reason": reason,
            "note": w.note,
            "by": _person(w.performed_by, w.performed_by_label),
            "cost": _money(cost),
        }

    rows, count, page = _queryset_report(qs, row)
    summary = {}
    if include_cost:
        total = Decimal("0")
        for qty, unit_cost in qs.exclude(per_unit_cost__isnull=True).values_list(
            "quantity", "per_unit_cost"
        ):
            total += qty * unit_cost
        summary["total_cost"] = _money(total)
    summary["records"] = qs.count()
    columns = [
        Column("date", "Date / Time", pdf_width=1.5),
        Column("item", "Item", pdf_width=1.8),
        Column("location", "Location", pdf_width=1.2),
        Column("quantity", "Quantity", numeric=True, pdf_width=0.8),
        Column("unit", "Unit", pdf_width=0.5),
        Column("reason", "Why", pdf_width=1.3),
        Column("note", "Note", pdf_width=1.6),
        Column("by", "Recorded By", pdf_width=1.2),
        Column("cost", "Cost", cost=True, numeric=True, pdf_width=0.8),
    ]
    return Report(
        key="waste", title="Waste", columns=columns, rows_fn=rows, count_fn=count,
        page_fn=page, include_cost=include_cost, summary=summary, date_filtered=True,
    )


def _counts_report(merchant, params, include_cost):
    qs = StockCount.objects.filter(merchant=merchant).select_related(
        "location", "started_by", "submitted_by", "approved_by"
    ).annotate(
        n_lines=Count("lines", distinct=True),
        n_counted=Count("lines", filter=Q(lines__physical_quantity__isnull=False), distinct=True),
        n_different=Count(
            "lines",
            filter=Q(lines__difference__isnull=False) & ~Q(lines__difference=0),
            distinct=True,
        ),
    )
    qs = _date_range(qs, params, merchant=merchant)
    location = _int_param(params, "location")
    if location:
        qs = qs.filter(location_id=location)
    status = params.get("status")
    if status:
        qs = qs.filter(status=str(status).upper())
    qs = qs.order_by("-created_at", "-id")

    def row(c):
        return {
            "count": c.name,
            "location": c.location.name if c.location else "All locations",
            "status": COUNT_STATUS_LABEL.get(c.status, c.status),
            "started": _datetime(c.started_at or c.created_at),
            "counted_by": _person(c.submitted_by or c.started_by),
            "approved": _datetime(c.approved_at),
            "approved_by": _person(c.approved_by),
            "items": str(c.n_lines),
            "counted": str(c.n_counted),
            "differences": str(c.n_different),
        }

    rows, count, page = _queryset_report(qs, row)
    columns = [
        Column("count", "Count", pdf_width=2.0),
        Column("location", "Location", pdf_width=1.3),
        Column("status", "Status", pdf_width=1.2),
        Column("started", "Started", pdf_width=1.4),
        Column("counted_by", "Counted By", pdf_width=1.2),
        Column("approved", "Approved", pdf_width=1.4),
        Column("approved_by", "Approved By", pdf_width=1.2),
        Column("items", "Items", numeric=True, pdf_width=0.6),
        Column("counted", "Counted", numeric=True, pdf_width=0.7),
        Column("differences", "Differences", numeric=True, pdf_width=0.8),
    ]
    return Report(
        key="stock-counts", title="Stock Counts", columns=columns, rows_fn=rows,
        count_fn=count, page_fn=page, include_cost=include_cost, date_filtered=True,
    )


def _count_differences_report(merchant, params, include_cost):
    """Approved count lines whose counted quantity differed from the system.

    Value difference uses the merchant-scoped balance for the SAME item and
    location as the line — never an arbitrary balance of the item.
    """
    qs = (
        StockCountLine.objects.filter(
            stock_count__merchant=merchant,
            stock_count__status=CountStatus.APPROVED,
            physical_quantity__isnull=False,
        )
        .exclude(difference=0)
        .exclude(difference__isnull=True)
        .select_related("inventory_item__base_unit", "location", "stock_count")
    )
    start, end = _date_param(params, "from_date"), _date_param(params, "to_date")
    if start:
        qs = qs.filter(stock_count__approved_at__date__gte=start)
    if end:
        qs = qs.filter(stock_count__approved_at__date__lte=end)
    location = _int_param(params, "location")
    if location:
        qs = qs.filter(location_id=location)
    category = _int_param(params, "category")
    if category:
        qs = qs.filter(inventory_item__category_id=category)
    item = _int_param(params, "item")
    if item:
        qs = qs.filter(inventory_item_id=item)
    qs = qs.order_by("-stock_count__approved_at", "-id")

    def cost_map(lines):
        if not include_cost:
            return {}
        keys = {(l.inventory_item_id, l.location_id) for l in lines}
        if not keys:
            return {}
        balances = InventoryBalance.objects.filter(
            merchant=merchant,
            inventory_item_id__in={k[0] for k in keys},
            location_id__in={k[1] for k in keys},
        ).values_list("inventory_item_id", "location_id", "avg_cost")
        return {(i, l): c for i, l, c in balances}

    def row(line, costs):
        diff = line.difference
        avg = costs.get((line.inventory_item_id, line.location_id))
        return {
            "date": _date(line.stock_count.approved_at),
            "count": line.stock_count.name,
            "item": line.inventory_item.name,
            "location": line.location.name,
            "system_said": _d(line.book_quantity),
            "counted": _d(line.physical_quantity),
            "difference": _d(diff),
            "unit": line.inventory_item.base_unit.code,
            "direction": "more" if diff > 0 else "less",
            "value_difference": _money(abs(diff) * avg) if avg is not None else "",
        }

    def rows():
        batch = []
        for line in qs.iterator(chunk_size=500):
            batch.append(line)
            if len(batch) == 500:
                costs = cost_map(batch)
                yield from (row(l, costs) for l in batch)
                batch = []
        if batch:
            costs = cost_map(batch)
            yield from (row(l, costs) for l in batch)

    def page(offset, limit):
        lines = list(qs[offset: offset + limit])
        costs = cost_map(lines)
        return [row(l, costs) for l in lines]

    columns = [
        Column("date", "Approved", pdf_width=1.0),
        Column("count", "Count", pdf_width=1.6),
        Column("item", "Item", pdf_width=1.8),
        Column("location", "Location", pdf_width=1.2),
        Column("system_said", "System Said", numeric=True),
        Column("counted", "Counted", numeric=True),
        Column("difference", "Difference", numeric=True),
        Column("unit", "Unit", pdf_width=0.5),
        Column("value_difference", "Value Difference", cost=True, numeric=True),
    ]
    return Report(
        key="count-differences", title="Count Differences", columns=columns,
        rows_fn=rows, count_fn=qs.count, page_fn=page, include_cost=include_cost,
        date_filtered=True,
    )


def _purchasing_report(merchant, params, include_cost):
    qs = PurchaseOrder.objects.filter(merchant=merchant).select_related(
        "supplier", "delivery_location"
    ).annotate(n_lines=Count("lines"))
    qs = _date_range(qs, params, merchant=merchant)
    location = _int_param(params, "location")
    if location:
        qs = qs.filter(delivery_location_id=location)
    supplier = _int_param(params, "supplier")
    if supplier:
        qs = qs.filter(supplier_id=supplier)
    qs = qs.order_by("-created_at", "-id")

    def row(po):
        return {
            "order": po.po_number,
            "supplier": po.supplier.name,
            "status": PO_STATUS_LABEL.get(po.status, po.status),
            "ordered": _date(po.created_at),
            "expected": _date(po.expected_date),
            "deliver_to": po.delivery_location.name,
            "lines": str(po.n_lines),
            "total": _money(po.total_amount),
        }

    rows, count, page = _queryset_report(qs, row)
    columns = [
        Column("order", "Order", pdf_width=1.0),
        Column("supplier", "Supplier", pdf_width=1.8),
        Column("status", "Status", pdf_width=1.2),
        Column("ordered", "Ordered"),
        Column("expected", "Expected"),
        Column("deliver_to", "Deliver To", pdf_width=1.3),
        Column("lines", "Items", numeric=True, pdf_width=0.6),
        Column("total", "Total", cost=True, numeric=True),
    ]
    return Report(
        key="purchasing", title="Supplier Orders", columns=columns, rows_fn=rows,
        count_fn=count, page_fn=page, include_cost=include_cost, date_filtered=True,
    )


def _deliveries_report(merchant, params, include_cost):
    qs = InventoryReceiving.objects.filter(merchant=merchant).select_related(
        "supplier", "location", "received_by"
    ).annotate(n_lines=Count("lines"))
    qs = _date_range(qs, params, merchant=merchant, field_name="received_at")
    location = _int_param(params, "location")
    if location:
        qs = qs.filter(location_id=location)
    qs = qs.order_by("-received_at", "-id")

    def row(r):
        return {
            "date": _datetime(r.received_at),
            "receipt": r.receipt_number,
            "supplier": r.supplier.name if r.supplier else "",
            "location": r.location.name,
            "reference": r.reference,
            "lines": str(r.n_lines),
            "received_by": _person(r.received_by),
            "total": _money(r.total_value),
        }

    rows, count, page = _queryset_report(qs, row)
    columns = [
        Column("date", "Date / Time", pdf_width=1.5),
        Column("receipt", "Receipt", pdf_width=0.9),
        Column("supplier", "Supplier", pdf_width=1.6),
        Column("location", "Location", pdf_width=1.3),
        Column("reference", "Invoice / Reference", pdf_width=1.3),
        Column("lines", "Items", numeric=True, pdf_width=0.6),
        Column("received_by", "Added By", pdf_width=1.2),
        Column("total", "Total", cost=True, numeric=True),
    ]
    return Report(
        key="deliveries", title="Deliveries", columns=columns, rows_fn=rows,
        count_fn=count, page_fn=page, include_cost=include_cost, date_filtered=True,
    )


BUILDERS = {
    "current-stock": _stock_report,
    "low-stock": _low_stock_report,
    "stock-history": _movements_report,
    "waste": _waste_report,
    "stock-counts": _counts_report,
    "count-differences": _count_differences_report,
    "purchasing": _purchasing_report,
    "deliveries": _deliveries_report,
}

# Older report names used by the first version of the API.
ALIASES = {
    "stock": "current-stock",
    "movements": "stock-history",
    "variance": "count-differences",
    "count-history": "stock-counts",
}


def normalise_key(key: str) -> str | None:
    key = ALIASES.get(key, key)
    return key if key in BUILDERS else None


def build_report(key: str, merchant, params, include_cost: bool) -> Report:
    key = normalise_key(key)
    if key is None:
        raise KeyError("Unknown report.")
    return BUILDERS[key](merchant, params, include_cost)
