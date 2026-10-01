# orders/views.py
import logging

from django.db import transaction
from django.db import IntegrityError
from django.utils import timezone

from datetime import timedelta
from decimal import Decimal
from django.db.models import Q
from accounts.models import CustomerProfile

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from merchants.models import MerchantProfile
from config.order_utils import parse_quantity, QuantityValidationError
from orders.pricing import (
    PricingError,
    persist_new_order,
    price_new_order_lines,
    price_request_lines,
    reprice_order,
)
from orders.pricing.service import order_fields as pricing_order_fields
from loyalty.models import (
    MerchantPunchCard, CustomerPunchCard, PunchCardEvent,
    CustomerMission, Mission, CustomerMerchantProfile,
    PointTransaction, Redemption,
)
from loyalty.services import (
    get_or_create_wallet, award_wallet_points, deduct_wallet_points, refund_wallet_points,
    update_wallet_streak, join_merchant,
)
from loyalty.earning import estimate_points
from notifications.services import send_notification
from notifications.models import Notification
from inventory.order_stock import safe_deduct_stock_for_order, safe_restore_stock_for_order

from .models import Order, OrderItem, OrderItemOption
from .serializers import CustomerOrderSerializer, OrderSerializer, CreateOrderSerializer, CreateGuestOrderSerializer, AddItemsToOrderSerializer
from .services.preparation import prepare_order_items_for_routing

logger = logging.getLogger(__name__)


def _paginate(request, qs, default=100, max_limit=200):
    """Slice a queryset with limit/offset params while keeping the plain-list shape."""
    limit = int(request.query_params.get("limit", default))
    limit = max(1, min(limit, max_limit))
    offset = max(0, int(request.query_params.get("offset", 0)))
    return qs[offset:offset + limit]


def _option_rows(priced):
    """(line index, options) pairs for _bulk_create_items_with_options."""
    return [(index, p.options) for index, p in enumerate(priced)]


def _item_rows(priced):
    return [dict(p.item_fields) for p in priced]


def _bulk_create_items_with_options(order, order_items_data, option_rows):
    """
    Create OrderItem rows (after preparation routing) and snapshot options.

    One OrderItem per submitted cart line. Identical lines are NOT merged here:
    the customer cart already merges by (item, selections, instructions) before
    sending, and reports/KDS treat each submitted line as its own unit. Merging
    server-side would silently rewrite what a client explicitly asked to record.
    """
    items = OrderItem.objects.bulk_create(
        [OrderItem(order=order, **item) for item in order_items_data],
        batch_size=200,
    )
    snapshot_rows = []
    for index, line_options in option_rows:
        created = items[index]
        for display_order, opt in enumerate(line_options):
            snapshot_rows.append(OrderItemOption(
                order_item=created,
                group_name=opt.group_name,
                option_name=opt.option_name,
                kind=opt.kind,
                price_effect=opt.price_effect,
                option_id=opt.option_id,
                display_order=display_order,
            ))
    OrderItemOption.objects.bulk_create(snapshot_rows, batch_size=200)
    return items


def _audit_order(order, action, *, metadata=None):
    """
    Write an audit entry for a customer/merchant order lifecycle event.
    Uses the shared PosAuditLog so order-status changes and cancellations are
    traceable alongside POS activity (H-9). Never raises into the caller.
    """
    from pos.models import PosAuditLog
    try:
        PosAuditLog.objects.create(
            merchant=order.merchant,
            action=action,
            entity_type="order",
            entity_id=str(order.id),
            metadata=metadata or {},
        )
    except Exception:
        logger.exception("Audit write failed (order flow continues)")


def _order_qs():
    """select_related paths covering every OrderSerializer display source."""
    return Order.objects.select_related(
        "merchant",
        "customer__user",
        "reward_redemption__reward",
        "punch_card_redemption__punch_card",
        "table",
        "processed_by_worker",
        "pos_device",
        "cash_shift",
    ).prefetch_related("items__menu_item", "items__options")


def _notify_safe(**kwargs):
    try:
        send_notification(**kwargs)
    except Exception:
        logger.exception("Failed to send notification (order flow continues)")


def _deduct_reward_redemption_points(order: Order):
    """
    Legacy path: deduct points when a reward redemption order is completed.

    Kept only for redemptions created before the C-2 change (whose orders were
    not yet marked ``loyalty_awarded``). New redemptions deduct at redemption
    time inside ``redeem_reward`` and are created with ``loyalty_awarded=True``.
    """
    redemption = order.reward_redemption
    if not redemption or not redemption.points_spent:
        return

    # Guard against double-deduction on re-processing.
    if order.loyalty_awarded:
        return

    customer = order.customer
    wallet = get_or_create_wallet(customer, order.merchant)

    try:
        deduct_wallet_points(
            wallet,
            redemption.points_spent,
            transaction_type="REDEEMED",
            description=f"Redeemed reward: {redemption.reward.name} (Order #{order.id})",
            reward=redemption.reward,
            order=order,
        )
    except ValueError:
        logger.warning(
            "Could not deduct %s points for redemption %s — insufficient balance",
            redemption.points_spent, redemption.id,
        )


def _refund_reward_redemption_points(order: Order):
    """Refund points for a cancelled reward redemption (idempotent)."""
    redemption = order.reward_redemption
    if not redemption or not redemption.points_spent:
        return

    # Idempotency guard: never refund the same order twice.
    if PointTransaction.objects.filter(
        order=order,
        transaction_type="REDEMPTION_REFUND",
    ).exists():
        return

    # Only refund if points were actually deducted for this order.
    deduct_txn = (
        PointTransaction.objects
        .filter(
            order=order,
            transaction_type="REDEEMED",
            wallet__customer=order.customer,
        )
        .order_by("-created_at")
        .first()
    )
    if not deduct_txn:
        # A redemption created before the C-2 change never deducted points;
        # nothing to refund.
        return

    refund_wallet_points(
        deduct_txn.wallet,
        redemption.points_spent,
        transaction_type="REDEMPTION_REFUND",
        description=f"Refund for cancelled reward redemption: {redemption.reward.name} (Order #{order.id})",
        reward=redemption.reward,
        order=order,
    )

    redemption.status = Redemption.STATUS_CANCELLED
    redemption.save(update_fields=["status"])

    # Restore reward stock if it was decremented at redemption time.
    if redemption.reward.stock != -1:
        redemption.reward.stock += 1
        redemption.reward.save(update_fields=["stock"])


def _counts_toward_loyalty(order: Order) -> bool:
    """Whether the order has eligible PAID lines (a reward never earns a reward).

    Reward/comp orders (punch-card claims, reward redemptions, staff comps)
    and orders made only of reward or free lines stay in history, but they
    must not earn points, punch a card, bump the order count or visit
    streak, or advance missions. See loyalty.earning.
    """
    from loyalty.earning import compute_loyalty_earning

    return compute_loyalty_earning(order).qualifies


def _award_loyalty(order: Order):
    from loyalty.earning import compute_loyalty_earning

    customer = order.customer
    wallet   = get_or_create_wallet(customer, order.merchant)
    earning  = compute_loyalty_earning(order)
    counts   = earning.qualifies

    # The award is calculated from the lines as they are now (rewards and
    # discounts applied after the order was placed included), so the stored
    # figure always matches what was actually credited.
    update_fields = []
    if order.points_earned != earning.points:
        order.points_earned = earning.points
        update_fields.append("points_earned")
    if earning.reward_only and not order.is_reward_order:
        # Only reward/free goods: record it as a reward fulfilment.
        order.is_reward_order = True
        update_fields.append("is_reward_order")
    if update_fields:
        order.save(update_fields=[*update_fields, "updated_at"])

    old_balance = wallet.points_balance

    if counts and earning.points > 0:
        award_wallet_points(
            wallet, earning.points,
            transaction_type="EARNED",
            description=f"Points earned for Order #{order.id}",
            order=order,
        )

    streak_incremented = False
    if counts:
        wallet.order_count += 1
        wallet.save(update_fields=["order_count", "updated_at"])
        streak_incremented = update_wallet_streak(wallet)

    user = customer.user

    # ── Customer notifications (web toast + PWA push) ──
    def _notify_completion():
        # 1. Points earned
        if order.points_earned > 0:
            _notify_safe(
                user=user,
                title=f"You earned {order.points_earned} points! 🎉",
                message=f"Order #{order.id} at {order.merchant.business_name} — balance: {wallet.points_balance} pts.",
                notification_type=Notification.TYPE_POINTS_EARNED,
                merchant_name=order.merchant.business_name,
                context_url=f"/customer/merchant/{order.merchant.slug}",
                order_id=order.id,
                merchant_id=order.merchant.id,
            )
        else:
            _notify_safe(
                user=user,
                title="Order complete! ✅",
                message=f"Your order #{order.id} at {order.merchant.business_name} is complete.",
                notification_type=Notification.TYPE_ORDER_UPDATE,
                merchant_name=order.merchant.business_name,
                context_url=f"/customer/merchant/{order.merchant.slug}",
                order_id=order.id,
                merchant_id=order.merchant.id,
            )

        # 2. Newly unlocked rewards (balance crossed a reward's threshold)
        new_balance = wallet.points_balance
        if new_balance > old_balance:
            unlocked = (
                order.merchant.rewards.filter(
                    is_active=True,
                    points_cost__gt=max(0, old_balance),
                    points_cost__lte=new_balance,
                )
                .order_by("points_cost")
                .first()
            )
            if unlocked:
                _notify_safe(
                    user=user,
                    title=f"Reward unlocked: {unlocked.name} 🎁",
                    message=f"You can now redeem it for {unlocked.points_cost} points.",
                    notification_type=Notification.TYPE_REWARD_REDEEMED,
                    merchant_name=order.merchant.business_name,
                    context_url="/rewards",
                    reward_id=unlocked.id,
                    merchant_id=order.merchant.id,
                )

    transaction.on_commit(_notify_completion)

    if not counts:
        return

    # Punch cards
    for merchant_card in MerchantPunchCard.objects.filter(
        merchant=order.merchant, is_active=True
    ):
        customer_card, created = CustomerPunchCard.objects.get_or_create(
            customer=customer,
            punch_card=merchant_card,
            merchant=order.merchant,
            is_completed=False,
            defaults={"current_stamps": 0},
        )
        if created:
            customer_card.record_event(
                PunchCardEvent.EVENT_STARTED,
                order=order,
                note=f"Started '{merchant_card.name}'",
            )
        should_punch = (
            merchant_card.mode == MerchantPunchCard.MODE_PER_ORDER
            or (merchant_card.mode == MerchantPunchCard.MODE_PER_STREAK and streak_incremented)
        )
        if should_punch:
            completed = customer_card.add_punch(order=order)
            if completed:
                # Notify customer their punch card is complete
                transaction.on_commit(lambda: _notify_safe(
                    user=customer.user,
                    title="Punch card complete! 🎉",
                    message=f"Show your card to claim: {merchant_card.reward_text}",
                    notification_type=Notification.TYPE_PUNCH_CARD,
                    merchant_name=order.merchant.business_name,
                    context_url=f"/customer/merchant/{order.merchant.slug}",
                    merchant_id=order.merchant.id,
                ))

    _update_mission_progress(customer, order, wallet, streak_incremented, earning.eligible_amount)


def _should_restart_mission(cm):
    """Check if a completed CustomerMission should restart based on its restart_interval."""
    if not cm.is_completed or not cm.completed_at or not cm.mission.restart_interval:
        return False
    interval = cm.mission.restart_interval
    now = timezone.now()
    if interval == "daily":
        return now - cm.completed_at >= timedelta(days=1)
    elif interval == "weekly":
        return now - cm.completed_at >= timedelta(weeks=1)
    elif interval == "monthly":
        return now - cm.completed_at >= timedelta(days=30)
    return False


def _update_mission_progress(customer, order, wallet, streak_incremented, eligible_amount=None):
    """Advance missions. Spend missions count only eligible PAID goods."""
    from loyalty.services import award_wallet_points as award_pts

    if eligible_amount is None:
        from loyalty.earning import compute_loyalty_earning

        eligible_amount = compute_loyalty_earning(order).eligible_amount

    missions = Mission.objects.filter(
        is_active=True,
        mission_type__in=["order_count", "spend_amount", "visit_streak"],
    ).filter(required_merchant__in=[order.merchant, None])

    for mission in missions:
        if mission.mission_type == "visit_streak" and not streak_incremented:
            continue

        cm, _ = CustomerMission.objects.get_or_create(
            customer=customer, mission=mission,
        )
        if cm.is_completed:
            if _should_restart_mission(cm):
                cm.current_count = 0
                cm.is_completed = False
                cm.completed_at = None
            else:
                continue

        if mission.mission_type == "spend_amount":
            cm.current_count += int(eligible_amount)
        else:
            cm.current_count += 1

        if cm.current_count >= mission.target_count:
            cm.is_completed  = True
            cm.completed_at  = timezone.now()
            mission_wallet   = (
                get_or_create_wallet(customer, mission.required_merchant)
                if mission.required_merchant_id else wallet
            )
            award_pts(
                mission_wallet, mission.reward_points,
                transaction_type="MISSION_BONUS",
                description=f"Mission '{mission.title}' completed",
                mission=mission,
            )
            transaction.on_commit(lambda: _notify_safe(
                user=customer.user,
                title=f"Mission complete: {mission.title} 🎯",
                message=f"You earned {mission.reward_points} bonus points!",
                notification_type=Notification.TYPE_MISSION_COMPLETE,
                merchant_name=order.merchant.business_name,
                context_url=f"/customer/merchant/{order.merchant.slug}",
                merchant_id=order.merchant.id,
            ))
        cm.save()


# ── Views ─────────────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_orders(request):
    try:
        customer = request.user.customer_profile
    except CustomerProfile.DoesNotExist:
        return Response({"error": "No customer profile found."}, status=status.HTTP_404_NOT_FOUND)

    orders = (
        _order_qs()
        .filter(customer=customer)
        .order_by("-created_at")
    )
    orders = _paginate(request, orders)
    return Response(CustomerOrderSerializer(orders, many=True, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def store_orders(request):
    try:
        merchant = request.user.merchant_profile
    except MerchantProfile.DoesNotExist:
        return Response({"error": "No merchant profile found."}, status=status.HTTP_404_NOT_FOUND)

    qs = (
        _order_qs()
        .filter(merchant=merchant)
        .order_by("-created_at")
    )

    filter_status = request.query_params.get("status")
    if filter_status:
        qs = qs.filter(status=filter_status)

    qs = _paginate(request, qs)
    return Response(OrderSerializer(qs, many=True, context={"request": request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def create_order(request):
    serializer = CreateOrderSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data

    try:
        customer = request.user.customer_profile
    except CustomerProfile.DoesNotExist:
        return Response({"error": "No customer profile found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        merchant = MerchantProfile.objects.get(id=data["merchant_id"])
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    if not merchant.is_open:
        return Response({"error": "This store is currently closed."}, status=status.HTTP_400_BAD_REQUEST)

    membership, _, _ = join_merchant(customer, merchant)

    client_mutation_id = data.get("client_mutation_id")
    if client_mutation_id:
        existing_order = (
            Order.objects.filter(
                customer=customer,
                merchant=merchant,
                client_mutation_id=client_mutation_id,
            )
            .order_by("-created_at")
            .first()
        )
        if existing_order:
            return Response(OrderSerializer(existing_order, context={"request": request}).data)

    # Validate fulfillment type against merchant settings
    fulfillment_type = data.get("fulfillment_type", Order.FULFILLMENT_PICKUP)
    table_token = data.get("table_token", "").strip()

    if fulfillment_type == Order.FULFILLMENT_DINE_IN:
        if not merchant.table_ordering_enabled:
            return Response(
                {"error": "This merchant does not support table ordering."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not table_token:
            return Response(
                {"error": "Table token is required for dine-in orders."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # Resolve table if dine-in
    table_instance = None
    table_name_snap = ""
    table_number_snap = None

    if fulfillment_type == Order.FULFILLMENT_DINE_IN and table_token:
        from merchants.models import MerchantTable
        try:
            table_instance = MerchantTable.objects.get(
                public_token=table_token,
                merchant=merchant,
                is_active=True,
            )
        except MerchantTable.DoesNotExist:
            return Response(
                {"error": "Invalid or inactive table. Please scan a valid table QR code."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        table_name_snap = table_instance.name
        table_number_snap = table_instance.table_number

    elif fulfillment_type in (Order.FULFILLMENT_PICKUP, Order.FULFILLMENT_DELIVERY):
        if table_token:
            return Response(
                {"error": "Table token should not be provided for pickup or delivery orders."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # ── Server-side authoritative pricing (orders.pricing) ───────────────────
    try:
        priced = price_request_lines(merchant, data["items"])
    except PricingError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # A claimed offer is checked against the basket before anything is written,
    # so an offer that doesn't apply never produces an undiscounted order.
    claim = None
    if data.get("claim_id"):
        from offers.checkout import apply_offer_to_basket
        from offers.engine import OfferError
        try:
            claim, priced, _evaluation = apply_offer_to_basket(
                claim_id=data["claim_id"], customer=customer, merchant=merchant, priced=priced,
                reward_choice=data.get("reward_choice"), fulfillment_type=fulfillment_type,
            )
        except OfferError as exc:
            return Response(exc.as_response_data(), status=exc.status)

    pricing_ctx, pricing = price_new_order_lines(
        merchant, priced, fulfillment_type=fulfillment_type, order_type=Order.ORDER_TYPE_REGULAR,
    )

    order = Order.objects.create(
        customer=customer,
        merchant=merchant,
        **pricing_order_fields(pricing_ctx, pricing, merchant),
        # Reward lines (offer free items, BOGO rewards) never earn.
        points_earned=estimate_points(priced),
        loyalty_spend_rate=Decimal("0"),
        notes=data.get("notes", ""),
        status=Order.STATUS_PENDING,
        order_type=Order.ORDER_TYPE_REGULAR,
        fulfillment_type=fulfillment_type,
        table=table_instance,
        table_name_snapshot=table_name_snap,
        table_number_snapshot=table_number_snap,
        client_mutation_id=client_mutation_id,
    )

    try:
        # Apply preparation routing
        order_items_data = prepare_order_items_for_routing(order, _item_rows(priced))

        created_items = _bulk_create_items_with_options(order, order_items_data, _option_rows(priced))
        persist_new_order(order, pricing_ctx, pricing, created_items)
    except IntegrityError:
        # A concurrent request already persisted an order with the same
        # client_mutation_id (customer + merchant). Return that one.
        existing_order = (
            Order.objects.filter(
                customer=customer,
                merchant=merchant,
                client_mutation_id=client_mutation_id,
            )
            .order_by("-created_at")
            .first()
        )
        if existing_order:
            return Response(
                OrderSerializer(existing_order, context={"request": request}).data
            )
        raise

    if claim is not None:
        from offers.engine import CHANNEL_ONLINE, OfferError, reserve_for_order
        try:
            reserve_for_order(claim, order, channel=CHANNEL_ONLINE, created_by=request.user)
        except OfferError as exc:
            transaction.set_rollback(True)
            return Response(exc.as_response_data(), status=exc.status)
        order.refresh_from_db()

    transaction.on_commit(lambda: _notify_safe(
        user=merchant.user,
        title="New order received",
        message=f"Order #{order.id} from {customer.full_name or 'Customer'} — {merchant.currency_symbol} {order.total_amount}",
        notification_type=Notification.TYPE_NEW_ORDER,
        merchant_name=merchant.business_name,
        context_url="/merchant/orders",
        order_id=order.id,
        merchant_id=merchant.id,
    ))

    return Response(OrderSerializer(order, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
@transaction.atomic
def guest_create_order(request):
    """Create an order without authentication. Requires a valid table token."""
    serializer = CreateGuestOrderSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data

    try:
        merchant = MerchantProfile.objects.get(id=data["merchant_id"])
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    if not merchant.is_open:
        return Response({"error": "This store is currently closed."}, status=status.HTTP_400_BAD_REQUEST)

    if not merchant.table_ordering_enabled:
        return Response(
            {"error": "This merchant does not support table ordering."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    table_token = data["table_token"].strip()
    if not table_token:
        return Response(
            {"error": "Table token is required for guest orders."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from merchants.models import MerchantTable
    try:
        table_instance = MerchantTable.objects.get(
            public_token=table_token,
            merchant=merchant,
            is_active=True,
        )
    except MerchantTable.DoesNotExist:
        return Response(
            {"error": "Invalid or inactive table. Please scan a valid table QR code."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── Server-side authoritative pricing for guest/table-QR orders ───────────
    try:
        priced = price_request_lines(merchant, data["items"], loyalty_eligible=False)
    except PricingError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # Generate KOT number. Lock the merchant row so concurrent guest orders
    # can't compute the same count+1.
    from django.utils import timezone as tz
    merchant = MerchantProfile.objects.select_for_update().get(pk=merchant.pk)
    today_start = tz.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = Order.objects.filter(
        merchant=merchant, created_at__gte=today_start, kot_number__isnull=False,
    ).count()
    kot_number = today_count + 1

    pricing_ctx, pricing = price_new_order_lines(
        merchant, priced, fulfillment_type=Order.FULFILLMENT_DINE_IN, order_type=Order.ORDER_TYPE_REGULAR,
    )

    order = Order.objects.create(
        customer=None,
        merchant=merchant,
        **pricing_order_fields(pricing_ctx, pricing, merchant),
        points_earned=0,  # Guest orders don't earn points
        loyalty_spend_rate=Decimal("0"),
        notes=data.get("notes", ""),
        status=Order.STATUS_PENDING,
        order_type=Order.ORDER_TYPE_REGULAR,
        source="table_qr",
        fulfillment_type=Order.FULFILLMENT_DINE_IN,
        table=table_instance,
        table_name_snapshot=table_instance.name,
        table_number_snapshot=table_instance.table_number,
        guest_session_id=data.get("guest_session_id", ""),
        guest_name_snapshot=data.get("guest_name", ""),
        kot_number=kot_number,
    )

    # Apply preparation routing
    order_items_data = prepare_order_items_for_routing(order, _item_rows(priced))

    created_items = _bulk_create_items_with_options(order, order_items_data, _option_rows(priced))
    persist_new_order(order, pricing_ctx, pricing, created_items)

    transaction.on_commit(lambda: _notify_safe(
        user=merchant.user,
        title="New guest order",
        message=f"Guest Order #{order.id} — Table {table_instance.table_number} — {merchant.currency_symbol} {pricing.grand_total}",
        notification_type=Notification.TYPE_NEW_ORDER,
        merchant_name=merchant.business_name,
        context_url="/merchant/orders",
        order_id=order.id,
        merchant_id=merchant.id,
    ))

    return Response(OrderSerializer(order).data, status=status.HTTP_201_CREATED)


guest_create_order.throttle_scope = "guest"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def preview_order(request):
    """
    POST /api/orders/preview/

    Return the server-computed price breakdown for a proposed cart WITHOUT
    creating anything. The customer UI shows this as the authoritative total
    before placing the order; the order itself is recomputed at creation.
    """
    serializer = CreateOrderSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data

    try:
        merchant = MerchantProfile.objects.get(id=data["merchant_id"])
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        priced = price_request_lines(merchant, data["items"])
    except PricingError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    fulfillment_type = data.get("fulfillment_type") or Order.FULFILLMENT_PICKUP
    if data.get("table_token"):
        fulfillment_type = Order.FULFILLMENT_DINE_IN

    offer = None
    if data.get("claim_id"):
        from offers.checkout import apply_offer_to_basket
        from offers.engine import OfferError
        customer = getattr(request.user, "customer_profile", None) if request.user.is_authenticated else None
        try:
            _claim, priced, evaluation = apply_offer_to_basket(
                claim_id=data["claim_id"], customer=customer, merchant=merchant, priced=priced,
                reward_choice=data.get("reward_choice"), fulfillment_type=fulfillment_type,
            )
            offer = {"eligible": True, "discount_amount": evaluation.discount_amount}
        except OfferError as exc:
            if exc.status == 404:
                return Response(exc.as_response_data(), status=exc.status)
            offer = {"eligible": False, **exc.as_response_data()}

    if offer and offer["eligible"]:
        from offers.engine import build_spec
        from orders.pricing import calculate, context_for_merchant, default_charges
        pricing = calculate(context_for_merchant(
            merchant, [p.line for p in priced],
            adjustments=(build_spec(_claim, [p.line for p in priced]),),
            charges=default_charges(merchant, fulfillment_type=fulfillment_type, order_type=Order.ORDER_TYPE_REGULAR),
        ))
    else:
        _, pricing = price_new_order_lines(
            merchant, priced, fulfillment_type=fulfillment_type, order_type=Order.ORDER_TYPE_REGULAR,
        )
    breakdown = pricing.to_dict()

    lines = []
    for p, priced_line in zip(priced, pricing.lines):
        lines.append({
            "menu_item_id": p.item_fields["menu_item"].id,
            "name": p.item_fields["name"],
            "is_reward": bool(p.item_fields.get("is_promotion_reward")),
            "discount": str(priced_line.discount),
            "quantity": p.item_fields["quantity"],
            "unit_price": str(priced_line.unit_price),
            "list_unit_price": str(priced_line.list_unit_price),
            "subtotal": str(priced_line.line_subtotal),
            "tax": str(priced_line.tax),
            "line_total": str(priced_line.total),
            "special_instructions": p.item_fields.get("special_instructions", ""),
            "options": [
                {
                    "group_name": opt.group_name,
                    "option_name": opt.option_name,
                    "kind": opt.kind,
                    "price_effect": str(opt.price_effect),
                }
                for opt in p.options
            ],
        })

    return Response({
        "merchant_id": merchant.id,
        "currency": {
            "code": merchant.currency_code,
            "symbol": merchant.currency_symbol,
        },
        "subtotal": breakdown["subtotal"],
        "discount_amount": breakdown["discount_total"],
        "taxable_amount": breakdown["taxable_total"],
        "tax_amount": breakdown["tax_total"],
        "tax_breakdown": breakdown["taxes"],
        "charges": breakdown["charges"],
        "service_charge": breakdown["charge_total"],
        "prices_include_tax": breakdown["prices_include_tax"],
        "total_amount": breakdown["grand_total"],
        "points_earned": estimate_points(priced),
        "lines": lines,
        "pricing": breakdown,
        "offer": offer,
    })


preview_order.throttle_scope = "guest"


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
def call_waiter(request):
    """
    POST /api/orders/call-waiter/

    Guest at a table requests waiter attention. Sends a notification to the
    merchant with the table number and guest name (if provided).

    Body: { merchant_id, table_token, guest_name? }
    """
    merchant_id = request.data.get("merchant_id")
    table_token = (request.data.get("table_token") or "").strip()
    guest_name = (request.data.get("guest_name") or "").strip()

    if not merchant_id or not table_token:
        return Response(
            {"error": "merchant_id and table_token are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        merchant = MerchantProfile.objects.get(id=merchant_id)
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant not found."}, status=status.HTTP_404_NOT_FOUND)

    if not merchant.table_ordering_enabled:
        return Response(
            {"error": "This merchant does not support table service."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from merchants.models import MerchantTable
    try:
        table = MerchantTable.objects.get(
            public_token=table_token,
            merchant=merchant,
            is_active=True,
        )
    except MerchantTable.DoesNotExist:
        return Response(
            {"error": "Invalid or inactive table. Please scan a valid table QR code."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Spam guard: at most one waiter call per table per 45s (keyed via audit log).
    from pos.models import PosAuditLog
    recent = PosAuditLog.objects.filter(
        merchant=merchant,
        action="waiter_call",
        entity_type="table",
        entity_id=str(table.id),
        created_at__gte=timezone.now() - timedelta(seconds=45),
    ).exists()
    if recent:
        return Response(
            {
                "message": "Your request was sent — a waiter will be with you shortly.",
                "delivered": True,
                "cooldown": True,
            }
        )

    waiter_message = f"Guest at Table {table.table_number}"
    if table.name and table.name != f"Table {table.table_number}":
        waiter_message += f" ({table.name})"
    if guest_name:
        waiter_message += f" — {guest_name}"

    _notify_safe(
        user=merchant.user,
        title="Waiter call 🔔",
        message=waiter_message,
        notification_type=Notification.TYPE_WAITER_CALL,
        merchant_name=merchant.business_name,
        context_url="/merchant/tables",
        merchant_id=merchant.id,
    )

    # Keep a traceable audit trail alongside notifications.
    try:
        PosAuditLog.objects.create(
            merchant=merchant,
            action="waiter_call",
            entity_type="table",
            entity_id=str(table.id),
            metadata={
                "table_number": table.table_number,
                "table_name": table.name,
                "guest_name": guest_name,
            },
        )
    except Exception:
        logger.exception("Audit write failed (waiter call continues)")

    return Response(
        {
            "message": "Your request was sent — a waiter will be with you shortly.",
            "delivered": True,
        }
    )


call_waiter.throttle_scope = "guest"


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def order_detail(request, pk):
    try:
        order = (
            Order.objects
            .prefetch_related("items__menu_item", "items__options")
            .select_related("customer__user", "merchant")
            .get(pk=pk)
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    user     = request.user
    is_owner = (
        (hasattr(user, "customer_profile") and order.customer == user.customer_profile)
        or (hasattr(user, "merchant_profile") and order.merchant == user.merchant_profile)
    )
    if not is_owner and not user.is_staff:
        return Response({"error": "Not authorised."}, status=status.HTTP_403_FORBIDDEN)

    return Response(OrderSerializer(order, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def order_pricing(request, pk):
    """
    GET /api/orders/<id>/pricing/ — the order's stored price breakdown (lines,
    discount allocations, charges, taxes) exactly as charged. Never re-computed.
    """
    try:
        order = Order.objects.select_related("merchant", "customer").get(pk=pk)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    user = request.user
    is_owner = (
        (hasattr(user, "customer_profile") and order.customer == user.customer_profile)
        or (hasattr(user, "merchant_profile") and order.merchant == user.merchant_profile)
    )
    if not is_owner and not user.is_staff:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    from orders.pricing.snapshot import order_pricing_snapshot
    return Response(order_pricing_snapshot(order))


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def update_order_status(request, pk):
    try:
        order = Order.objects.select_for_update(of=("self",)).select_related(
            "customer__user", "merchant"
        ).get(pk=pk)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        merchant = request.user.merchant_profile
    except MerchantProfile.DoesNotExist:
        return Response({"error": "Merchant access required."}, status=status.HTTP_403_FORBIDDEN)

    if order.merchant != merchant:
        return Response({"error": "This order does not belong to your store."}, status=status.HTTP_403_FORBIDDEN)

    new_status = request.data.get("status")
    if new_status not in dict(Order.STATUS_CHOICES):
        return Response(
            {"error": f"Invalid status. Choose from: {', '.join(dict(Order.STATUS_CHOICES).keys())}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if new_status == Order.STATUS_CANCELLED:
        # An employee in staff mode needs the "cancel orders" permission.
        from pos import rbac
        if not rbac.actor_can(request, "orders.cancel", merchant):
            return Response(
                {"error": "You don't have permission to cancel orders. Ask a manager.", "code": "no_permission"},
                status=status.HTTP_403_FORBIDDEN,
            )

    # Validate status transition
    if not order.can_transition_to(new_status):
        allowed = Order.VALID_TRANSITIONS.get(order.status, set())
        return Response(
            {
                "error": f"Cannot transition from '{order.status}' to '{new_status}'.",
                "current_status": order.status,
                "allowed_transitions": list(allowed),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Optimistic concurrency check
    client_version = request.data.get("version")
    if client_version is not None and client_version != order.version:
        return Response(
            {
                "error": "This order has been modified by another device.",
                "code": "VERSION_CONFLICT",
                "server_version": order.version,
                "client_version": client_version,
            },
            status=status.HTTP_409_CONFLICT,
        )

    # When order is completed:
    # - Regular orders: award loyalty points, punch card stamps, mission progress
    # - Reward redemption orders: deduct the held points from customer wallet
    if (
        new_status == Order.STATUS_COMPLETED
        and not order.loyalty_awarded
        and order.status != Order.STATUS_CANCELLED
        and order.customer is not None  # Only award loyalty for identified customers
    ):
        if (
            order.order_type == Order.ORDER_TYPE_REWARD_REDEMPTION
            and order.reward_redemption
        ):
            _deduct_reward_redemption_points(order)
        else:
            _award_loyalty(order)
        order.loyalty_awarded = True

    _previous_status = order.status
    order.status = new_status
    order.version += 1
    order.save(update_fields=["status", "loyalty_awarded", "version", "updated_at"])

    # Accepting a pending dine-in order consumes its linked stock; cancelling
    # puts back whatever was consumed.
    if _previous_status == Order.STATUS_PENDING and new_status == Order.STATUS_CONFIRMED:
        safe_deduct_stock_for_order(order, performed_by=request.user)
    elif new_status == Order.STATUS_CANCELLED:
        safe_restore_stock_for_order(order, performed_by=request.user)

    try:
        _audit_order(
            order, "order_status_change",
            metadata={"from": _previous_status, "to": new_status,
                      "points_awarded": order.points_earned,
                      "by": str(request.user.id)},
        )
    except Exception:
        logger.exception("Audit failed for status change (order flow continues)")

    status_msg = {
        "confirmed": "Your order has been accepted!",
        "preparing": "Your order is being prepared",
        "ready":     "Your order is ready for pickup!",
        "completed": "Order complete!",
    }.get(new_status, f"Your order is now {new_status}.")

    # Notify customer (only if order has an associated customer).
    # Completed regular orders are skipped here — _award_loyalty already
    # sent a richer points/completion notification.
    is_regular_completion = (
        new_status == Order.STATUS_COMPLETED
        and order.order_type != Order.ORDER_TYPE_REWARD_REDEMPTION
    )
    if order.customer and order.customer.user and not is_regular_completion:
        transaction.on_commit(lambda: _notify_safe(
            user=order.customer.user,
            title="Order update",
            message=status_msg,
            notification_type=Notification.TYPE_ORDER_UPDATE,
            merchant_name=order.merchant.business_name,
            context_url=f"/orders/{order.id}",
            order_id=order.id,
            merchant_id=order.merchant.id,
        ))

    return Response(OrderSerializer(order).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def cancel_order(request, pk):
    try:
        order = Order.objects.select_for_update(of=("self",)).select_related(
            "customer__user", "merchant__user"
        ).get(pk=pk)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    reason = request.data.get("reason", "")
    user   = request.user

    # Determine who is cancelling
    is_customer = hasattr(user, "customer_profile") and order.customer == user.customer_profile
    is_merchant = hasattr(user, "merchant_profile") and order.merchant == user.merchant_profile

    if not is_customer and not is_merchant:
        return Response({"error": "Not authorised."}, status=status.HTTP_403_FORBIDDEN)

    # Customers can only cancel pending orders
    if is_customer and order.status != Order.STATUS_PENDING:
        return Response(
            {"error": "You can only cancel pending orders."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Merchants can cancel pending or confirmed orders
    if is_merchant and order.status not in [Order.STATUS_PENDING, Order.STATUS_CONFIRMED]:
        return Response(
            {"error": "You can only cancel pending or confirmed orders."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    order.status       = Order.STATUS_CANCELLED
    order.cancelled_by = Order.CANCELLED_BY_CUSTOMER if is_customer else Order.CANCELLED_BY_MERCHANT
    order.cancellation_reason = reason

    # Reward redemptions deduct points at redemption time — refund them now
    # (idempotent, guarded by a REDEMPTION_REFUND transaction check).
    is_reward_redemption = (
        order.order_type == Order.ORDER_TYPE_REWARD_REDEMPTION
        and order.reward_redemption_id is not None
    )
    if is_reward_redemption:
        _refund_reward_redemption_points(order)

    order.save(update_fields=["status", "cancelled_by", "cancellation_reason", "updated_at"])

    safe_restore_stock_for_order(order, performed_by=request.user)

    _audit_order(
        order,
        "order_cancelled",
        metadata={
            "by": "customer" if is_customer else "merchant",
            "reason": reason,
            "refunded": is_reward_redemption,
            "actor": str(request.user.id),
        },
    )

    reason_label = dict(Order.CANCEL_REASON_CHOICES).get(reason, "")

    if is_customer:
        msg = f"Order #{order.id} was cancelled by customer"
        if reason_label:
            msg += f" — {reason_label}"
        transaction.on_commit(lambda: _notify_safe(
            user=order.merchant.user,
            title="Order cancelled",
            message=msg,
            notification_type=Notification.TYPE_ORDER_UPDATE,
            merchant_name=order.merchant.business_name,
            context_url="/merchant/orders",
            order_id=order.id,
            merchant_id=order.merchant.id,
        ))
    else:
        msg = f"Your order at {order.merchant.business_name} was cancelled"
        if reason_label:
            msg += f" — {reason_label}"
        transaction.on_commit(lambda: _notify_safe(
            user=order.customer.user,
            title="Order cancelled",
            message=msg,
            notification_type=Notification.TYPE_ORDER_UPDATE,
            merchant_name=order.merchant.business_name,
            context_url=f"/orders/{order.id}",
            order_id=order.id,
            merchant_id=order.merchant.id,
        ))
    return Response(OrderSerializer(order).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@transaction.atomic
def add_items_to_order(request, pk):
    """Append items to an existing order (same bill).

    Allowed while the order is pending/confirmed/preparing *and* uncollected, so
    a dine-in ticket can be built up across courses. Refused once a payment
    exists -- use the refund flow instead of reopening a settled bill.
    """
    try:
        order = Order.objects.select_for_update(of=("self",)).select_related(
            "customer__user", "merchant"
        ).prefetch_related("items").get(pk=pk)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        customer = request.user.customer_profile
    except CustomerProfile.DoesNotExist:
        customer = None

    is_customer_owner = customer is not None and order.customer == customer

    try:
        merchant_profile = request.user.merchant_profile
    except MerchantProfile.DoesNotExist:
        merchant_profile = None

    is_merchant_owner = merchant_profile is not None and order.merchant == merchant_profile

    if not is_customer_owner and not is_merchant_owner:
        return Response({"error": "Not authorised."}, status=status.HTTP_403_FORBIDDEN)

    if order.status not in (Order.STATUS_PENDING, Order.STATUS_CONFIRMED, Order.STATUS_PREPARING):
        return Response(
            {"error": "Items can only be added to pending, confirmed, or preparing orders."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # A status check alone is not enough. Dine-in orders sit in `confirmed` or
    # `preparing` precisely so staff can keep adding items before the bill is
    # settled -- but once any money has been taken the total is already
    # collected, so appending lines would silently under-charge (and desync the
    # recorded tender from the bill). Refunds must go through the refund flow,
    # which is auditable; silently re-opening a paid order is not.
    if order.payment_status in ("paid", "partially_paid", "refunded"):
        return Response(
            {
                "error": (
                    "This order has already been paid and can no longer be "
                    "changed. Issue a refund or create a new order instead."
                ),
                "payment_status": order.payment_status,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    serializer = AddItemsToOrderSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    data = serializer.validated_data
    merchant = order.merchant

    if order.pricing_locked_at:
        return Response(
            {"error": "This order's bill is final and can no longer be changed."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── Server-side authoritative pricing for added items ─────────────────────
    try:
        priced = price_request_lines(merchant, data["items"])
    except PricingError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    # Apply preparation routing for new items
    new_items_data = prepare_order_items_for_routing(order, _item_rows(priced))

    created_items = _bulk_create_items_with_options(order, new_items_data, _option_rows(priced))

    # Items added to an already-confirmed dine-in order consume stock now;
    # a pending order's items are consumed when it is confirmed.
    if order.status != Order.STATUS_PENDING:
        safe_deduct_stock_for_order(order, lines=created_items, performed_by=request.user)

    # Drop the stale prefetch cache so the re-price sees the new rows.
    order._prefetched_objects_cache.pop("items", None)

    # Re-price the whole bill: tax, charges and any attached discount are
    # recalculated (and the discount re-validated) for the new basket.
    pricing = reprice_order(order)
    order.points_earned += estimate_points(priced, order.loyalty_spend_rate)
    order.version += 1
    order.save(update_fields=["points_earned", "version", "updated_at"])

    # Append notes if provided
    new_notes = data.get("notes", "").strip()
    if new_notes:
        if order.notes:
            order.notes = f"{order.notes}\n{new_notes}"
        else:
            order.notes = new_notes
        order.save(update_fields=["notes", "updated_at"])

    # Notify merchant
    added_by = "merchant" if is_merchant_owner else "customer"
    transaction.on_commit(lambda: _notify_safe(
        user=merchant.user,
        title="Order updated 🔄",
        message=f"Order #{order.id} — {len(created_items)} item(s) added by {added_by}",
        notification_type=Notification.TYPE_NEW_ORDER,
        merchant_name=merchant.business_name,
        context_url="/merchant/orders",
        order_id=order.id,
        merchant_id=merchant.id,
    ))

    data = OrderSerializer(order, context={"request": request}).data
    data["pricing_messages"] = pricing.messages
    return Response(data)


# Add these two views to orders/views.py
# They enforce the 1-month (customer) and 2-month (merchant) limits
# and support search + status filtering via query params


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def customer_order_history(request):
    
    try:
        customer = request.user.customer_profile
    except CustomerProfile.DoesNotExist:
        return Response({"error": "No customer profile."}, status=403)

    one_month_ago = timezone.now() - timedelta(days=30)
    qs = _order_qs().filter(
        customer=customer,
        created_at__gte=one_month_ago,
    ).order_by("-created_at")

    search = request.query_params.get("search", "").strip()
    if search:
        qs = qs.filter(
            Q(id__icontains=search) |
            Q(items__name__icontains=search) |
            Q(merchant__business_name__icontains=search)
        ).distinct()

    status_filter = request.query_params.get("status", "").strip()
    if status_filter:
        qs = qs.filter(status=status_filter)

    qs = _paginate(request, qs)
    from .serializers import OrderSerializer
    return Response(OrderSerializer(qs, many=True, context={"request": request}).data)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def customer_clear_order_history(request):
    """
    DELETE /api/orders/history/clear/
    Soft-clears: marks orders as hidden from history (doesn't delete DB rows).
    If you want hard delete, swap the update() for delete().
    """
    from accounts.models import CustomerProfile
    try:
        customer = request.user.customer_profile
    except CustomerProfile.DoesNotExist:
        return Response({"error": "No customer profile."}, status=403)

    one_month_ago = timezone.now() - timedelta(days=30)
    # Hard delete old orders from customer's history view
    Order.objects.filter(
        customer=customer,
        created_at__gte=one_month_ago,
        status__in=["completed", "cancelled"],
    ).delete()

    return Response({"status": "cleared"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merchant_order_history(request):
    """
    GET /api/orders/merchant-history/
    Returns merchant orders from the last 60 days.
    Query params:
      ?search=<text>      — filter by order id, customer name, or item name
      ?status=<status>    — filter by status
      ?date_from=YYYY-MM-DD  — start date (inclusive)
      ?date_to=YYYY-MM-DD    — end date (inclusive)
    """
    from merchants.models import MerchantProfile
    from datetime import datetime as dt
    try:
        merchant = request.user.merchant_profile
    except MerchantProfile.DoesNotExist:
        return Response({"error": "No merchant profile."}, status=403)

    two_months_ago = timezone.now() - timedelta(days=60)
    qs = _order_qs().filter(
        merchant=merchant,
        created_at__gte=two_months_ago,
    ).order_by("-created_at")

    search = request.query_params.get("search", "").strip()
    if search:
        qs = qs.filter(
            Q(id__icontains=search) |
            Q(items__name__icontains=search) |
            Q(customer__full_name__icontains=search) |
            Q(customer__user__email__icontains=search)
        ).distinct()

    status_filter = request.query_params.get("status", "").strip()
    if status_filter:
        qs = qs.filter(status=status_filter)

    date_from = request.query_params.get("date_from", "").strip()
    if date_from:
        try:
            parsed = dt.strptime(date_from, "%Y-%m-%d")
            qs = qs.filter(created_at__date__gte=parsed.date())
        except ValueError:
            pass

    date_to = request.query_params.get("date_to", "").strip()
    if date_to:
        try:
            parsed = dt.strptime(date_to, "%Y-%m-%d")
            qs = qs.filter(created_at__date__lte=parsed.date())
        except ValueError:
            pass

    qs = _paginate(request, qs)
    from .serializers import OrderSerializer
    return Response(OrderSerializer(qs, many=True).data)