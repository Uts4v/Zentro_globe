"""
Online checkout with a claimed offer: shared by order preview and order creation
so the customer sees exactly what the order will get.
"""

from __future__ import annotations

from .engine import (
    CHANNEL_ONLINE,
    OfferError,
    evaluate_lines,
    load_claim,
    reason_message,
    reward_options,
    validate_reward_choice,
)
from .models import VoucherClaim


def apply_offer_to_basket(*, claim_id, customer, merchant, priced, reward_choice, fulfillment_type):
    """
    Returns ``(claim, priced_lines, evaluation)`` for a basket, adding the chosen
    reward item as a real line. Raises OfferError with a customer-facing message
    when the offer cannot be used on it.
    """
    from orders.pricing import PricingError, default_charges, mark_reward, price_request_lines

    try:
        claim = load_claim(int(claim_id))
    except (VoucherClaim.DoesNotExist, TypeError, ValueError):
        raise OfferError("Offer not found.", code="NOT_FOUND", status=404)
    if customer is None or claim.customer_id != customer.pk:
        raise OfferError("Offer not found.", code="NOT_FOUND", status=404)

    priced = list(priced)
    if reward_choice:
        row = validate_reward_choice(claim, reward_choice)
        try:
            priced += [mark_reward(p) for p in price_request_lines(merchant, [row], key_prefix="reward")]
        except PricingError as exc:
            raise OfferError(str(exc), code="INVALID_REWARD")

    charges = default_charges(merchant, fulfillment_type=fulfillment_type, order_type="regular")
    evaluation = evaluate_lines(claim, merchant, [p.line for p in priced], channel=CHANNEL_ONLINE, charges=charges)
    if not evaluation.eligible:
        details = {"reason": evaluation.reason}
        if (evaluation.reason or {}).get("code") == "REWARD_ITEM_REQUIRED":
            details["reward_options"] = [o.__dict__ for o in (evaluation.reward_options or reward_options(claim.campaign))]
        raise OfferError(
            reason_message(evaluation.reason, merchant),
            code=(evaluation.reason or {}).get("code") or "NOT_ELIGIBLE",
            details=details,
        )
    return claim, priced, evaluation
