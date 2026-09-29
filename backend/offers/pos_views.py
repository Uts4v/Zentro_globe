"""
POS offer endpoints — mounted at /api/offers/pos/.

A screenshot is never proof: every step here asks the server whether the
code is valid for *this* merchant, and redemption only happens through the
engine. Unknown codes and other merchants' codes get the same answer, and
repeated bad codes lock the terminal's lookups for a few minutes.
"""

from __future__ import annotations

from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from orders.models import Order
from pos.models import PosAuditLog, ShiftWorker
from pos.permissions import IsMerchantUser, IsPosEnabled

from .engine import (
    CHANNEL_IN_STORE,
    OfferError,
    check_usable,
    evaluate_lines,
    redeem_in_store,
    release_claim,
    reserve_for_order,
    resolve_scan,
    validate_reward_choice,
)
from .models import VoucherClaim
from .serializers import describe_benefit, describe_conditions
from .views import _scoped_throttle

OfferLookupThrottle = _scoped_throttle("offer_lookup")

LOCKOUT_ATTEMPTS = 10
LOCKOUT_SECONDS = 300
INVALID = {"error": "Invalid or unknown offer code.", "code": "INVALID_CODE"}


def _lockout_key(request, merchant) -> str:
    return f"offers:lookup_fail:{merchant.pk}:{request.user.pk}"


def _locked_out(request, merchant) -> bool:
    return (cache.get(_lockout_key(request, merchant)) or 0) >= LOCKOUT_ATTEMPTS


def _record_failure(request, merchant) -> None:
    key = _lockout_key(request, merchant)
    if cache.add(key, 1, LOCKOUT_SECONDS):
        return
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, LOCKOUT_SECONDS)
        return
    if count == LOCKOUT_ATTEMPTS:
        PosAuditLog.objects.create(
            merchant=merchant, user=request.user, action=PosAuditLog.ACTION_ORDER_UPDATE,
            entity_type="offer_lookup", metadata={"event": "lookup_locked", "attempts": count},
        )


def resolve_or_error(request, merchant, raw):
    """(claim, error_response)."""
    if _locked_out(request, merchant):
        return None, Response(
            {"error": "Too many invalid codes. Try again in a few minutes.", "code": "LOOKUP_LOCKED"},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    claim = resolve_scan(merchant, str(raw or ""))
    if claim is None:
        _record_failure(request, merchant)
        return None, Response(INVALID, status=status.HTTP_404_NOT_FOUND)
    cache.delete(_lockout_key(request, merchant))
    return claim, None


def _worker(merchant, worker_id):
    try:
        return ShiftWorker.objects.get(id=worker_id, merchant=merchant, is_active=True)
    except (ShiftWorker.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        return None


def claim_card(claim) -> dict:
    campaign = claim.campaign
    first_name = (claim.customer.full_name or "").split(" ")[0] if claim.customer_id else ""
    from .engine import bill_label, needs_bill_amount

    return {
        "claim_id": claim.id,
        "code": claim.display_code,
        "needs_bill_amount": needs_bill_amount(campaign),
        "bill_label": bill_label(campaign),
        "status": claim.customer_status(),
        "customer_first_name": first_name,
        "uses_remaining": claim.uses_remaining,
        "expires_at": claim.expires_at,
        "offer": {
            "id": campaign.id,
            "title": campaign.title,
            "summary": describe_benefit(campaign),
            "conditions": describe_conditions(campaign),
            "benefit_kind": campaign.benefit.kind,
        },
    }


def _order(merchant, order_id, *, lock=False):
    qs = Order.objects.select_related("merchant")
    if lock:
        qs = qs.select_for_update(of=("self",))
    try:
        return qs.get(uuid=order_id, merchant=merchant)
    except (Order.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        return None


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@throttle_classes([OfferLookupThrottle])
def pos_offer_lookup(request):
    """
    POST {code, items?, order_id?, fulfillment_type?} — what is this code worth here?
    Returns the offer and, given a basket or order, the discount the server would apply.
    """
    from orders.pricing import (
        PricingError, default_charges, line_from_order_item, order_items_for_pricing, price_request_lines,
    )

    merchant = request.user.merchant_profile
    claim, error = resolve_or_error(request, merchant, request.data.get("code"))
    if error:
        return error
    claim = type(claim).objects.select_related("campaign", "campaign__benefit", "customer", "merchant").get(pk=claim.pk)
    from django.db.models import prefetch_related_objects
    prefetch_related_objects([claim.campaign], "targets__menu_item", "targets__category",
                             "targets__option__group__menu_item", "conditions")

    data = claim_card(claim)
    order = None
    lines = None
    charges = ()
    if request.data.get("order_id"):
        order = _order(merchant, request.data["order_id"])
        if order is None:
            return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
        lines = [line_from_order_item(i) for i in order_items_for_pricing(order)]
    elif request.data.get("items"):
        try:
            lines = [p.line for p in price_request_lines(merchant, request.data["items"])]
        except PricingError as exc:
            return Response({"error": str(exc), "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)
        charges = default_charges(
            merchant, fulfillment_type=_fulfillment(request.data.get("fulfillment_type")), order_type="regular",
        )

    if lines is not None:
        data["evaluation"] = evaluate_lines(
            claim, merchant, lines, channel=CHANNEL_IN_STORE, order=order, charges=charges,
        ).as_dict()
    else:
        try:
            check_usable(claim, merchant=merchant, channel=CHANNEL_IN_STORE)
            data["evaluation"] = {"eligible": True, "reason": None}
        except OfferError as exc:
            data["evaluation"] = {"eligible": False, "reason": {"code": exc.code, "message": str(exc)}}
    return Response(data)


def _fulfillment(value):
    return {"dine-in": "dine_in", "takeaway": "pickup", "take-away": "pickup"}.get(value or "", value)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@throttle_classes([OfferLookupThrottle])
@transaction.atomic
def pos_offer_apply(request):
    """
    POST {order_id, code, worker_id, reward_choice?} — apply a customer's offer to an
    open POS order. A chosen free item is added as a real order line first.
    """
    from orders.pricing import PricingError, mark_reward, price_request_lines
    from orders.services.preparation import prepare_order_items_for_routing
    from orders.views import _bulk_create_items_with_options

    merchant = request.user.merchant_profile
    worker = _worker(merchant, request.data.get("worker_id"))
    if worker is None:
        return Response({"error": "Worker not found."}, status=status.HTTP_404_NOT_FOUND)
    order = _order(merchant, request.data.get("order_id"), lock=True)
    if order is None:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
    if order.pricing_locked_at or order.status == Order.STATUS_CANCELLED:
        return Response({"error": "This order is already settled."}, status=status.HTTP_400_BAD_REQUEST)
    claim, error = resolve_or_error(request, merchant, request.data.get("code"))
    if error:
        return error

    added = []
    try:
        if request.data.get("reward_choice"):
            row = validate_reward_choice(claim, request.data["reward_choice"])
            priced = [mark_reward(p) for p in price_request_lines(merchant, [row], key_prefix="reward")]
            rows = prepare_order_items_for_routing(order, [dict(p.item_fields) for p in priced])
            added = _bulk_create_items_with_options(order, rows, [(i, p.options) for i, p in enumerate(priced)])
            if order.status != Order.STATUS_PENDING:
                from inventory.order_stock import safe_deduct_stock_for_order
                safe_deduct_stock_for_order(order, lines=added, performed_by=request.user)
        result = reserve_for_order(claim, order, channel=CHANNEL_IN_STORE, created_by=request.user)
    except (OfferError, PricingError) as exc:
        transaction.set_rollback(True)
        if isinstance(exc, OfferError):
            return Response(exc.as_response_data(), status=exc.status)
        return Response({"error": str(exc), "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)

    promo = next((d for d in result.discounts if d.kind == "promotion"), None)
    if promo is None or not promo.eligible:
        # Nothing to give on this bill: undo, so the voucher is not tied up.
        transaction.set_rollback(True)
        reason = (promo.reason if promo else None) or {"code": "NOT_ELIGIBLE"}
        payload = {"error": "This offer doesn't apply to this order yet.", "code": reason.get("code"), "reason": reason}
        if reason.get("code") == "REWARD_ITEM_REQUIRED":
            from .engine import reward_options
            payload["reward_options"] = [o.__dict__ for o in reward_options(claim.campaign)]
        return Response(payload, status=status.HTTP_400_BAD_REQUEST)

    order.version += 1
    order.save(update_fields=["version", "updated_at"])
    PosAuditLog.objects.create(
        merchant=merchant, worker=worker, user=request.user, action=PosAuditLog.ACTION_DISCOUNT_APPLY,
        entity_type="offer", entity_id=str(order.id),
        metadata={"claim_id": claim.id, "campaign_id": claim.campaign_id, "amount": str(promo.amount),
                  "reward_line_ids": [i.id for i in added]},
    )
    return Response({"order_id": str(order.uuid), "discount_amount": str(promo.amount), "pricing": result.to_dict()})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def pos_offer_remove(request):
    """POST {order_id, worker_id} — take the offer off an open order (the voucher is freed)."""
    merchant = request.user.merchant_profile
    worker = _worker(merchant, request.data.get("worker_id"))
    if worker is None:
        return Response({"error": "Worker not found."}, status=status.HTTP_404_NOT_FOUND)
    order = _order(merchant, request.data.get("order_id"), lock=True)
    if order is None:
        return Response({"error": "Order not found."}, status=status.HTTP_404_NOT_FOUND)
    if order.pricing_locked_at:
        return Response({"error": "This order is already settled."}, status=status.HTTP_400_BAD_REQUEST)
    claim_ids = list(VoucherClaim.objects.filter(
        reserved_order=order, status=VoucherClaim.STATUS_RESERVED,
    ).values_list("pk", flat=True))
    if not claim_ids:
        return Response({"error": "No offer is applied to this order."}, status=status.HTTP_400_BAD_REQUEST)
    for claim_id in claim_ids:
        release_claim(claim_id, order=order)
    order.version += 1
    order.save(update_fields=["version", "updated_at"])
    PosAuditLog.objects.create(
        merchant=merchant, worker=worker, user=request.user, action=PosAuditLog.ACTION_ORDER_UPDATE,
        entity_type="offer", entity_id=str(order.id), metadata={"event": "offer_removed", "claims": claim_ids},
    )
    has_reward_lines = order.items.filter(is_promotion_reward=True).exists()
    return Response({
        "order_id": str(order.uuid),
        "note": "The free item stays on the bill at its normal price. Remove it if the customer no longer wants it."
        if has_reward_lines else "",
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@throttle_classes([OfferLookupThrottle])
def pos_offer_redeem_in_store(request):
    """
    POST {code, worker_id, idempotency_key} — confirm an offer at the counter when
    the sale isn't rung up as a Zentro order (e.g. a salon service).
    """
    merchant = request.user.merchant_profile
    worker = _worker(merchant, request.data.get("worker_id"))
    if worker is None:
        return Response({"error": "Worker not found."}, status=status.HTTP_404_NOT_FOUND)
    from .views import parse_bill_amount

    amount, error = parse_bill_amount(request.data.get("bill_amount"))
    if error:
        return error
    claim, error = resolve_or_error(request, merchant, request.data.get("code"))
    if error:
        return error
    try:
        redemption, created = redeem_in_store(
            claim.pk, merchant, worker=worker, user=request.user,
            idempotency_key=str(request.data.get("idempotency_key") or ""),
            bill_amount=amount,
        )
    except OfferError as exc:
        return Response(exc.as_response_data(), status=exc.status)
    return Response(
        {
            "redemption_id": redemption.id,
            "discount_amount": str(redemption.discount_amount) if redemption.discount_amount is not None else None,
            "claim": claim_card(redemption.claim) if redemption.claim_id else None,
        },
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )
