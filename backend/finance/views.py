"""
finance/views.py — the merchant Accounts API, mounted at /api/finance/.

Tenant scope: every query is filtered by the signed-in merchant.
Permissions: the owner can do everything. An employee in staff mode needs
``accounts.view`` to read and ``accounts.manage`` to record or void money
(checked here, and centrally by pos.middleware.StaffModeMiddleware).
"""

from datetime import date as date_cls, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from inventory.models import InventoryReceiving, Supplier
from pos import rbac
from pos.models import ShiftWorker

from . import services
from .models import FinanceSettings, MoneyEntry, StaffSalary

ZERO = Decimal("0")
MAX_AMOUNT = Decimal("999999999.99")


def _error(message, code="invalid", http=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({"error": message, "code": code, **extra}, status=http)


def _merchant(request):
    return getattr(request.user, "merchant_profile", None)


def _guard(request, write=False):
    """(merchant, error_response). Owner always; an employee by their role."""
    merchant = _merchant(request)
    if merchant is None:
        return None, _error("Merchant not found.", "not_found", status.HTTP_404_NOT_FOUND)
    code = "accounts.manage" if write else "accounts.view"
    if not rbac.actor_can(request, code, merchant):
        return None, _error(
            "You don't have access to this. Contact your administrator if you need access.",
            "no_access", status.HTTP_403_FORBIDDEN, required_permission=code,
        )
    return merchant, None


def _actor_name(request, merchant) -> str:
    worker = rbac.request_worker(request, merchant)
    if worker is not None:
        return worker.display_name
    return "Owner"


def _parse_date(value):
    try:
        return date_cls.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _range(request, merchant):
    """Period from ?from=&to= (YYYY-MM-DD). Defaults to the last 30 days."""
    today = services.today(merchant)
    date_to = _parse_date(request.query_params.get("to")) or today
    date_from = _parse_date(request.query_params.get("from")) or (date_to - timedelta(days=29))
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    return date_from, date_to


def _amount(value):
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if amount <= 0 or amount > MAX_AMOUNT:
        return None
    return amount


# ── Overview, books ──────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def summary(request):
    merchant, err = _guard(request)
    if err:
        return err
    date_from, date_to = _range(request, merchant)
    return Response(services.summary(merchant, date_from, date_to))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cash_book(request):
    merchant, err = _guard(request)
    if err:
        return err
    date_from, date_to = _range(request, merchant)
    return Response(services.book(merchant, "cash", date_from, date_to))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def bank_book(request):
    merchant, err = _guard(request)
    if err:
        return err
    date_from, date_to = _range(request, merchant)
    return Response(services.book(merchant, "bank", date_from, date_to))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def online_payments(request):
    merchant, err = _guard(request)
    if err:
        return err
    date_from, date_to = _range(request, merchant)
    return Response(services.online_payments(merchant, date_from, date_to))


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def finance_settings(request):
    merchant, err = _guard(request, write=request.method == "PUT")
    if err:
        return err
    settings = FinanceSettings.for_merchant(merchant)
    if request.method == "PUT":
        for field in ("opening_cash", "opening_bank"):
            if field in request.data:
                try:
                    value = Decimal(str(request.data[field] or 0)).quantize(Decimal("0.01"))
                except (InvalidOperation, TypeError, ValueError):
                    return _error("Enter a valid amount.")
                if abs(value) > MAX_AMOUNT:
                    return _error("That amount is too large.")
                setattr(settings, field, value)
        if "opening_date" in request.data:
            raw = request.data.get("opening_date")
            parsed = _parse_date(raw) if raw else None
            if raw and parsed is None:
                return _error("Enter a valid date.")
            settings.opening_date = parsed
        settings.save()
    return Response({
        "opening_cash": services.money(settings.opening_cash),
        "opening_bank": services.money(settings.opening_bank),
        "opening_date": settings.opening_date.isoformat() if settings.opening_date else None,
        "expense_categories": [{"key": k, "label": v} for k, v in MoneyEntry.EXPENSE_CATEGORIES],
        "payment_methods": [{"key": k, "label": v} for k, v in MoneyEntry.METHOD_CHOICES],
        "can_manage": rbac.actor_can(request, "accounts.manage", merchant),
    })


# ── Money entries ────────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def entries(request):
    merchant, err = _guard(request, write=request.method == "POST")
    if err:
        return err

    if request.method == "GET":
        date_from, date_to = _range(request, merchant)
        qs = MoneyEntry.objects.filter(
            merchant=merchant, date__gte=date_from, date__lte=date_to,
        ).select_related("supplier", "salary")
        kind = request.query_params.get("kind")
        if kind:
            qs = qs.filter(kind__in=[k for k in kind.split(",") if k])
        if request.query_params.get("include_void") != "1":
            qs = qs.filter(is_void=False)
        total = qs.filter(is_void=False).aggregate(v=Sum("amount"))["v"] or ZERO
        rows = [services.entry_dict(e) for e in qs[: services.ROW_LIMIT]]
        return Response({
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "total": services.money(total),
            "rows": rows,
            "truncated": qs.count() > len(rows),
        })

    return _create_entry(request, merchant)


def _create_entry(request, merchant):
    data = request.data
    kind = str(data.get("kind") or "")
    if kind not in dict(MoneyEntry.KIND_CHOICES):
        return _error("Choose what kind of record this is.", "invalid_kind")

    amount = _amount(data.get("amount"))
    if amount is None:
        return _error("Enter an amount greater than zero.", "invalid_amount")

    today = services.today(merchant)
    entry_date = _parse_date(data.get("date")) if data.get("date") else today
    if entry_date is None:
        return _error("Enter a valid date.", "invalid_date")
    if entry_date > today:
        return _error("The date cannot be in the future.", "invalid_date")

    method = str(data.get("payment_method") or MoneyEntry.METHOD_CASH)
    if kind in MoneyEntry.TRANSFER_KINDS:
        method = MoneyEntry.METHOD_CASH
    elif method not in dict(MoneyEntry.METHOD_CHOICES):
        return _error("Choose how it was paid.", "invalid_method")

    client_key = str(data.get("client_key") or "")[:64]
    if client_key:
        existing = MoneyEntry.objects.filter(merchant=merchant, client_key=client_key).first()
        if existing:
            return Response(services.entry_dict(existing))

    fields = {
        "merchant": merchant,
        "kind": kind,
        "amount": amount,
        "payment_method": method,
        "date": entry_date,
        "reference": str(data.get("reference") or "").strip()[:120],
        "note": str(data.get("note") or "").strip()[:255],
        "created_by": request.user,
        "created_by_name": _actor_name(request, merchant),
        "client_key": client_key,
    }

    try:
        with transaction.atomic():
            if kind == MoneyEntry.KIND_EXPENSE:
                category = str(data.get("category") or "other")
                if category not in dict(MoneyEntry.EXPENSE_CATEGORIES):
                    category = "other"
                fields["category"] = category

            elif kind == MoneyEntry.KIND_SUPPLIER_PAYMENT:
                supplier = Supplier.objects.filter(merchant=merchant, pk=data.get("supplier_id") or 0).first()
                if supplier is None:
                    return _error("Choose the supplier you paid.", "supplier_required")
                fields["supplier"] = supplier
                if data.get("receiving_id"):
                    receiving = InventoryReceiving.objects.filter(
                        merchant=merchant, supplier=supplier, pk=data.get("receiving_id"),
                    ).first()
                    if receiving is None:
                        return _error("That delivery is not from this supplier.", "invalid_receiving")
                    fields["receiving"] = receiving

            elif kind == MoneyEntry.KIND_SALARY_PAYMENT:
                salary = (
                    StaffSalary.objects.select_for_update()
                    .filter(merchant=merchant, pk=data.get("salary_id") or 0).first()
                )
                if salary is None:
                    return _error("Choose the salary you are paying.", "salary_required")
                owed = salary.amount - services.salary_paid(salary)
                if amount > owed:
                    return _error(
                        f"Only {services.money(owed)} is still owed for this salary.",
                        "salary_overpaid", outstanding=services.money(owed),
                    )
                fields["salary"] = salary

            entry = MoneyEntry.objects.create(**fields)
    except IntegrityError:
        existing = MoneyEntry.objects.filter(merchant=merchant, client_key=client_key).first()
        if existing is None:
            raise
        return Response(services.entry_dict(existing))

    return Response(services.entry_dict(entry), status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def void_entry(request, pk):
    merchant, err = _guard(request, write=True)
    if err:
        return err
    entry = MoneyEntry.objects.select_for_update().filter(merchant=merchant, pk=pk).first()
    if entry is None:
        return _error("Record not found.", "not_found", status.HTTP_404_NOT_FOUND)
    if entry.is_void:
        return Response(services.entry_dict(entry))
    reason = str(request.data.get("reason") or "").strip()[:255]
    if not reason:
        return _error("Say why this record is being cancelled.", "reason_required")
    entry.is_void = True
    entry.voided_at = timezone.now()
    entry.voided_by_name = _actor_name(request, merchant)
    entry.void_reason = reason
    entry.save(update_fields=["is_void", "voided_at", "voided_by_name", "void_reason"])
    return Response(services.entry_dict(entry))


# ── Suppliers ────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def suppliers(request):
    merchant, err = _guard(request)
    if err:
        return err
    rows = services.supplier_overview(merchant)
    return Response({
        "rows": rows,
        "purchase_amount": services.money(sum((Decimal(r["purchase_amount"]) for r in rows), ZERO)),
        "amount_paid": services.money(sum((Decimal(r["amount_paid"]) for r in rows), ZERO)),
        "outstanding": services.money(sum((Decimal(r["outstanding"]) for r in rows), ZERO)),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def supplier_detail(request, pk):
    merchant, err = _guard(request)
    if err:
        return err
    supplier = Supplier.objects.filter(merchant=merchant, pk=pk).first()
    if supplier is None:
        return _error("Supplier not found.", "not_found", status.HTTP_404_NOT_FOUND)
    return Response(services.supplier_detail(merchant, supplier))


# ── Salaries ─────────────────────────────────────────────────────────────────

def _salary_qs(merchant):
    return StaffSalary.objects.filter(merchant=merchant).annotate(
        paid_total=Sum("payments__amount", filter=Q(payments__is_void=False), default=ZERO),
    )


def _month(value):
    """First day of the month from 'YYYY-MM' or 'YYYY-MM-DD'."""
    text = str(value or "")
    parsed = _parse_date(text if len(text) > 7 else f"{text}-01")
    return parsed.replace(day=1) if parsed else None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def salary_staff(request):
    """Employees to pick from, with the last salary amount used for each."""
    merchant, err = _guard(request)
    if err:
        return err
    last = {}
    for s in StaffSalary.objects.filter(merchant=merchant, worker__isnull=False).order_by("period"):
        last[s.worker_id] = s.amount
    workers = ShiftWorker.objects.filter(merchant=merchant, is_deleted=False).order_by("display_name")
    return Response([
        {
            "id": str(w.id),
            "name": w.display_name,
            "is_active": w.is_active,
            "last_salary": services.money(last[w.id]) if w.id in last else None,
        }
        for w in workers
    ])


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def salaries(request):
    merchant, err = _guard(request, write=request.method == "POST")
    if err:
        return err

    if request.method == "GET":
        qs = _salary_qs(merchant)
        if request.query_params.get("worker_id"):
            qs = qs.filter(worker_id=request.query_params["worker_id"])
        month = _month(request.query_params.get("month")) if request.query_params.get("month") else None
        if month:
            qs = qs.filter(period=month)
        rows = []
        for salary in qs.prefetch_related("payments")[: services.ROW_LIMIT]:
            payments = sorted(salary.payments.all(), key=lambda p: (p.date, p.id), reverse=True)
            rows.append(services.salary_dict(salary, payments))
        return Response({
            "rows": rows,
            "amount": services.money(sum((Decimal(r["amount"]) for r in rows), ZERO)),
            "paid": services.money(sum((Decimal(r["paid"]) for r in rows), ZERO)),
            "outstanding": services.money(sum((Decimal(r["outstanding"]) for r in rows), ZERO)),
        })

    data = request.data
    worker = ShiftWorker.objects.filter(
        merchant=merchant, is_deleted=False, pk=data.get("worker_id") or None,
    ).first() if data.get("worker_id") else None
    if worker is None:
        return _error("Choose the employee.", "worker_required")
    period = _month(data.get("period"))
    if period is None:
        return _error("Choose the month.", "invalid_period")
    amount = _amount(data.get("amount"))
    if amount is None:
        return _error("Enter the salary amount.", "invalid_amount")
    if StaffSalary.objects.filter(merchant=merchant, worker=worker, period=period).exists():
        return _error(
            f"{worker.display_name} already has a salary for {period:%B %Y}.",
            "duplicate_salary", status.HTTP_409_CONFLICT,
        )
    salary = StaffSalary.objects.create(
        merchant=merchant,
        worker=worker,
        worker_name=worker.display_name,
        period=period,
        amount=amount,
        note=str(data.get("note") or "").strip()[:255],
        created_by=request.user,
        created_by_name=_actor_name(request, merchant),
    )
    return Response(services.salary_dict(salary, []), status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def salary_detail(request, pk):
    merchant, err = _guard(request, write=True)
    if err:
        return err
    salary = StaffSalary.objects.select_for_update().filter(merchant=merchant, pk=pk).first()
    if salary is None:
        return _error("Salary not found.", "not_found", status.HTTP_404_NOT_FOUND)
    paid = services.salary_paid(salary)

    if request.method == "DELETE":
        if salary.payments.exists():
            return _error(
                "This salary has payments recorded, so it is kept for the history.",
                "has_payments", status.HTTP_409_CONFLICT,
            )
        salary.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if "amount" in request.data:
        amount = _amount(request.data.get("amount"))
        if amount is None:
            return _error("Enter the salary amount.", "invalid_amount")
        if amount < paid:
            return _error(
                f"{services.money(paid)} has already been paid for this salary.", "below_paid",
            )
        salary.amount = amount
    if "note" in request.data:
        salary.note = str(request.data.get("note") or "").strip()[:255]
    salary.save()
    payments = sorted(salary.payments.all(), key=lambda p: (p.date, p.id), reverse=True)
    return Response(services.salary_dict(salary, payments))
