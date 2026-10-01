"""
inventory/views.py

Mounted at /api/inventory/ — merchant-dashboard API.

Convention follows the rest of the backend: function-based @api_view views.
Every view is wrapped in ``inventory_perm`` which resolves the acting
identity (owner, or a POS worker in staff mode), enforces the capability for
the HTTP method server-side and scopes everything to the acting merchant.
The UI hides what a role cannot do, but these checks are authoritative.
"""

from decimal import Decimal, InvalidOperation
from functools import wraps

from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import reports as report_builders
from . import services
from .models import (
    AdjustmentStatus,
    AnItemType,
    CountStatus,
    InventoryAdjustment,
    InventoryAuditLog,
    InventoryBalance,
    InventoryCategory,
    InventoryCountSchedule,
    InventoryItem,
    InventoryLocation,
    InventoryMovement,
    InventoryReceiving,
    InventorySettings,
    InventoryTransfer,
    InventoryWasteRecord,
    MenuItemStockLink,
    PurchaseOrder,
    StockCount,
    Supplier,
    SupplierItem,
    UnitOfMeasure,
)
from .permissions import (
    InvPerm,
    issue_staff_token,
    resolve_access,
)
from .serializers import (
    AdjustmentSerializer,
    AuditLogSerializer,
    CategorySerializer,
    CountCreateSerializer,
    CountLineSerializer,
    CountUpsertSerializer,
    InventoryItemCreateSerializer,
    InventoryItemSerializer,
    InventorySettingsSerializer,
    LocationSerializer,
    MovementSerializer,
    OverviewSerializer,
    POCreateSerializer,
    POReceiveSerializer,
    PurchaseOrderSerializer,
    ReceivingCreateSerializer,
    ReceivingSerializer,
    ScheduleSerializer,
    StockCountSerializer,
    StockCountSummarySerializer,
    SupplierSerializer,
    TransferCreateSerializer,
    TransferSerializer,
    UnitSerializer,
    WasteRecordSerializer,
)
from .services import (
    InventoryMovementService,
    PurchaseOrderService,
    StockCountService,
    StockRemainingError,
    actor_context,
    seed_merchant_reference_data,
    with_stock_totals,
    items_stored_at,
)

NOT_ALLOWED = "You don't have permission to do this. Ask a manager."


# ─────────────────────────────────────────────────────────────────────────────
# Access helpers
# ─────────────────────────────────────────────────────────────────────────────


def inventory_perm(default=None, **by_method):
    """Enforce an inventory capability for this view, per HTTP method.

    ``default`` applies to methods without an explicit entry. A value may be
    a single permission or a tuple meaning "any of these".
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(request, *args, **kwargs):
            access = resolve_access(request)
            if not access.ok:
                return Response(
                    {"detail": access.error or NOT_ALLOWED, "code": "not_permitted"}, status=403
                )
            perm = by_method.get(request.method, default)
            if perm:
                needed = perm if isinstance(perm, tuple) else (perm,)
                if not any(access.can(p) for p in needed):
                    return Response({"detail": NOT_ALLOWED, "code": "not_permitted"}, status=403)
            request.inventory = access
            with actor_context(access.actor_label):
                return fn(request, *args, **kwargs)

        return wrapper

    return decorator


def _merchant(request):
    return request.inventory.merchant


def _can(request, perm):
    return request.inventory.can(perm)


def _ctx(request, **extra):
    """Serializer context: tenant, actor and cost visibility."""
    return {
        "merchant": _merchant(request),
        "user": request.user,
        "include_cost": _can(request, InvPerm.VIEW_COST),
        **extra,
    }


def _int(value):
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _decimal(value):
    if value in (None, ""):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError("must be a number")
    if not result.is_finite():
        raise ValueError("must be a number")
    return result


def _bad(message, status=400, **extra):
    return Response({"detail": message, **extra}, status=status)


def _pagination(request, default_size=50, max_size=200):
    try:
        size = int(request.query_params.get("page_size") or request.query_params.get("per_page") or default_size)
    except ValueError:
        size = default_size
    size = min(max(size, 1), max_size)
    try:
        page = max(int(request.query_params.get("page", 1)), 1)
    except ValueError:
        page = 1
    return page, size


def _page_meta(page, size, total):
    total_pages = max(1, -(-total // size))
    return {
        "count": total,
        "total_count": total,
        "page": page,
        "page_size": size,
        "total_pages": total_pages,
        "next": page + 1 if page < total_pages else None,
        "previous": page - 1 if page > 1 else None,
    }


def _paged(request, qs, default_size=50):
    page, size = _pagination(request, default_size)
    total = qs.count()
    offset = (page - 1) * size
    return list(qs[offset: offset + size]), _page_meta(page, size, total)


def _paged_response(request, qs, serializer_cls, extra=None, context=None, default_size=50):
    items, meta = _paged(request, qs, default_size)
    data = {"results": serializer_cls(items, many=True, context=context or _ctx(request)).data, **meta}
    if extra:
        data.update(extra)
    return Response(data)


def _audit(request, action, entity_type, entity_id="", **metadata):
    access = request.inventory
    if access.worker is not None:
        metadata.setdefault("staff", access.worker.display_name)
    InventoryAuditLog.objects.create(
        merchant=access.merchant,
        user=request.user if request.user.is_authenticated else None,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        metadata=metadata,
    )


def _stock_error(exc):
    """Turn a service ValueError into a plain-language 400."""
    return _bad(str(exc) or "That stock change could not be saved. Your stock has not changed.")


# ─────────────────────────────────────────────────────────────────────────────
# Root, staff mode, overview
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW)
def inventory_root_view(request):
    """GET /api/inventory/ — who is acting, what they may do, onboarding info."""
    merchant = _merchant(request)
    access = request.inventory
    seed_merchant_reference_data(merchant)
    item_count = InventoryItem.objects.filter(merchant=merchant, archived=False).count()
    settings_obj = InventorySettings.for_merchant(merchant)
    staff_available = False
    if access.worker is None:
        from pos.models import ShiftWorker

        staff_available = ShiftWorker.objects.filter(merchant=merchant, is_active=True).exists()
    return Response({
        "is_configured": item_count > 0,
        "item_count": item_count,
        "role": access.role,
        "staff": (
            {"id": str(access.worker.id), "name": access.worker.display_name, "role": access.worker.role}
            if access.worker is not None else None
        ),
        "staff_mode_available": staff_available,
        "business_name": merchant.business_name,
        "permissions": {p: access.can(p) for p in InvPerm.ALL},
        "count_approval_required": settings_obj.require_count_approval,
        "adjustment_approval_required": settings_obj.require_adjustment_approval,
        "prevent_negative_stock": settings_obj.prevent_negative_stock,
    })


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW)
def staff_workers_view(request):
    """GET /api/inventory/staff/workers/ — workers who can use staff mode.

    In staff mode only managers/admins are listed (for "exit with a
    manager PIN"); the full list is for the owner.
    """
    from pos.models import ShiftWorker

    workers = ShiftWorker.objects.filter(merchant=_merchant(request), is_active=True).order_by("display_name")
    if request.inventory.worker is not None:
        workers = workers.filter(role__in=[ShiftWorker.ROLE_MANAGER, ShiftWorker.ROLE_ADMIN])
    return Response([
        {
            "id": str(w.id),
            "name": w.display_name,
            "role": w.role,
            "inventory_role": w.staff_role.name if w.staff_role_id else w.role,
        }
        for w in workers.select_related("staff_role")
    ])


@api_view(["POST"])
@inventory_perm(InvPerm.VIEW)
def staff_session_start_view(request):
    """POST /api/inventory/staff/session/ {worker_id, pin} → signed staff token.

    Only the owner session can hand the device to a staff member.
    """
    if request.inventory.worker is not None:
        return _bad("Leave staff mode first.", status=403)
    from pos.models import ShiftWorker

    worker = ShiftWorker.objects.filter(
        merchant=_merchant(request), id=request.data.get("worker_id"), is_active=True
    ).first() if request.data.get("worker_id") else None
    if worker is None:
        return _bad("Choose who is using this device.", status=404)
    if not worker.verify_pin(str(request.data.get("pin") or "")):
        if worker.locked_until and worker.locked_until > timezone.now():
            return _bad("Too many wrong PINs. Try again in 15 minutes.", status=429)
        return _bad("That PIN is not right. Please try again.", status=401)
    from pos import rbac

    role = rbac.worker_role(worker)
    granted = InvPerm.for_role_permissions(rbac.role_permissions(role), is_admin=role.is_admin)
    _audit(request, "settings_updated", "staff_session", worker.id, event="staff_mode_started",
           worker=worker.display_name)
    return Response({
        "token": issue_staff_token(worker),
        "staff": {"id": str(worker.id), "name": worker.display_name, "role": worker.role},
        "role": role.system_key or "custom",
        "permissions": {p: p in granted for p in InvPerm.ALL},
    })


@api_view(["POST"])
def staff_session_end_view(request):
    """POST /api/inventory/staff/session/end/ — leave staff mode.

    Needs the owner's password, or the PIN of a manager/admin worker, so a
    staff member cannot simply switch back to the owner's full access.
    """
    access = resolve_access(request)
    if access.merchant is None:
        return _bad(access.error or NOT_ALLOWED, status=403)
    password = request.data.get("password")
    if password:
        if request.user.check_password(str(password)):
            return Response({"ok": True})
        return _bad("That password is not right.", status=401)
    from pos.models import ShiftWorker

    worker_id, pin = request.data.get("worker_id"), request.data.get("pin")
    if worker_id and pin:
        worker = ShiftWorker.objects.filter(
            merchant=access.merchant, id=worker_id, is_active=True,
            role__in=[ShiftWorker.ROLE_MANAGER, ShiftWorker.ROLE_ADMIN],
        ).first()
        if worker and worker.verify_pin(str(pin)):
            return Response({"ok": True})
        return _bad("A manager or admin PIN is needed.", status=401)
    return _bad("Enter the owner password or a manager PIN.")


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW)
def overview(request):
    merchant = _merchant(request)
    seed_merchant_reference_data(merchant)
    return Response(OverviewSerializer.build(merchant, include_cost=_can(request, InvPerm.VIEW_COST)))


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.VIEW, POST=InvPerm.MANAGE_ITEMS)
def categories_view(request):
    merchant = _merchant(request)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        qs = InventoryCategory.objects.filter(merchant=merchant).annotate(
            n_items=Count("inventory_items", filter=Q(inventory_items__archived=False))
        ).order_by("display_order", "name")
        return Response(CategorySerializer(qs, many=True).data)
    name = (request.data.get("name") or "").strip()[:100]
    if not name:
        return _bad("Name is required.")
    cat, created = InventoryCategory.objects.get_or_create(
        merchant=merchant, name=name,
        defaults={"display_order": InventoryCategory.objects.filter(merchant=merchant).count()},
    )
    if not created and not cat.is_active:
        cat.is_active = True
        cat.save(update_fields=["is_active", "updated_at"])
    return Response(CategorySerializer(cat).data, status=201 if created else 200)


@api_view(["PATCH", "DELETE"])
@inventory_perm(InvPerm.MANAGE_ITEMS)
def category_detail_view(request, pk):
    merchant = _merchant(request)
    cat = InventoryCategory.objects.filter(merchant=merchant, id=pk).first()
    if not cat:
        return _bad("Not found.", status=404)
    if request.method == "DELETE":
        if cat.inventory_items.exists():
            cat.is_active = False
            cat.save(update_fields=["is_active", "updated_at"])
            return Response({"ok": True, "result": "hidden"})
        cat.delete()
        return Response({"ok": True, "result": "deleted"})
    name = (request.data.get("name") or "").strip()[:100]
    if name:
        if InventoryCategory.objects.filter(merchant=merchant, name=name).exclude(id=cat.id).exists():
            return _bad("Another category already has that name.")
        cat.name = name
    if "display_order" in request.data:
        order = _int(request.data["display_order"])
        if order is None or order < 0:
            return _bad("display_order must be a whole number.")
        cat.display_order = order
    if "is_active" in request.data:
        cat.is_active = bool(request.data["is_active"])
    cat.save()
    return Response(CategorySerializer(cat).data)


@api_view(["POST"])
@inventory_perm(InvPerm.MANAGE_ITEMS)
def category_reorder_view(request):
    merchant = _merchant(request)
    order = request.data.get("order", [])
    if not isinstance(order, list):
        return _bad("order must be a list.")
    for idx, cat_id in enumerate(order):
        InventoryCategory.objects.filter(merchant=merchant, id=_int(cat_id)).update(display_order=idx)
    return Response({"ok": True})


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.VIEW, POST=InvPerm.MANAGE_ITEMS)
def locations_view(request):
    merchant = _merchant(request)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        qs = InventoryLocation.objects.filter(merchant=merchant).order_by("display_order", "name")
        return Response(LocationSerializer(qs, many=True).data)
    name = (request.data.get("name") or "").strip()[:120]
    if not name:
        return _bad("Name is required.")
    loc, created = InventoryLocation.objects.get_or_create(
        merchant=merchant, name=name,
        defaults={"display_order": InventoryLocation.objects.filter(merchant=merchant).count()},
    )
    if not created and not loc.is_active:
        loc.is_active = True
        loc.save(update_fields=["is_active", "updated_at"])
    return Response(LocationSerializer(loc).data, status=201 if created else 200)


@api_view(["PATCH", "DELETE"])
@inventory_perm(InvPerm.MANAGE_ITEMS)
def location_detail_view(request, pk):
    merchant = _merchant(request)
    loc = InventoryLocation.objects.filter(merchant=merchant, id=pk).first()
    if not loc:
        return _bad("Not found.", status=404)
    if request.method == "DELETE":
        if InventoryBalance.objects.filter(location=loc, on_hand__gt=0).exists():
            return _bad("This place still has stock. Move the stock out first.")
        used = (
            InventoryMovement.objects.filter(location=loc).exists()
            or InventoryItem.objects.filter(default_location=loc).exists()
            or InventoryBalance.objects.filter(location=loc).exists()
        )
        if used:
            loc.is_active = False
            loc.save(update_fields=["is_active", "updated_at"])
            return Response({"ok": True, "result": "hidden"})
        loc.delete()
        return Response({"ok": True, "result": "deleted"})
    name = (request.data.get("name") or "").strip()[:120]
    if name:
        if InventoryLocation.objects.filter(merchant=merchant, name=name).exclude(id=loc.id).exists():
            return _bad("Another place already has that name.")
        loc.name = name
    if "display_order" in request.data:
        order = _int(request.data["display_order"])
        if order is None or order < 0:
            return _bad("display_order must be a whole number.")
        loc.display_order = order
    if "is_active" in request.data:
        loc.is_active = bool(request.data["is_active"])
    loc.save()
    return Response(LocationSerializer(loc).data)


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW)
def units_view(request):
    merchant = _merchant(request)
    seed_merchant_reference_data(merchant)
    qs = UnitOfMeasure.objects.filter(Q(merchant__isnull=True) | Q(merchant=merchant), is_active=True)
    return Response(UnitSerializer(qs, many=True).data)


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.VIEW, POST=InvPerm.MANAGE_SETTINGS)
def schedules_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = InventoryCountSchedule.objects.filter(merchant=merchant).order_by("name")
        return Response(ScheduleSerializer(qs, many=True).data)
    data = request.data
    days = _int(data.get("frequency_days"))
    if data.get("frequency_type") == "EVERY_N_DAYS" and not days:
        return _bad("frequency_days required for EVERY_N_DAYS.")
    refs = {}
    for key, model in (("item", InventoryItem), ("category", InventoryCategory), ("location", InventoryLocation)):
        if data.get(key) not in (None, ""):
            obj = model.objects.filter(merchant=merchant, id=_int(data.get(key))).first()
            if obj is None:
                return _bad(f"Unknown {key}.")
            refs[key] = obj
    schedule = InventoryCountSchedule.objects.create(
        merchant=merchant,
        name=(data.get("name") or "Count schedule")[:120],
        scope_type=data.get("scope_type", "ITEM"),
        item=refs.get("item"),
        category=refs.get("category"),
        location=refs.get("location"),
        frequency_type=data.get("frequency_type", "EVERY_N_DAYS"),
        frequency_days=days or None,
        next_due_at=data.get("next_due_at") or timezone.now().date(),
        enabled=bool(data.get("enabled", True)),
    )
    _apply_schedule_to_items(merchant, schedule)
    return Response(ScheduleSerializer(schedule).data, status=201)


def _apply_schedule_to_items(merchant, schedule):
    qs = InventoryItem.objects.filter(merchant=merchant, archived=False)
    if schedule.scope_type == "ITEM" and schedule.item_id:
        qs = qs.filter(id=schedule.item_id)
    elif schedule.scope_type == "CATEGORY" and schedule.category_id:
        qs = qs.filter(category_id=schedule.category_id)
    elif schedule.scope_type == "LOCATION" and schedule.location_id:
        qs = qs.filter(default_location_id=schedule.location_id)
    for item in qs:
        if item.next_count_due is None or (schedule.next_due_at and schedule.next_due_at < item.next_count_due):
            item.next_count_due = schedule.next_due_at or timezone.now().date()
            item.count_schedule = schedule
            item.save(update_fields=["next_count_due", "count_schedule", "updated_at"])


@api_view(["PATCH", "DELETE"])
@inventory_perm(InvPerm.MANAGE_SETTINGS)
def schedule_detail_view(request, pk):
    merchant = _merchant(request)
    schedule = InventoryCountSchedule.objects.filter(merchant=merchant, id=pk).first()
    if not schedule:
        return _bad("Not found.", status=404)
    if request.method == "DELETE":
        schedule.enabled = False
        schedule.save(update_fields=["enabled", "updated_at"])
        return Response({"ok": True})
    for field in ("name", "frequency_type", "frequency_days", "next_due_at", "enabled"):
        if field in request.data:
            setattr(schedule, field, request.data[field])
    schedule.save()
    return Response(ScheduleSerializer(schedule).data)


# ─────────────────────────────────────────────────────────────────────────────
# Items & balances
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.VIEW, POST=InvPerm.MANAGE_ITEMS)
def items_view(request):
    merchant = _merchant(request)
    seed_merchant_reference_data(merchant)
    if request.method == "GET":
        return _item_list(request, merchant)
    return _item_create(request, merchant)


def _parse_menu_links(merchant, raw):
    """Validate a `menu_links` payload: [{"menu_item": id, "quantity_per_unit": "1"}]."""
    from merchants.models import MenuItem

    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("menu_links must be a list.")
    quantities = {}
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError("Each menu link needs a menu_item.")
        try:
            menu_item_id = int(row.get("menu_item"))
        except (TypeError, ValueError):
            raise ValueError("Each menu link needs a menu_item.")
        try:
            qty = Decimal(str(row.get("quantity_per_unit", 1)))
        except (InvalidOperation, ValueError):
            raise ValueError("Quantity used per sale must be a number.")
        if not qty.is_finite() or qty <= 0:
            raise ValueError("Quantity used per sale must be greater than zero.")
        quantities[menu_item_id] = qty.quantize(Decimal("0.000001"))
    menu_items = {m.id: m for m in MenuItem.objects.filter(merchant=merchant, id__in=quantities)}
    if len(menu_items) != len(quantities):
        raise ValueError("Unknown menu item.")
    return [(menu_items[mid], qty) for mid, qty in quantities.items()]


def _replace_menu_links(merchant, item, parsed):
    keep = []
    for menu_item, qty in parsed:
        link, _ = MenuItemStockLink.objects.update_or_create(
            menu_item=menu_item,
            inventory_item=item,
            defaults={"merchant": merchant, "quantity_per_unit": qty},
        )
        keep.append(link.id)
    MenuItemStockLink.objects.filter(inventory_item=item).exclude(id__in=keep).delete()


def _balances_prefetch(merchant):
    return Prefetch(
        "balances",
        queryset=InventoryBalance.objects.filter(merchant=merchant).select_related("location"),
    )


def _attach_balances(items):
    for item in items:
        item._balance_map = {b.location_id: b for b in item.balances.all()}
    return items


def _item_list(request, merchant):
    """Paginated in the database: only the requested page is loaded.

    Search (name, SKU, barcode, category) and filters (status, type,
    category, location, supplier) are applied before paging, so totals and
    pages stay correct for merchants with thousands of items.
    """
    params = request.query_params
    base = report_builders.filtered_items(merchant, {**params.dict(), "status": ""})
    status = params.get("status")
    qs = base
    if status:
        qs = qs.filter(stock_state__in=[s.strip().upper() for s in status.split(",") if s.strip()])

    sort = params.get("sort", "name")
    if sort == "attention":
        from django.db.models import Case, IntegerField, Value, When

        qs = qs.annotate(_urgency=Case(
            When(stock_state="OUT", then=Value(0)),
            When(stock_state="CRITICAL", then=Value(1)),
            When(stock_state="LOW", then=Value(2)),
            default=Value(3),
            output_field=IntegerField(),
        )).order_by("_urgency", "name", "id")
    elif sort == "-updated":
        qs = qs.order_by("-updated_at", "-id")
    else:
        qs = qs.order_by("name", "id")

    qs = qs.select_related(
        "category", "default_location", "primary_supplier", "base_unit",
        "preferred_display_unit", "count_schedule",
    )
    if params.get("include_balance", "1") != "0":
        qs = qs.prefetch_related(_balances_prefetch(merchant), "menu_links__menu_item")
    else:
        qs = qs.prefetch_related("menu_links__menu_item")

    page, size = _pagination(request, default_size=25)
    total = qs.count()
    offset = (page - 1) * size
    items = list(qs[offset: offset + size])
    if params.get("include_balance", "1") != "0":
        _attach_balances(items)

    data = {
        "results": InventoryItemSerializer(
            items, many=True, context=_ctx(request, location_id=_int(params.get("location")))
        ).data,
        **_page_meta(page, size, total),
    }
    if params.get("with_counts") == "1":
        states = {r["stock_state"]: r["n"] for r in base.order_by().values("stock_state").annotate(n=Count("id"))}
        data["status_counts"] = {
            "ALL": sum(states.values()),
            **{k: states.get(k, 0) for k in ("HEALTHY", "LOW", "CRITICAL", "OUT", "OVERSTOCK")},
        }
    return Response(data)


def _item_payload(request, item):
    merchant = _merchant(request)
    item = with_stock_totals(InventoryItem.objects.filter(pk=item.pk), merchant).select_related(
        "category", "default_location", "primary_supplier", "base_unit",
        "preferred_display_unit", "count_schedule",
    ).prefetch_related(_balances_prefetch(merchant), "menu_links__menu_item").first()
    _attach_balances([item])
    return InventoryItemSerializer(item, context=_ctx(request)).data


def _item_create(request, merchant):
    name = (request.data.get("name") or "").strip()
    if name and not request.data.get("allow_duplicate_name"):
        existing = InventoryItem.objects.filter(merchant=merchant, archived=False, name__iexact=name).first()
        if existing:
            return _bad(
                f"A stock item called “{existing.name}” already exists.",
                status=409, code="duplicate_name", duplicate_of=existing.id,
            )
    serializer = InventoryItemCreateSerializer(data=request.data, context=_ctx(request))
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        menu_links = _parse_menu_links(merchant, request.data.get("menu_links"))
    except ValueError as exc:
        return _bad(str(exc))
    if serializer.validated_data.get("opening_quantity") and not _can(request, InvPerm.RECEIVE) \
            and not _can(request, InvPerm.ADJUST):
        return _bad("Only a manager can add starting stock.", status=403)
    try:
        item = serializer.save()
    except ValueError as exc:
        return _stock_error(exc)
    _replace_menu_links(merchant, item, menu_links)
    _audit(request, InventoryAuditLog.ACTION_ITEM_CREATED, "item", item.id, name=item.name)
    return Response(_item_payload(request, item), status=201)


ITEM_TEXT_FIELDS = {"name": 255, "description": 5000, "sku": 120, "barcode": 120, "purchase_unit_label": 80}
ITEM_DECIMAL_FIELDS = ("purchase_unit_conversion", "par_level", "reorder_point", "critical_level")


def _item_update(request, item):
    """PATCH a stock item's details. Never changes the quantity in stock."""
    merchant = _merchant(request)
    data = request.data
    menu_links = None
    if "menu_links" in data:
        try:
            menu_links = _parse_menu_links(merchant, data["menu_links"])
        except ValueError as exc:
            return _bad(str(exc))

    for field, limit in ITEM_TEXT_FIELDS.items():
        if field in data:
            value = str(data[field] or "").strip()[:limit]
            if field == "name" and not value:
                return _bad("Give the item a name.")
            setattr(item, field, value)
    if "name" in data:
        clash = InventoryItem.objects.filter(
            merchant=merchant, archived=False, name__iexact=item.name
        ).exclude(id=item.id).first()
        if clash and not data.get("allow_duplicate_name"):
            return _bad(f"A stock item called “{clash.name}” already exists.", status=409,
                        code="duplicate_name", duplicate_of=clash.id)
    if "item_type" in data:
        if data["item_type"] not in AnItemType.values:
            return _bad("Choose what kind of item it is.")
        item.item_type = data["item_type"]
    if "active" in data:
        item.active = bool(data["active"])
    for field in ITEM_DECIMAL_FIELDS:
        if field in data:
            try:
                value = _decimal(data[field])
            except ValueError:
                return _bad(f"{field.replace('_', ' ').capitalize()} must be a number.")
            if value is not None and value < 0:
                return _bad("Numbers cannot be negative.")
            if field == "purchase_unit_conversion" and value == 0:
                return _bad("Pack size must be more than 0.")
            setattr(item, field, value)
    if "category" in data:
        cat = InventoryCategory.objects.filter(merchant=merchant, id=_int(data["category"])).first()
        if not cat:
            return _bad("Unknown category.")
        item.category = cat
    if "default_location" in data:
        if data["default_location"] in (None, ""):
            item.default_location = None
        else:
            loc = InventoryLocation.objects.filter(merchant=merchant, id=_int(data["default_location"])).first()
            if not loc:
                return _bad("Unknown location.")
            item.default_location = loc
    if "primary_supplier" in data:
        if data["primary_supplier"] in (None, ""):
            item.primary_supplier = None
        else:
            sup = Supplier.objects.filter(merchant=merchant, id=_int(data["primary_supplier"])).first()
            if not sup:
                return _bad("Unknown supplier.")
            item.primary_supplier = sup
    units = UnitOfMeasure.objects.filter(Q(merchant__isnull=True) | Q(merchant=merchant))
    if "base_unit" in data and _int(data["base_unit"]) != item.base_unit_id:
        unit = units.filter(id=_int(data["base_unit"])).first()
        if not unit:
            return _bad("Unknown unit.")
        if InventoryMovement.objects.filter(merchant=merchant, inventory_item=item).exists():
            return _bad("The counting unit cannot change after stock has been recorded. "
                        "Create a new item instead.")
        item.base_unit = unit
    if "preferred_display_unit" in data:
        if data["preferred_display_unit"] in (None, ""):
            item.preferred_display_unit = None
        else:
            unit = units.filter(id=_int(data["preferred_display_unit"])).first()
            if not unit or unit.kind != item.base_unit.kind:
                return _bad("Choose a display unit of the same kind as how you count it.")
            item.preferred_display_unit = unit

    for code_field in ("sku", "barcode"):
        value = getattr(item, code_field)
        if value:
            lookup = {f"{code_field}__iexact" if code_field == "sku" else code_field: value}
            if InventoryItem.objects.filter(merchant=merchant, archived=False, **lookup).exclude(id=item.id).exists():
                return _bad(f"Another stock item already uses this {code_field.upper()}.")

    item.save()
    if menu_links is not None:
        _replace_menu_links(merchant, item, menu_links)
    _audit(request, InventoryAuditLog.ACTION_ITEM_UPDATED, "item", item.id,
           fields=sorted(k for k in data.keys() if k != "menu_links"))
    return Response(_item_payload(request, item))


@api_view(["GET", "PATCH", "DELETE"])
@inventory_perm(InvPerm.VIEW, PATCH=InvPerm.MANAGE_ITEMS, DELETE=InvPerm.MANAGE_ITEMS)
def item_detail_view(request, pk):
    merchant = _merchant(request)
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).first()
    if not item:
        return _bad("Not found.", status=404)
    if request.method == "PATCH":
        return _item_update(request, item)
    if request.method == "DELETE":
        clear_stock = str(request.data.get("clear_stock") or request.query_params.get("clear_stock") or "") \
            .lower() in ("1", "true", "yes")
        if clear_stock and not _can(request, InvPerm.ADJUST):
            return _bad("Only a manager can remove stock that is still there.", status=403)
        try:
            result = services.remove_item(
                merchant=merchant, item=item, performed_by=request.user, clear_stock=clear_stock
            )
        except StockRemainingError as exc:
            return _bad(
                f"{item.name} still has {exc.quantity.normalize():f} {exc.unit} in stock.",
                status=409, code="stock_remaining", quantity=str(exc.quantity), unit=exc.unit,
            )
        except ValueError as exc:
            return _stock_error(exc)
        return Response({"ok": True, "result": result})
    return Response(_item_payload(request, item))


@api_view(["POST"])
@inventory_perm(InvPerm.MANAGE_ITEMS)
def archive_item_view(request, pk):
    merchant = _merchant(request)
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).first()
    if not item:
        return _bad("Not found.", status=404)
    item.archived = True
    item.active = False
    item.save(update_fields=["archived", "active", "updated_at"])
    _audit(request, InventoryAuditLog.ACTION_ITEM_ARCHIVED, "item", item.id, name=item.name)
    return Response({"ok": True})


def _movement_context(request, movements):
    ids = [m.id for m in movements]
    reversed_ids = set(
        InventoryMovement.objects.filter(merchant=_merchant(request), reversal_of_id__in=ids)
        .values_list("reversal_of_id", flat=True)
    )
    return _ctx(request, reversed_ids=reversed_ids)


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW_REPORTS)
def item_movements_view(request, pk):
    merchant = _merchant(request)
    item = InventoryItem.objects.filter(merchant=merchant, id=pk).first()
    if not item:
        return _bad("Not found.", status=404)
    qs = report_builders.movements_queryset(merchant, {**request.query_params.dict(), "item": item.id})
    movements, meta = _paged(request, qs, default_size=25)
    return Response({
        "results": MovementSerializer(movements, many=True, context=_movement_context(request, movements)).data,
        **meta,
    })


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW_REPORTS)
def movements_view(request):
    merchant = _merchant(request)
    qs = report_builders.movements_queryset(merchant, request.query_params.dict())
    movements, meta = _paged(request, qs, default_size=30)
    return Response({
        "results": MovementSerializer(movements, many=True, context=_movement_context(request, movements)).data,
        **meta,
    })


@api_view(["POST"])
@inventory_perm(InvPerm.ADJUST)
def reversal_view(request, pk):
    merchant = _merchant(request)
    movement = InventoryMovement.objects.filter(merchant=merchant, id=pk).first()
    if not movement:
        return _bad("Not found.", status=404)
    try:
        reversal = InventoryMovementService.reverse(
            merchant=merchant, movement=movement, performed_by=request.user,
            reason="Undo",
        )
    except ValueError as exc:
        return _stock_error(exc)
    return Response(MovementSerializer(reversal, context=_ctx(request)).data)


# ─────────────────────────────────────────────────────────────────────────────
# Waste / Adjustments
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.VIEW_REPORTS, POST=InvPerm.RECORD_WASTE)
def waste_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = report_builders.waste_queryset(merchant, request.query_params.dict())
        from django.db.models import Sum

        return _paged_response(request, qs, WasteRecordSerializer, extra={
            "waste_total": qs.aggregate(t=Sum("quantity"))["t"] or 0,
        })
    serializer = WasteRecordSerializer(
        data=request.data,
        context=_ctx(request, idempotency_key=request.data.get("idempotency_key")),
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        record = serializer.save()
    except (ValueError, PermissionError) as exc:
        return _stock_error(exc)
    data = WasteRecordSerializer(record, context=_ctx(request)).data
    balance = InventoryBalance.objects.filter(
        merchant=merchant, inventory_item=record.inventory_item, location=record.location
    ).first()
    data["new_stock"] = str(balance.on_hand) if balance else "0"
    return Response(data, status=201)


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.ADJUST)
def adjustments_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = InventoryAdjustment.objects.filter(merchant=merchant).select_related(
            "inventory_item__base_unit", "location", "performed_by", "approved_by"
        )
        status = request.query_params.get("status")
        if status:
            qs = qs.filter(status=status.upper())
        return _paged_response(request, qs.order_by("-created_at"), AdjustmentSerializer)
    settings_obj = InventorySettings.for_merchant(merchant)
    requires_approval = settings_obj.require_adjustment_approval and not _can(
        request, InvPerm.APPROVE_ADJUSTMENT
    )
    serializer = AdjustmentSerializer(
        data=request.data,
        context=_ctx(
            request,
            idempotency_key=request.data.get("idempotency_key"),
            requires_approval=requires_approval,
        ),
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        adjustment = serializer.save()
    except (ValueError, PermissionError) as exc:
        return _stock_error(exc)
    data = AdjustmentSerializer(adjustment).data
    balance = InventoryBalance.objects.filter(
        merchant=merchant, inventory_item=adjustment.inventory_item, location=adjustment.location
    ).first()
    data["new_stock"] = str(balance.on_hand) if balance else "0"
    return Response(data, status=201)


@api_view(["POST"])
@inventory_perm(InvPerm.APPROVE_ADJUSTMENT)
def adjustment_decision_view(request, pk, decision):
    merchant = _merchant(request)
    adjustment = InventoryAdjustment.objects.filter(merchant=merchant, id=pk).first()
    if not adjustment:
        return _bad("Not found.", status=404)
    try:
        if decision == "approve":
            adjustment = InventoryMovementService.approve_adjustment(
                merchant=merchant, adjustment=adjustment, approved_by=request.user
            )
        else:
            adjustment = InventoryMovementService.reject_adjustment(
                merchant=merchant, adjustment=adjustment, rejected_by=request.user
            )
    except ValueError as exc:
        return _stock_error(exc)
    return Response(AdjustmentSerializer(adjustment).data)


# ─────────────────────────────────────────────────────────────────────────────
# Receiving
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.RECEIVE)
def receiving_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = InventoryReceiving.objects.filter(merchant=merchant).select_related(
            "supplier", "location", "received_by"
        ).prefetch_related("lines__inventory_item__base_unit")
        return _paged_response(request, qs, ReceivingSerializer)
    serializer = ReceivingCreateSerializer(
        data=request.data,
        context=_ctx(request, idempotency_key=request.data.get("idempotency_key")),
    )
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        rec = serializer.save()
    except (ValueError, PermissionError) as exc:
        return _stock_error(exc)
    data = ReceivingSerializer(rec, context=_ctx(request)).data
    # Plain "what changed" summary for the Delivery Added screen.
    results = []
    for line in rec.lines.select_related("inventory_item__base_unit"):
        balance = InventoryBalance.objects.filter(
            merchant=merchant, inventory_item=line.inventory_item, location=rec.location
        ).first()
        results.append({
            "item_id": line.inventory_item_id,
            "item_name": line.inventory_item.name,
            "added": str(line.base_quantity),
            "unit": line.inventory_item.base_unit.code,
            "location_name": rec.location.name,
            "new_stock": str(balance.on_hand) if balance else "0",
        })
    data["results"] = results
    return Response(data, status=201)


@api_view(["GET"])
@inventory_perm(InvPerm.RECEIVE)
def receiving_detail_view(request, pk):
    merchant = _merchant(request)
    rec = InventoryReceiving.objects.filter(merchant=merchant, id=pk).select_related(
        "supplier", "location", "received_by"
    ).prefetch_related("lines__inventory_item").first()
    if not rec:
        return _bad("Not found.", status=404)
    return Response(ReceivingSerializer(rec, context=_ctx(request)).data)


# ─────────────────────────────────────────────────────────────────────────────
# Transfers
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.TRANSFER)
def transfers_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = InventoryTransfer.objects.filter(merchant=merchant).select_related(
            "from_location", "to_location", "created_by"
        ).prefetch_related("lines__inventory_item")
        return _paged_response(request, qs, TransferSerializer)
    complete = str(request.data.get("complete", "")).lower() in ("1", "true", "yes")
    serializer = TransferCreateSerializer(data=request.data, context=_ctx(request, complete=complete))
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    _loc_ok = all(
        serializer.validated_data[k].merchant_id == merchant.id for k in ("from_location", "to_location")
    )
    if not _loc_ok:
        return _bad("Both places must belong to your business.")
    try:
        transfer = serializer.save()
    except (ValueError, PermissionError) as exc:
        return _stock_error(exc)
    data = TransferSerializer(transfer).data
    if complete:
        data["results"] = [
            {
                "item_name": line.inventory_item.name,
                "quantity": str(line.quantity),
                "unit": line.inventory_item.base_unit.code,
                "from_stock": str(getattr(InventoryBalance.objects.filter(
                    merchant=merchant, inventory_item=line.inventory_item, location=transfer.from_location
                ).first(), "on_hand", 0)),
                "to_stock": str(getattr(InventoryBalance.objects.filter(
                    merchant=merchant, inventory_item=line.inventory_item, location=transfer.to_location
                ).first(), "on_hand", 0)),
            }
            for line in transfer.lines.select_related("inventory_item__base_unit")
        ]
    return Response(data, status=201)


@api_view(["POST"])
@inventory_perm(InvPerm.TRANSFER)
def transfer_complete_view(request, pk):
    merchant = _merchant(request)
    transfer = InventoryTransfer.objects.filter(merchant=merchant, id=pk).first()
    if not transfer:
        return _bad("Not found.", status=404)
    try:
        InventoryMovementService.transfer(
            merchant=merchant,
            transfer=transfer,
            performed_by=request.user,
            idempotency_key=request.data.get("idempotency_key"),
        )
    except ValueError as exc:
        return _stock_error(exc)
    transfer.refresh_from_db()
    return Response(TransferSerializer(transfer).data)


@api_view(["POST"])
@inventory_perm(InvPerm.TRANSFER)
def transfer_cancel_view(request, pk):
    merchant = _merchant(request)
    transfer = InventoryTransfer.objects.filter(merchant=merchant, id=pk).first()
    if not transfer:
        return _bad("Not found.", status=404)
    if transfer.status in ("RECEIVED", "CANCELLED"):
        return _bad("This move is already finished.")
    transfer.status = "CANCELLED"
    transfer.save(update_fields=["status", "updated_at"])
    return Response(TransferSerializer(transfer).data)


# ─────────────────────────────────────────────────────────────────────────────
# Stock counts
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.COUNT)
def counts_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = StockCount.objects.filter(merchant=merchant).select_related(
            "location", "started_by", "submitted_by"
        ).annotate(
            n_lines=Count("lines", distinct=True),
            n_counted=Count("lines", filter=Q(lines__physical_quantity__isnull=False), distinct=True),
            n_different=Count(
                "lines", filter=Q(lines__difference__isnull=False) & ~Q(lines__difference=0), distinct=True
            ),
        ).order_by("-created_at")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status__in=[s.strip().upper() for s in status_filter.split(",")])
        return _paged_response(request, qs, StockCountSummarySerializer, default_size=20)
    serializer = CountCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data
    location = None
    if data.get("location"):
        location = InventoryLocation.objects.filter(merchant=merchant, id=data["location"]).first()
        if not location:
            return _bad("Unknown location.")
    item_ids = data.get("item_ids") or None
    if item_ids and InventoryItem.objects.filter(merchant=merchant, id__in=item_ids).count() != len(set(item_ids)):
        return _bad("One of the items was not found.")
    count = StockCountService.create_count(
        merchant=merchant,
        name=data["name"],
        location=location,
        item_ids=item_ids,
        count_type=data.get("count_type") or "Stock Count",
        started_by=request.user,
        note=data.get("note") or "",
    )
    if not count.lines.exists():
        count.delete()
        return _bad("There are no stock items in this place to count yet.")
    return Response(StockCountSerializer(_count_detail_qs(merchant).get(pk=count.pk)).data, status=201)


def _count_detail_qs(merchant):
    from .models import StockCountLine

    return StockCount.objects.filter(merchant=merchant).select_related(
        "location", "started_by", "submitted_by", "approved_by"
    ).prefetch_related(
        Prefetch(
            "lines",
            queryset=StockCountLine.objects.select_related(
                "inventory_item__base_unit", "location"
            ).order_by("location__display_order", "inventory_item__name"),
        )
    )


@api_view(["GET"])
@inventory_perm(InvPerm.COUNT)
def count_detail_view(request, pk):
    count = _count_detail_qs(_merchant(request)).filter(id=pk).first()
    if not count:
        return _bad("Not found.", status=404)
    return Response(StockCountSerializer(count).data)


@api_view(["POST"])
@inventory_perm(InvPerm.COUNT)
def count_line_upsert_view(request, pk):
    merchant = _merchant(request)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return _bad("Not found.", status=404)
    serializer = CountUpsertSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    try:
        line = StockCountService.upsert_line(
            count=count,
            merchant=merchant,
            line_id=serializer.validated_data["line_id"],
            physical_quantity=serializer.validated_data.get("physical_quantity"),
            note=serializer.validated_data.get("note") or "",
            performed_by=request.user,
        )
    except ValueError as exc:
        return _bad(str(exc))
    return Response(CountLineSerializer(line).data)


@api_view(["POST"])
@inventory_perm(InvPerm.SUBMIT_COUNT)
def count_submit_view(request, pk):
    merchant = _merchant(request)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return _bad("Not found.", status=404)
    # With approval switched off, submitting reconciles immediately — that is
    # an approval, so the submitter needs approval rights then.
    settings_obj = InventorySettings.for_merchant(merchant)
    try:
        result = StockCountService.submit(count=count, merchant=merchant, submitted_by=request.user) \
            if (settings_obj.require_count_approval or _can(request, InvPerm.APPROVE_COUNT)) \
            else _submit_for_review(count, merchant, request.user)
    except ValueError as exc:
        return _bad(str(exc))
    return Response(StockCountSerializer(_count_detail_qs(merchant).get(pk=result.pk)).data)


def _submit_for_review(count, merchant, user):
    """Staff finishing a count when auto-approve is on still waits for a manager."""
    if not count.lines.filter(physical_quantity__isnull=False).exists():
        raise ValueError("No items were counted.")
    if count.status in (CountStatus.CANCELLED, CountStatus.APPROVED):
        raise ValueError("This count is already closed.")
    count.status = CountStatus.SUBMITTED
    count.submitted_at = timezone.now()
    count.submitted_by = user
    count.save(update_fields=["status", "submitted_at", "submitted_by", "updated_at"])
    return count


@api_view(["POST"])
@inventory_perm(InvPerm.APPROVE_COUNT)
def count_approve_view(request, pk):
    merchant = _merchant(request)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return _bad("Not found.", status=404)
    try:
        result = StockCountService.approve(count=count, merchant=merchant, approved_by=request.user)
    except ValueError as exc:
        return _stock_error(exc)
    return Response(StockCountSerializer(_count_detail_qs(merchant).get(pk=result.pk)).data)


@api_view(["POST"])
@inventory_perm(InvPerm.COUNT)
def count_cancel_view(request, pk):
    merchant = _merchant(request)
    count = StockCount.objects.filter(merchant=merchant, id=pk).first()
    if not count:
        return _bad("Not found.", status=404)
    if count.status == CountStatus.SUBMITTED and not _can(request, InvPerm.APPROVE_COUNT):
        return _bad("A manager is reviewing this count. Only a manager can cancel it now.", status=403)
    try:
        count = StockCountService.cancel(count=count, merchant=merchant, cancelled_by=request.user)
    except ValueError as exc:
        return _bad(str(exc))
    return Response(StockCountSummarySerializer(count).data)


# ─────────────────────────────────────────────────────────────────────────────
# Suppliers
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(
    (InvPerm.MANAGE_SUPPLIERS, InvPerm.RECEIVE, InvPerm.PURCHASE),
    POST=InvPerm.MANAGE_SUPPLIERS,
)
def suppliers_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = Supplier.objects.filter(merchant=merchant, archived=False).prefetch_related(
            "item_mappings__inventory_item"
        )
        if request.query_params.get("active", "1") == "1":
            qs = qs.filter(is_active=True)
        return Response(SupplierSerializer(qs, many=True, context=_ctx(request)).data)
    serializer = SupplierSerializer(data=request.data, context=_ctx(request))
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    if Supplier.objects.filter(merchant=merchant, name__iexact=serializer.validated_data["name"]).exists():
        return _bad("A supplier with this name already exists.")
    sup = serializer.save(merchant=merchant)
    _audit(request, InventoryAuditLog.ACTION_SUPPLIER_EDIT, "supplier", sup.id, event="created")
    return Response(SupplierSerializer(sup, context=_ctx(request)).data, status=201)


@api_view(["GET", "PATCH", "DELETE"])
@inventory_perm(
    (InvPerm.MANAGE_SUPPLIERS, InvPerm.RECEIVE, InvPerm.PURCHASE),
    PATCH=InvPerm.MANAGE_SUPPLIERS, DELETE=InvPerm.MANAGE_SUPPLIERS,
)
def supplier_detail_view(request, pk):
    merchant = _merchant(request)
    sup = Supplier.objects.filter(merchant=merchant, id=pk).first()
    if not sup:
        return _bad("Not found.", status=404)
    if request.method == "DELETE":
        sup.archived = True
        sup.is_active = False
        sup.save(update_fields=["archived", "is_active", "updated_at"])
        _audit(request, InventoryAuditLog.ACTION_SUPPLIER_EDIT, "supplier", sup.id, event="archived")
        return Response({"ok": True})
    if request.method == "GET":
        return Response(SupplierSerializer(sup, context=_ctx(request)).data)
    serializer = SupplierSerializer(sup, data=request.data, partial=True, context=_ctx(request))
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    sup = serializer.save()
    _audit(request, InventoryAuditLog.ACTION_SUPPLIER_EDIT, "supplier", sup.id, event="updated")
    return Response(SupplierSerializer(sup, context=_ctx(request)).data)


@api_view(["POST"])
@inventory_perm(InvPerm.MANAGE_SUPPLIERS)
def supplier_mapping_view(request, pk):
    merchant = _merchant(request)
    sup = Supplier.objects.filter(merchant=merchant, id=pk).first()
    if not sup:
        return _bad("Not found.", status=404)
    item = InventoryItem.objects.filter(merchant=merchant, id=_int(request.data.get("inventory_item"))).first()
    if not item:
        return _bad("Unknown item.")
    try:
        conversion = _decimal(request.data.get("purchase_unit_conversion"))
        cost = _decimal(request.data.get("latest_unit_cost"))
        minimum = _decimal(request.data.get("minimum_quantity"))
    except ValueError:
        return _bad("Pack size, cost and minimum must be numbers.")
    if any(v is not None and v < 0 for v in (conversion, cost, minimum)):
        return _bad("Numbers cannot be negative.")
    SupplierItem.objects.update_or_create(
        supplier=sup,
        inventory_item=item,
        defaults={
            "supplier_sku": str(request.data.get("supplier_sku", "") or "")[:120],
            "purchase_unit_label": str(request.data.get("purchase_unit_label", "") or "")[:80],
            "purchase_unit_conversion": conversion,
            "latest_unit_cost": cost,
            "preferred": bool(request.data.get("preferred", False)),
            "minimum_quantity": minimum,
            "lead_time_days": _int(request.data.get("lead_time_days")),
        },
    )
    sup.refresh_from_db()
    return Response(SupplierSerializer(sup, context=_ctx(request)).data)


# ─────────────────────────────────────────────────────────────────────────────
# Purchase orders ("Supplier Orders")
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "POST"])
@inventory_perm(InvPerm.PURCHASE)
def purchase_orders_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        qs = PurchaseOrder.objects.filter(merchant=merchant).select_related(
            "supplier", "delivery_location", "created_by"
        ).prefetch_related("lines__inventory_item")
        po_status = request.query_params.get("status")
        if po_status:
            qs = qs.filter(status__in=[s.strip().upper() for s in po_status.split(",")])
        return _paged_response(request, qs, PurchaseOrderSerializer)
    serializer = POCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    data = serializer.validated_data
    supplier = Supplier.objects.filter(merchant=merchant, id=data["supplier"]).first()
    if not supplier:
        return _bad("Unknown supplier.")
    location = InventoryLocation.objects.filter(merchant=merchant, id=data["delivery_location"]).first()
    if not location:
        return _bad("Unknown delivery location.")
    try:
        po = PurchaseOrderService.create(
            merchant=merchant,
            supplier=supplier,
            delivery_location=location,
            lines=data["lines"],
            expected_date=data.get("expected_date"),
            notes=data.get("notes") or "",
            created_by=request.user,
        )
    except (ValueError, TypeError, AttributeError) as exc:
        return _bad(str(exc) or "Check the order lines.")
    return Response(PurchaseOrderSerializer(po, context=_ctx(request)).data, status=201)


@api_view(["GET", "PATCH"])
@inventory_perm(InvPerm.PURCHASE)
def purchase_order_detail_view(request, pk):
    merchant = _merchant(request)
    po = PurchaseOrder.objects.filter(merchant=merchant, id=pk).select_related(
        "supplier", "delivery_location", "created_by"
    ).prefetch_related("lines__inventory_item").first()
    if not po:
        return _bad("Not found.", status=404)
    if request.method == "PATCH":
        new_status = request.data.get("status")
        if new_status == "CANCELLED":
            if po.status in ("RECEIVED", "PARTIALLY_RECEIVED"):
                return _bad("Stock from this order has already arrived. It cannot be cancelled.")
            po.status = "CANCELLED"
            po.save(update_fields=["status", "updated_at"])
        elif new_status == "SEND":
            po.status = "SENT"
            po.save(update_fields=["status", "updated_at"])
    return Response(PurchaseOrderSerializer(po, context=_ctx(request)).data)


@api_view(["POST"])
@inventory_perm(InvPerm.RECEIVE)
def purchase_order_receive_view(request, pk):
    merchant = _merchant(request)
    po = PurchaseOrder.objects.filter(merchant=merchant, id=pk).first()
    if not po:
        return _bad("Not found.", status=404)
    serializer = POReceiveSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=400)
    location = None
    if serializer.validated_data.get("location"):
        location = InventoryLocation.objects.filter(
            merchant=merchant, id=serializer.validated_data["location"]
        ).first()
        if not location:
            return _bad("Unknown location.")
    try:
        updated = PurchaseOrderService.receive_lines(
            merchant=merchant,
            po=po,
            received_map=serializer.validated_data["received"],
            location=location,
            performed_by=request.user,
            idempotency_key=serializer.validated_data.get("idempotency_key"),
        )
    except ValueError as exc:
        return _stock_error(exc)
    return Response(PurchaseOrderSerializer(updated, context=_ctx(request)).data)


# ─────────────────────────────────────────────────────────────────────────────
# Reports (JSON). CSV/PDF downloads live in views_io.py and share builders.
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW_REPORTS)
def reports_view(request):
    merchant = _merchant(request)
    key = request.query_params.get("report", "stock-history")
    try:
        report = report_builders.build_report(
            key, merchant, request.query_params.dict(), _can(request, InvPerm.VIEW_COST)
        )
    except KeyError:
        return _bad("Unknown report.")
    page, size = _pagination(request, default_size=50)
    total = report.count()
    return Response({
        "report": report.key,
        "title": report.title,
        "columns": [{"key": c.key, "label": c.label, "numeric": c.numeric} for c in report.visible_columns],
        "results": report.page((page - 1) * size, size),
        "summary": report.summary,
        "include_cost": report.include_cost,
        **_page_meta(page, size, total),
    })


@api_view(["GET"])
@inventory_perm(InvPerm.MANAGE_SETTINGS)
def audit_log_view(request):
    qs = InventoryAuditLog.objects.filter(merchant=_merchant(request)).select_related("user")
    return _paged_response(request, qs, AuditLogSerializer)


# ─────────────────────────────────────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET", "PATCH"])
@inventory_perm(InvPerm.MANAGE_SETTINGS)
def settings_view(request):
    merchant = _merchant(request)
    settings_obj = InventorySettings.for_merchant(merchant)
    if request.method == "PATCH":
        serializer = InventorySettingsSerializer(settings_obj, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        settings_obj = serializer.save()
        _audit(request, InventoryAuditLog.ACTION_SETTINGS_UPDATED, "settings", settings_obj.id,
               changes={k: request.data[k] for k in serializer.validated_data})
    return Response(InventorySettingsSerializer(settings_obj).data)
