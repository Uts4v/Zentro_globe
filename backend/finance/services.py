"""
finance/services.py — every number in the Accounts section is computed here.

Two pots of money are tracked:

  CASH  the cash drawer. In: cash sales (less change given), POS pay-ins,
        cash taken from the bank, other income paid in cash. Out: cash
        refunds, POS pay-outs, POS cash drops, cash put in the bank, and
        expenses / supplier payments / salaries paid in cash.
  BANK  everything that is not cash. In: card, QR, wallet and "other" POS
        payments, POS cash drops, cash put in the bank, other non-cash income.
        Out: non-cash refunds, cash taken from the bank, and expenses /
        supplier payments / salaries paid by bank, online or cheque.

Sales on a customer's credit account or from a prepaid balance are counted as
sales but move neither pot (no money changes hands at the till).
"""

from datetime import date as date_cls, datetime, time as dt_time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import Count, Max, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from inventory.models import InventoryReceiving, Supplier
from orders.models import Order
from pos.models import PosCashMovement, PosPayment

from .models import FinanceSettings, MoneyEntry, StaffSalary

ZERO = Decimal("0")
CENT = Decimal("0.01")

CASH = PosPayment.METHOD_CASH
ONLINE_METHODS = (
    PosPayment.METHOD_CARD, PosPayment.METHOD_BANK_QR,
    PosPayment.METHOD_MOBILE_WALLET, PosPayment.METHOD_OTHER,
)
ON_ACCOUNT_METHODS = (PosPayment.METHOD_CREDIT, PosPayment.METHOD_DEBIT)
METHOD_LABELS = dict(PosPayment.METHOD_CHOICES)
ROW_LIMIT = 500


def money(value) -> str:
    return str((value or ZERO).quantize(CENT))


def merchant_tz(merchant):
    try:
        return ZoneInfo(merchant.timezone or "Asia/Kathmandu")
    except Exception:
        return ZoneInfo("Asia/Kathmandu")


def today(merchant) -> date_cls:
    return timezone.localtime(timezone.now(), merchant_tz(merchant)).date()


def _dt_bounds(merchant, date_from, date_to):
    """Aware datetimes for [date_from 00:00, date_to+1 00:00) in the merchant's timezone."""
    tz = merchant_tz(merchant)
    start = datetime.combine(date_from, dt_time.min, tzinfo=tz) if date_from else None
    end = datetime.combine(date_to + timedelta(days=1), dt_time.min, tzinfo=tz) if date_to else None
    return start, end


def _in_range(qs, field, start, end):
    if start is not None:
        qs = qs.filter(**{f"{field}__gte": start})
    if end is not None:
        qs = qs.filter(**{f"{field}__lt": end})
    return qs


def _payments(merchant, date_from, date_to):
    start, end = _dt_bounds(merchant, date_from, date_to)
    return _in_range(PosPayment.objects.filter(merchant=merchant), "created_at", start, end)


def _cash_movements(merchant, date_from, date_to):
    start, end = _dt_bounds(merchant, date_from, date_to)
    return _in_range(
        PosCashMovement.objects.filter(shift__merchant=merchant), "created_at", start, end,
    )


def _entries(merchant, date_from, date_to):
    qs = MoneyEntry.objects.filter(merchant=merchant, is_void=False)
    if date_from:
        qs = qs.filter(date__gte=date_from)
    if date_to:
        qs = qs.filter(date__lte=date_to)
    return qs


# ── Totals ───────────────────────────────────────────────────────────────────

def totals(merchant, date_from=None, date_to=None) -> dict:
    """Every money total for the period (either bound may be None = open)."""
    sales = {m: ZERO for m in (CASH, *ONLINE_METHODS, *ON_ACCOUNT_METHODS)}
    refunds = {m: ZERO for m in sales}
    payment_count = 0
    for row in _payments(merchant, date_from, date_to).values("payment_method", "status").annotate(
        amount=Sum("amount"), change=Sum("change_amount"), n=Count("id"),
    ):
        method = row["payment_method"]
        if method not in sales:
            continue
        if row["status"] == PosPayment.STATUS_COMPLETED:
            sales[method] += (row["amount"] or ZERO) - (row["change"] or ZERO)
            payment_count += row["n"]
        elif row["status"] == PosPayment.STATUS_REFUNDED:
            refunds[method] += abs(row["amount"] or ZERO)

    pos_cash = {t: ZERO for t, _ in PosCashMovement.TYPE_CHOICES}
    for row in _cash_movements(merchant, date_from, date_to).values("movement_type").annotate(
        amount=Sum("amount"),
    ):
        pos_cash[row["movement_type"]] = row["amount"] or ZERO

    # Manual entries, split by kind and by which pot they touch.
    by_kind = {k: {"cash": ZERO, "bank": ZERO} for k, _ in MoneyEntry.KIND_CHOICES}
    for row in _entries(merchant, date_from, date_to).values("kind", "payment_method").annotate(
        amount=Sum("amount"),
    ):
        pot = "cash" if row["payment_method"] == MoneyEntry.METHOD_CASH else "bank"
        by_kind[row["kind"]][pot] += row["amount"] or ZERO

    def kind_total(kind):
        return by_kind[kind]["cash"] + by_kind[kind]["bank"]

    deposits = kind_total(MoneyEntry.KIND_BANK_DEPOSIT)
    withdrawals = kind_total(MoneyEntry.KIND_BANK_WITHDRAWAL)
    out_cash = sum((by_kind[k]["cash"] for k in MoneyEntry.OUT_KINDS), ZERO)
    out_bank = sum((by_kind[k]["bank"] for k in MoneyEntry.OUT_KINDS), ZERO)
    income = by_kind[MoneyEntry.KIND_OTHER_INCOME]

    online_sales = sum((sales[m] for m in ONLINE_METHODS), ZERO)
    online_refunds = sum((refunds[m] for m in ONLINE_METHODS), ZERO)
    on_account_sales = sum((sales[m] for m in ON_ACCOUNT_METHODS), ZERO)

    cash_in = sales[CASH] + pos_cash[PosCashMovement.TYPE_PAYIN] + withdrawals + income["cash"]
    cash_out = (
        refunds[CASH] + pos_cash[PosCashMovement.TYPE_PAYOUT]
        + pos_cash[PosCashMovement.TYPE_CASHDROP] + deposits + out_cash
    )
    bank_in = online_sales + pos_cash[PosCashMovement.TYPE_CASHDROP] + deposits + income["bank"]
    bank_out = online_refunds + withdrawals + out_bank

    return {
        "sales_by_method": sales,
        "refunds_by_method": refunds,
        "payment_count": payment_count,
        "cash_sales": sales[CASH],
        "online_sales": online_sales,
        "on_account_sales": on_account_sales,
        "total_sales": sales[CASH] + online_sales + on_account_sales,
        "refunds": sum(refunds.values(), ZERO),
        "pos_payin": pos_cash[PosCashMovement.TYPE_PAYIN],
        "pos_payout": pos_cash[PosCashMovement.TYPE_PAYOUT],
        "pos_cashdrop": pos_cash[PosCashMovement.TYPE_CASHDROP],
        "expenses": kind_total(MoneyEntry.KIND_EXPENSE),
        "supplier_payments": kind_total(MoneyEntry.KIND_SUPPLIER_PAYMENT),
        "salaries": kind_total(MoneyEntry.KIND_SALARY_PAYMENT),
        "other_income": income["cash"] + income["bank"],
        "bank_deposits": deposits,
        "bank_withdrawals": withdrawals,
        "cash_in": cash_in,
        "cash_out": cash_out,
        "bank_in": bank_in,
        "bank_out": bank_out,
    }


def balances(merchant, as_of=None) -> dict:
    """Cash and bank balance at the end of ``as_of`` (default: now)."""
    settings = FinanceSettings.for_merchant(merchant)
    t = totals(merchant, settings.opening_date, as_of)
    return {
        "cash": settings.opening_cash + t["cash_in"] - t["cash_out"],
        "bank": settings.opening_bank + t["bank_in"] - t["bank_out"],
        "opening_cash": settings.opening_cash,
        "opening_bank": settings.opening_bank,
        "opening_date": settings.opening_date,
    }


def _order_figures(merchant, date_from, date_to) -> dict:
    start, end = _dt_bounds(merchant, date_from, date_to)
    qs = _in_range(
        Order.objects.filter(merchant=merchant).exclude(status=Order.STATUS_CANCELLED),
        "created_at", start, end,
    )
    agg = qs.aggregate(discounts=Sum("discount_amount"), tax=Sum("tax_amount"), orders=Count("id"))
    from orders.models import OrderItem

    free = _in_range(
        OrderItem.objects.filter(order__merchant=merchant, is_complimentary=True)
        .exclude(order__status=Order.STATUS_CANCELLED),
        "order__created_at", start, end,
    ).aggregate(value=Sum("complimentary_value"), n=Count("id"))
    return {
        "discounts": agg["discounts"] or ZERO,
        "tax_collected": agg["tax"] or ZERO,
        "orders": agg["orders"] or 0,
        "free_items_value": free["value"] or ZERO,
        "free_items_count": free["n"] or 0,
    }


def supplier_outstanding_total(merchant) -> Decimal:
    purchased = InventoryReceiving.objects.filter(
        merchant=merchant, supplier__isnull=False,
    ).aggregate(v=Sum("total_value"))["v"] or ZERO
    paid = MoneyEntry.objects.filter(
        merchant=merchant, is_void=False, kind=MoneyEntry.KIND_SUPPLIER_PAYMENT,
    ).aggregate(v=Sum("amount"))["v"] or ZERO
    return purchased - paid


def salary_outstanding_total(merchant) -> Decimal:
    owed = StaffSalary.objects.filter(merchant=merchant).aggregate(v=Sum("amount"))["v"] or ZERO
    paid = MoneyEntry.objects.filter(
        merchant=merchant, is_void=False, kind=MoneyEntry.KIND_SALARY_PAYMENT,
    ).aggregate(v=Sum("amount"))["v"] or ZERO
    return owed - paid


def summary(merchant, date_from, date_to) -> dict:
    t = totals(merchant, date_from, date_to)
    orders = _order_figures(merchant, date_from, date_to)
    bal = balances(merchant)

    money_out = t["refunds"] + t["expenses"] + t["pos_payout"] + t["supplier_payments"] + t["salaries"]
    money_in = t["total_sales"] + t["other_income"]
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "currency_symbol": merchant.currency_symbol,
        "sales": {
            "total": money(t["total_sales"]),
            "cash": money(t["cash_sales"]),
            "online": money(t["online_sales"]),
            "on_account": money(t["on_account_sales"]),
            "payments": t["payment_count"],
            "orders": orders["orders"],
            "by_method": [
                {"key": k, "label": METHOD_LABELS.get(k, k), "amount": money(v)}
                for k, v in t["sales_by_method"].items() if v
            ],
        },
        "money_out": {
            "refunds": money(t["refunds"]),
            "expenses": money(t["expenses"]),
            "pos_payouts": money(t["pos_payout"]),
            "supplier_payments": money(t["supplier_payments"]),
            "salaries": money(t["salaries"]),
            "total": money(money_out),
        },
        "other_income": money(t["other_income"]),
        "discounts": money(orders["discounts"]),
        "free_items_value": money(orders["free_items_value"]),
        "free_items_count": orders["free_items_count"],
        "tax_collected": money(orders["tax_collected"]),
        "net": money(money_in - money_out),
        "bank_deposits": money(t["bank_deposits"] + t["pos_cashdrop"]),
        "bank_withdrawals": money(t["bank_withdrawals"]),
        "balances": {
            "cash": money(bal["cash"]),
            "bank": money(bal["bank"]),
            "total": money(bal["cash"] + bal["bank"]),
        },
        "owed": {
            "suppliers": money(supplier_outstanding_total(merchant)),
            "salaries": money(salary_outstanding_total(merchant)),
        },
        "daily": daily_series(merchant, date_from, date_to),
    }


def daily_series(merchant, date_from, date_to) -> list[dict]:
    """Money in and out per day, for the chart. At most 92 days."""
    if (date_to - date_from).days > 92:
        date_from = date_to - timedelta(days=92)
    tz = merchant_tz(merchant)
    days = {}
    cursor = date_from
    while cursor <= date_to:
        days[cursor] = {"sales": ZERO, "out": ZERO}
        cursor += timedelta(days=1)

    pay = _payments(merchant, date_from, date_to).annotate(
        day=TruncDate("created_at", tzinfo=tz),
    ).values("day", "status").annotate(amount=Sum("amount"), change=Sum("change_amount"))
    for row in pay:
        bucket = days.get(row["day"])
        if bucket is None:
            continue
        if row["status"] == PosPayment.STATUS_COMPLETED:
            bucket["sales"] += (row["amount"] or ZERO) - (row["change"] or ZERO)
        elif row["status"] == PosPayment.STATUS_REFUNDED:
            bucket["out"] += abs(row["amount"] or ZERO)

    for row in _cash_movements(merchant, date_from, date_to).filter(
        movement_type=PosCashMovement.TYPE_PAYOUT,
    ).annotate(day=TruncDate("created_at", tzinfo=tz)).values("day").annotate(amount=Sum("amount")):
        if row["day"] in days:
            days[row["day"]]["out"] += row["amount"] or ZERO

    for row in _entries(merchant, date_from, date_to).filter(
        kind__in=MoneyEntry.OUT_KINDS,
    ).values("date").annotate(amount=Sum("amount")):
        if row["date"] in days:
            days[row["date"]]["out"] += row["amount"] or ZERO

    return [
        {"date": d.isoformat(), "sales": float(v["sales"]), "out": float(v["out"])}
        for d, v in days.items()
    ]


# ── Books (the rows behind the Cash and Bank tabs) ───────────────────────────

def _entry_label(entry) -> str:
    if entry.kind == MoneyEntry.KIND_SUPPLIER_PAYMENT:
        return f"Paid supplier: {entry.supplier.name}" if entry.supplier_id else "Supplier payment"
    if entry.kind == MoneyEntry.KIND_SALARY_PAYMENT:
        return f"Salary: {entry.salary.worker_name}" if entry.salary_id else "Salary payment"
    if entry.kind == MoneyEntry.KIND_EXPENSE:
        category = dict(MoneyEntry.EXPENSE_CATEGORIES).get(entry.category, "")
        return f"Expense: {category}" if category else "Expense"
    return entry.get_kind_display()


def entry_dict(entry) -> dict:
    return {
        "id": entry.id,
        "kind": entry.kind,
        "kind_label": entry.get_kind_display(),
        "label": _entry_label(entry),
        "amount": money(entry.amount),
        "payment_method": entry.payment_method,
        "payment_method_label": entry.get_payment_method_display(),
        "date": entry.date.isoformat(),
        "category": entry.category,
        "reference": entry.reference,
        "note": entry.note,
        "supplier_id": entry.supplier_id,
        "supplier_name": entry.supplier.name if entry.supplier_id else "",
        "receiving_id": entry.receiving_id,
        "salary_id": entry.salary_id,
        "worker_name": entry.salary.worker_name if entry.salary_id else "",
        "created_by": entry.created_by_name,
        "created_at": entry.created_at.isoformat(),
        "is_void": entry.is_void,
        "voided_by": entry.voided_by_name,
        "void_reason": entry.void_reason,
    }


def _row(day, label, *, money_in=ZERO, money_out=ZERO, source, detail="", entry=None, sort=0):
    return {
        "date": day.isoformat(),
        "label": label,
        "detail": detail,
        "money_in": money(money_in),
        "money_out": money(money_out),
        "source": source,
        "entry_id": entry.id if entry is not None else None,
        "_sort": (day, sort),
    }


def _book_entry_effect(entry, account):
    """(money_in, money_out) of a manual entry on ``account``; None if it does not touch it."""
    if entry.kind == MoneyEntry.KIND_BANK_DEPOSIT:
        return (ZERO, entry.amount) if account == "cash" else (entry.amount, ZERO)
    if entry.kind == MoneyEntry.KIND_BANK_WITHDRAWAL:
        return (entry.amount, ZERO) if account == "cash" else (ZERO, entry.amount)
    if entry.account != account:
        return None
    if entry.kind == MoneyEntry.KIND_OTHER_INCOME:
        return (entry.amount, ZERO)
    return (ZERO, entry.amount)


def book(merchant, account, date_from, date_to) -> dict:
    """The cash book or the bank book for the period, newest first."""
    tz = merchant_tz(merchant)
    methods = (CASH,) if account == "cash" else ONLINE_METHODS
    rows = []

    daily = _payments(merchant, date_from, date_to).filter(payment_method__in=methods).annotate(
        day=TruncDate("created_at", tzinfo=tz),
    ).values("day", "status").annotate(
        amount=Sum("amount"), change=Sum("change_amount"), n=Count("id"),
    )
    sale_label = "Cash sales" if account == "cash" else "Online payments received"
    for r in daily:
        plural = "" if r["n"] == 1 else "s"
        if r["status"] == PosPayment.STATUS_COMPLETED:
            rows.append(_row(
                r["day"], sale_label, money_in=(r["amount"] or ZERO) - (r["change"] or ZERO),
                source="sales", detail=f"{r['n']} payment{plural}", sort=1,
            ))
        elif r["status"] == PosPayment.STATUS_REFUNDED:
            rows.append(_row(
                r["day"], "Refunds given", money_out=abs(r["amount"] or ZERO),
                source="refund", detail=f"{r['n']} refund{plural}", sort=2,
            ))

    for mv in _cash_movements(merchant, date_from, date_to).select_related("worker")[:ROW_LIMIT]:
        day = timezone.localtime(mv.created_at, tz).date()
        who = mv.worker.display_name if mv.worker_id else ""
        detail = " · ".join(x for x in (mv.reason, who) if x)
        if mv.movement_type == PosCashMovement.TYPE_CASHDROP:
            if account == "cash":
                rows.append(_row(day, "POS cash drop to bank", money_out=mv.amount, source="pos_cash", detail=detail, sort=3))
            else:
                rows.append(_row(day, "POS cash drop from the drawer", money_in=mv.amount, source="pos_cash", detail=detail, sort=3))
        elif account == "cash":
            if mv.movement_type == PosCashMovement.TYPE_PAYIN:
                rows.append(_row(day, "POS pay-in", money_in=mv.amount, source="pos_cash", detail=detail, sort=3))
            else:
                rows.append(_row(day, "POS pay-out", money_out=mv.amount, source="pos_cash", detail=detail, sort=3))

    entries = _entries(merchant, date_from, date_to).select_related("supplier", "salary")[:ROW_LIMIT]
    for entry in entries:
        effect = _book_entry_effect(entry, account)
        if effect is None:
            continue
        detail = " · ".join(x for x in (entry.note, entry.reference, entry.created_by_name) if x)
        rows.append(_row(
            entry.date, _entry_label(entry), money_in=effect[0], money_out=effect[1],
            source="entry", detail=detail, entry=entry, sort=4 + entry.id / 1e9,
        ))

    rows.sort(key=lambda r: r["_sort"], reverse=True)
    for r in rows:
        r.pop("_sort")

    t = totals(merchant, date_from, date_to)
    opening = balances(merchant, date_from - timedelta(days=1))[account]
    closing = balances(merchant, date_to)[account]
    return {
        "account": account,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "opening_balance": money(opening),
        "money_in": money(t[f"{account}_in"]),
        "money_out": money(t[f"{account}_out"]),
        "closing_balance": money(closing),
        "current_balance": money(balances(merchant)[account]),
        "rows": rows,
    }


def online_payments(merchant, date_from, date_to) -> dict:
    """Individual non-cash POS payments, newest first, with totals per method."""
    tz = merchant_tz(merchant)
    qs = _payments(merchant, date_from, date_to).filter(payment_method__in=ONLINE_METHODS)

    by_method = {}
    for r in qs.values("payment_method", "status").annotate(amount=Sum("amount"), n=Count("id")):
        slot = by_method.setdefault(r["payment_method"], {"received": ZERO, "refunded": ZERO, "count": 0})
        if r["status"] == PosPayment.STATUS_COMPLETED:
            slot["received"] += r["amount"] or ZERO
            slot["count"] += r["n"]
        elif r["status"] == PosPayment.STATUS_REFUNDED:
            slot["refunded"] += abs(r["amount"] or ZERO)

    listed = qs.filter(
        status__in=(PosPayment.STATUS_COMPLETED, PosPayment.STATUS_REFUNDED),
    ).select_related("order", "worker").order_by("-created_at")
    total_rows = listed.count()
    rows = []
    for p in listed[:ROW_LIMIT]:
        order = p.order
        label = merchant.payment_method_label(p.payment_method)
        rows.append({
            "id": str(p.id),
            "datetime": timezone.localtime(p.created_at, tz).isoformat(),
            "method": p.payment_method,
            "method_label": label,
            "amount": money(p.amount),
            "is_refund": p.status == PosPayment.STATUS_REFUNDED,
            "reference": p.external_reference,
            "order_id": order.id if order else None,
            "order_uuid": str(order.uuid) if order else "",
            "worker": p.worker.display_name if p.worker_id else "",
        })

    received = sum((v["received"] for v in by_method.values()), ZERO)
    refunded = sum((v["refunded"] for v in by_method.values()), ZERO)
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "received": money(received),
        "refunded": money(refunded),
        "net": money(received - refunded),
        "by_method": [
            {
                "key": k,
                "label": merchant.payment_method_label(k),
                "received": money(v["received"]),
                "refunded": money(v["refunded"]),
                "count": v["count"],
            }
            for k, v in by_method.items()
        ],
        "rows": rows,
        "total_rows": total_rows,
        "truncated": total_rows > len(rows),
    }


# ── Suppliers ────────────────────────────────────────────────────────────────

def supplier_overview(merchant) -> list[dict]:
    purchases = {
        r["supplier"]: r
        for r in InventoryReceiving.objects.filter(merchant=merchant, supplier__isnull=False)
        .values("supplier").annotate(total=Sum("total_value"), n=Count("id"), last=Max("received_at"))
    }
    payments = {
        r["supplier"]: r
        for r in MoneyEntry.objects.filter(
            merchant=merchant, is_void=False, kind=MoneyEntry.KIND_SUPPLIER_PAYMENT,
        ).values("supplier").annotate(total=Sum("amount"), last=Max("date"))
    }
    tz = merchant_tz(merchant)
    out = []
    for s in Supplier.objects.filter(merchant=merchant).order_by("name"):
        bought = purchases.get(s.id, {})
        paid = payments.get(s.id, {})
        if s.archived and not bought and not paid:
            continue
        purchased = bought.get("total") or ZERO
        paid_total = paid.get("total") or ZERO
        last_purchase = bought.get("last")
        out.append({
            "id": s.id,
            "name": s.name,
            "phone": s.phone,
            "payment_terms": s.payment_terms,
            "purchases": bought.get("n") or 0,
            "purchase_amount": money(purchased),
            "amount_paid": money(paid_total),
            "outstanding": money(purchased - paid_total),
            "last_purchase": timezone.localtime(last_purchase, tz).date().isoformat() if last_purchase else None,
            "last_payment": paid["last"].isoformat() if paid.get("last") else None,
        })
    out.sort(key=lambda r: Decimal(r["outstanding"]), reverse=True)
    return out


def supplier_detail(merchant, supplier) -> dict:
    tz = merchant_tz(merchant)
    payments = list(
        MoneyEntry.objects.filter(
            merchant=merchant, supplier=supplier, kind=MoneyEntry.KIND_SUPPLIER_PAYMENT,
        ).select_related("supplier", "salary")
    )
    paid_per_receiving = {}
    for p in payments:
        if not p.is_void and p.receiving_id:
            paid_per_receiving[p.receiving_id] = paid_per_receiving.get(p.receiving_id, ZERO) + p.amount

    purchases = []
    purchased = ZERO
    for r in InventoryReceiving.objects.filter(merchant=merchant, supplier=supplier).order_by("-received_at"):
        purchased += r.total_value
        paid = paid_per_receiving.get(r.id, ZERO)
        purchases.append({
            "id": r.id,
            "receipt_number": r.receipt_number or f"#{r.id}",
            "reference": r.reference,
            "date": timezone.localtime(r.received_at, tz).date().isoformat(),
            "amount": money(r.total_value),
            "paid": money(paid),
            "outstanding": money(r.total_value - paid),
        })
    paid_total = sum((p.amount for p in payments if not p.is_void), ZERO)
    return {
        "id": supplier.id,
        "name": supplier.name,
        "phone": supplier.phone,
        "payment_terms": supplier.payment_terms,
        "purchase_amount": money(purchased),
        "amount_paid": money(paid_total),
        "outstanding": money(purchased - paid_total),
        "purchases": purchases,
        "payments": [entry_dict(p) for p in payments],
    }


# ── Salaries ─────────────────────────────────────────────────────────────────

def salary_paid(salary) -> Decimal:
    annotated = getattr(salary, "paid_total", None)
    if annotated is not None:
        return annotated
    return salary.payments.filter(is_void=False).aggregate(v=Sum("amount"))["v"] or ZERO


def salary_dict(salary, payments=None) -> dict:
    paid = salary_paid(salary)
    outstanding = salary.amount - paid
    if paid <= 0:
        status = "unpaid"
    elif outstanding > 0:
        status = "partial"
    else:
        status = "paid"
    data = {
        "id": salary.id,
        "worker_id": str(salary.worker_id) if salary.worker_id else None,
        "worker_name": salary.worker_name,
        "period": salary.period.isoformat(),
        "period_label": salary.period.strftime("%B %Y"),
        "amount": money(salary.amount),
        "paid": money(paid),
        "outstanding": money(outstanding),
        "status": status,
        "note": salary.note,
        "created_by": salary.created_by_name,
    }
    if payments is not None:
        data["payments"] = [entry_dict(p) for p in payments]
        live = [p for p in payments if not p.is_void]
        data["last_payment_date"] = max((p.date for p in live), default=None)
        data["last_payment_date"] = data["last_payment_date"].isoformat() if data["last_payment_date"] else None
        data["last_payment_method"] = live[0].get_payment_method_display() if live else ""
    return data
