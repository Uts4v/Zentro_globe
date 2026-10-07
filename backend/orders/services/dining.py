import logging
from decimal import Decimal
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from orders.models import DiningSession, KitchenOrderTicket, Order, OrderItem, OrderItemOption
from orders.pricing import reprice_order
from orders.services.preparation import prepare_order_items_for_routing
from inventory.order_stock import safe_deduct_stock_for_order
from loyalty.earning import estimate_points

logger = logging.getLogger(__name__)


def generate_next_kot_number(merchant) -> int:
    """
    Generate sequential daily KOT number for merchant (resets at midnight).
    Under transaction.atomic / select_for_update, guarantees no duplicate numbers.
    """
    today_start = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)

    max_kot = (
        KitchenOrderTicket.objects.filter(merchant=merchant, created_at__gte=today_start).aggregate(
            m=Max("kot_number")
        )["m"]
        or 0
    )

    max_order_kot = (
        Order.objects.filter(
            merchant=merchant, created_at__gte=today_start, kot_number__isnull=False
        ).aggregate(m=Max("kot_number"))["m"]
        or 0
    )

    return max(max_kot, max_order_kot) + 1


def serialize_kot_items_data(priced_lines=None, order_items=None) -> list:
    """
    Serialize items into a structured JSON snapshot for KitchenOrderTicket.items_data.
    Accepts either priced request lines (from pricing engine) or OrderItem models.
    """
    items = []
    if priced_lines:
        for p in priced_lines:
            options = []
            for opt in getattr(p, "options", []):
                options.append({
                    "group_name": getattr(opt, "group_name", ""),
                    "option_name": getattr(opt, "option_name", ""),
                })
            item_fields = getattr(p, "item_fields", {})
            name = (
                item_fields.get("name")
                if isinstance(item_fields, dict)
                else getattr(p, "name", "")
            )
            quantity = (
                item_fields.get("quantity")
                if isinstance(item_fields, dict)
                else getattr(p, "quantity", 1)
            )
            special_instructions = (
                item_fields.get("special_instructions", "")
                if isinstance(item_fields, dict)
                else getattr(p, "special_instructions", "")
            )
            items.append({
                "name": name or getattr(p, "name", ""),
                "quantity": quantity or 1,
                "special_instructions": special_instructions or "",
                "options": options,
            })
    elif order_items:
        for item in order_items:
            options = [
                {"group_name": opt.group_name, "option_name": opt.option_name}
                for opt in item.options.all()
            ] if hasattr(item, "options") else []
            items.append({
                "name": item.name,
                "quantity": item.quantity,
                "special_instructions": item.special_instructions or "",
                "options": options,
            })
    return items


def get_active_dining_session(merchant, table=None, session_id=None):
    """
    Finds the active dining session for a table or session_id.
    Validates that the linked bill_order is still open and uncollected.
    If the bill is already settled (paid/refunded/completed/cancelled)
    or pricing is locked, the session is auto-closed and None is returned.
    """
    qs = DiningSession.objects.filter(merchant=merchant, status=DiningSession.STATUS_ACTIVE)
    session = None
    if session_id:
        session = qs.filter(session_id=session_id).select_related("bill_order", "table").first()
    if not session and table:
        session = qs.filter(table=table).select_related("bill_order", "table").first()

    if not session:
        return None

    bill = session.bill_order
    if bill:
        # Check if the bill was settled, locked, or completed/cancelled
        if (
            bill.payment_status in ("paid", "partially_paid", "refunded")
            or bill.pricing_locked_at is not None
            or bill.status in (Order.STATUS_COMPLETED, Order.STATUS_CANCELLED)
        ):
            session.status = (
                DiningSession.STATUS_CANCELLED
                if bill.status == Order.STATUS_CANCELLED
                else DiningSession.STATUS_COMPLETED
            )
            session.closed_at = timezone.now()
            session.save(update_fields=["status", "closed_at"])
            return None

    return session


def create_dining_session(merchant, table=None, bill_order=None, customer=None, guest_session_id="", guest_name="") -> DiningSession:
    """
    Creates a new active dining session.
    """
    session = DiningSession.objects.create(
        merchant=merchant,
        table=table,
        bill_order=bill_order,
        customer=customer,
        guest_session_id=guest_session_id,
        guest_name=guest_name,
        status=DiningSession.STATUS_ACTIVE,
    )
    if bill_order and bill_order.dining_session_id != session.id:
        bill_order.dining_session = session
        bill_order.save(update_fields=["dining_session", "updated_at"])
    return session


def create_kot_for_order(
    merchant,
    order,
    dining_session=None,
    kot_number=None,
    notes="",
    customer_name="",
    items_data=None,
) -> KitchenOrderTicket:
    """
    Creates and records a KitchenOrderTicket for an order.
    """
    if kot_number is None:
        kot_number = generate_next_kot_number(merchant)

    table = order.table
    table_name = order.table_name_snapshot or (table.name if table else "")
    table_number = order.table_number_snapshot or (table.table_number if table else None)

    kot = KitchenOrderTicket.objects.create(
        kot_number=kot_number,
        merchant=merchant,
        order=order,
        dining_session=dining_session or order.dining_session,
        status=KitchenOrderTicket.STATUS_PENDING,
        notes=notes or "",
        table_name_snapshot=table_name,
        table_number_snapshot=table_number,
        customer_name_snapshot=customer_name or order.customer_name_snapshot if hasattr(order, "customer_name_snapshot") else "",
        fulfillment_type_snapshot=order.fulfillment_type or Order.FULFILLMENT_DINE_IN,
        items_data=items_data or [],
    )

    if order.kot_number != kot_number:
        order.kot_number = kot_number
        order.save(update_fields=["kot_number", "updated_at"])

    return kot


def consolidate_items_into_bill(
    bill_order: Order,
    dining_session: DiningSession,
    priced_lines,
    customer=None,
    guest_name="",
    notes="",
    performed_by=None,
) -> tuple[KitchenOrderTicket, list[OrderItem]]:
    """
    Consolidates subsequent ordered items into the existing active open bill:
    1. Generates new sequential KOT ticket for the new items.
    2. Applies preparation routing snapshot to the new items.
    3. Bulk-creates OrderItem and OrderItemOption rows linked to bill_order and kot.
    4. Deducts stock if bill_order is already confirmed.
    5. Re-prices the bill_order with all items (taxes, service charge, discounts).
    6. Appends notes, bumps version, and saves bill_order.
    """
    merchant = bill_order.merchant

    # 1. Generate KOT number and create KitchenOrderTicket for newly added items
    kot_number = generate_next_kot_number(merchant)
    items_data = serialize_kot_items_data(priced_lines=priced_lines)

    customer_display = (
        (customer.full_name if customer else "")
        or guest_name
        or (bill_order.customer.full_name if bill_order.customer else "")
        or bill_order.guest_name_snapshot
    )

    kot = KitchenOrderTicket.objects.create(
        kot_number=kot_number,
        merchant=merchant,
        order=bill_order,
        dining_session=dining_session,
        status=KitchenOrderTicket.STATUS_PENDING,
        notes=notes or "",
        table_name_snapshot=bill_order.table_name_snapshot,
        table_number_snapshot=bill_order.table_number_snapshot,
        customer_name_snapshot=customer_display,
        fulfillment_type_snapshot=bill_order.fulfillment_type,
        items_data=items_data,
    )

    # 2. Prepare items for preparation routing
    raw_item_rows = [dict(p.item_fields) for p in priced_lines]
    routed_items_data = prepare_order_items_for_routing(bill_order, raw_item_rows)

    # 3. Create OrderItems linked to bill_order and kot
    created_items = OrderItem.objects.bulk_create(
        [OrderItem(order=bill_order, kot=kot, **item_fields) for item_fields in routed_items_data],
        batch_size=200,
    )

    snapshot_option_rows = []
    for index, p in enumerate(priced_lines):
        created_item = created_items[index]
        for display_order, opt in enumerate(p.options):
            snapshot_option_rows.append(
                OrderItemOption(
                    order_item=created_item,
                    group_name=opt.group_name,
                    option_name=opt.option_name,
                    kind=opt.kind,
                    price_effect=opt.price_effect,
                    option_id=opt.option_id,
                    display_order=display_order,
                )
            )
    OrderItemOption.objects.bulk_create(snapshot_option_rows, batch_size=200)

    # 4. Stock deduction if bill is already confirmed
    if bill_order.status != Order.STATUS_PENDING and performed_by:
        safe_deduct_stock_for_order(bill_order, lines=created_items, performed_by=performed_by)

    # 5. Drop stale prefetch cache and re-price the consolidated bill
    if hasattr(bill_order, "_prefetched_objects_cache"):
        bill_order._prefetched_objects_cache.pop("items", None)
    reprice_order(bill_order)

    # 6. Update bill points, kot_number, version, and notes
    bill_order.points_earned += estimate_points(priced_lines, bill_order.loyalty_spend_rate)
    bill_order.kot_number = kot_number
    bill_order.version += 1

    update_fields = ["points_earned", "kot_number", "version", "notes", "updated_at"]
    if bill_order.status == Order.STATUS_READY:
        bill_order.status = Order.STATUS_PREPARING
        update_fields.append("status")

    if notes and notes.strip():
        if bill_order.notes:
            bill_order.notes = f"{bill_order.notes}\n{notes.strip()}"
        else:
            bill_order.notes = notes.strip()

    bill_order.save(update_fields=update_fields)

    return kot, created_items


def close_dining_session_for_order(order, new_status=DiningSession.STATUS_COMPLETED):
    """
    Closes the dining session linked to an order when it is paid, refunded, completed or cancelled.
    """
    sessions = DiningSession.objects.filter(
        bill_order=order, status=DiningSession.STATUS_ACTIVE
    )
    for session in sessions:
        session.status = new_status
        session.closed_at = timezone.now()
        session.save(update_fields=["status", "closed_at"])

    if order.dining_session and order.dining_session.status == DiningSession.STATUS_ACTIVE:
        order.dining_session.status = new_status
        order.dining_session.closed_at = timezone.now()
        order.dining_session.save(update_fields=["status", "closed_at"])
