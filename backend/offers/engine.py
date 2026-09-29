"""
PromotionEngine: the only place offer rules live.

    claim_offer        customer saves an offer → VoucherClaim with code + QR
    build_spec         a claim's benefit against an order's lines → AdjustmentSpec
                       (the pricing engine turns it into money)
    reserve_for_order  attach a claim to an open order (claim → reserved)
    finalize_order     order paid/completed → redeem; cancelled/refunded →
                       release or void (called from the Order post_save signal)
    release_claim      detach from an order that is still open
    redeem_in_store    counter confirmation with no Zentro order

Locking order is always: campaign row, then claim row (then the caller's
order row is already held). Every counter change happens under that lock.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import F, Q, prefetch_related_objects
from django.utils import timezone

from orders.pricing import (
    ADJ_PROMOTION,
    PricingContext,
    CALC_FIXED,
    CALC_LINES,
    AdjustmentSpec,
    attach_adjustment,
    calculate,
    context_for_merchant,
    currency_quantum,
    quantize,
    reprice_order,
    to_decimal,
)

from .codes import generate_code, generate_qr_token, parse_scan
from .models import (
    PromotionBenefit,
    PromotionCampaign,
    PromotionCondition,
    PromotionDailyStats,
    PromotionTarget,
    VoucherClaim,
    VoucherRedemption,
)

logger = logging.getLogger(__name__)

ZERO = Decimal("0")
HUNDRED = Decimal("100")

CHANNEL_ONLINE = "online"
CHANNEL_IN_STORE = "in_store"


class OfferError(Exception):
    """A refusal the customer or cashier should see, with a machine-readable code."""

    def __init__(self, message: str, *, code: str, status: int = 400, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details or {}

    def as_response_data(self) -> dict:
        return {"error": str(self), "code": self.code, **self.details}


def source_ref_for(claim) -> str:
    return f"voucher_claim:{claim.pk}"


def claim_id_from_ref(ref: str) -> int | None:
    if ref and ref.startswith("voucher_claim:"):
        try:
            return int(ref.split(":", 1)[1])
        except ValueError:
            return None
    return None


# ── Stats ─────────────────────────────────────────────────────────────────────

def bump_stats(campaign_id: int, day=None, **increments) -> None:
    day = day or timezone.localdate()
    row, _ = PromotionDailyStats.objects.get_or_create(campaign_id=campaign_id, date=day)
    PromotionDailyStats.objects.filter(pk=row.pk).update(
        **{name: F(name) + value for name, value in increments.items()}
    )


def record_view(campaign, viewer_key: str) -> None:
    """Count a detail view; unique viewers are de-duplicated per viewer per day."""
    today = timezone.localdate()
    unique = cache.add(f"offers:viewed:{campaign.pk}:{today}:{viewer_key}", 1, 60 * 60 * 26)
    bump_stats(campaign.pk, today, views=1, **({"unique_viewers": 1} if unique else {}))


# ── Claiming ──────────────────────────────────────────────────────────────────

def _claim_expiry(campaign, now):
    candidates = []
    if campaign.ends_at:
        candidates.append(campaign.ends_at)
    if campaign.claim_valid_days:
        candidates.append(now + timedelta(days=campaign.claim_valid_days))
    return min(candidates) if candidates else None


def claim_offer(campaign_id: int, customer, *, source=VoucherClaim.SOURCE_MARKETPLACE, link_token: str = ""):
    """Returns ``(claim, created)``. Claiming again returns the existing claim."""
    now = timezone.now()
    with transaction.atomic():
        try:
            campaign = (
                PromotionCampaign.objects.select_for_update()
                .select_related("merchant")
                .get(pk=campaign_id)
            )
        except PromotionCampaign.DoesNotExist:
            raise OfferError("Offer not found.", code="NOT_FOUND", status=404)

        existing = VoucherClaim.objects.filter(campaign=campaign, customer=customer).first()
        if existing:
            return existing, False

        if campaign.visibility == PromotionCampaign.VISIBILITY_LINK:
            if not link_token or link_token != campaign.link_token:
                raise OfferError("Offer not found.", code="NOT_FOUND", status=404)
            source = VoucherClaim.SOURCE_LINK
        if not campaign.merchant.is_approved or campaign.is_hidden_by_admin:
            raise OfferError("Offer not found.", code="NOT_FOUND", status=404)

        state = campaign.effective_status(now)
        if state == "scheduled":
            raise OfferError("This offer hasn't started yet.", code="NOT_STARTED")
        if state != "active":
            raise OfferError("This offer is no longer available.", code="NOT_CLAIMABLE")
        if campaign.max_claims is not None and campaign.claims_count >= campaign.max_claims:
            raise OfferError("All of these offers have been claimed.", code="LIMIT_REACHED")

        claim = None
        for _ in range(5):
            try:
                with transaction.atomic():
                    claim = VoucherClaim.objects.create(
                        campaign=campaign,
                        customer=customer,
                        merchant=campaign.merchant,
                        code=generate_code(),
                        qr_token=generate_qr_token(),
                        uses_allowed=campaign.per_customer_limit,
                        source=source,
                        campaign_version=campaign.version,
                        expires_at=_claim_expiry(campaign, now),
                    )
                break
            except IntegrityError:
                # A code/token collision (astronomically unlikely) or a
                # concurrent claim by the same customer.
                existing = VoucherClaim.objects.filter(campaign=campaign, customer=customer).first()
                if existing:
                    return existing, False
        if claim is None:
            raise OfferError("Could not create your offer. Please try again.", code="CLAIM_FAILED", status=503)

        PromotionCampaign.objects.filter(pk=campaign.pk).update(claims_count=F("claims_count") + 1)
        bump_stats(campaign.pk, claims=1)
    return claim, True


# ── Can this claim be used here? ─────────────────────────────────────────────

def check_usable(claim, *, merchant, channel: str, order=None, now=None) -> None:
    """Raise OfferError when ``claim`` cannot be used for ``merchant``/``channel``/``order``."""
    now = now or timezone.now()
    campaign = claim.campaign
    reserved_here = order is not None and claim.status == VoucherClaim.STATUS_RESERVED and claim.reserved_order_id == order.pk

    if claim.merchant_id != merchant.pk:
        raise OfferError(
            f"This offer is for {claim.merchant.business_name}.", code="WRONG_MERCHANT",
        )
    if claim.status == VoucherClaim.STATUS_REVOKED or campaign.status in (
        PromotionCampaign.STATUS_DRAFT, PromotionCampaign.STATUS_ARCHIVED,
    ) or campaign.is_hidden_by_admin:
        raise OfferError("This offer has been withdrawn by the merchant.", code="CLAIM_REVOKED")
    if claim.status == VoucherClaim.STATUS_REDEEMED or claim.uses_remaining <= 0:
        raise OfferError("This offer has already been used.", code="CLAIM_USED")
    if claim.status == VoucherClaim.STATUS_RESERVED and not reserved_here:
        raise OfferError("This offer is already applied to another order.", code="CLAIM_IN_USE")
    if not reserved_here and (claim.status == VoucherClaim.STATUS_EXPIRED or claim.is_expired(now)):
        raise OfferError("This offer has expired.", code="CLAIM_EXPIRED")
    if campaign.effective_status(now) == "scheduled":
        raise OfferError("This offer hasn't started yet.", code="NOT_STARTED")
    if campaign.channels == PromotionCampaign.CHANNEL_ONLINE and channel != CHANNEL_ONLINE:
        raise OfferError("This offer can only be used for online orders.", code="CHANNEL")
    if campaign.channels == PromotionCampaign.CHANNEL_IN_STORE and channel != CHANNEL_IN_STORE:
        raise OfferError("This offer can only be used in store.", code="CHANNEL")
    if (
        not reserved_here
        and campaign.max_redemptions is not None
        and campaign.redemptions_count + campaign.reserved_count >= campaign.max_redemptions
    ):
        raise OfferError("This offer has run out.", code="LIMIT_REACHED")


# ── Turning a benefit into an AdjustmentSpec ─────────────────────────────────

@dataclass
class RewardOption:
    menu_item_id: int
    name: str
    price: str
    selections: list = field(default_factory=list)


@dataclass
class _Targets:
    items: set
    categories: set
    options: set

    def matches(self, line) -> bool:
        return (
            (line.menu_item_id is not None and line.menu_item_id in self.items)
            or (line.category_id is not None and line.category_id in self.categories)
            or bool(line.option_ids & self.options)
        )

    def __bool__(self):
        return bool(self.items or self.categories or self.options)


def _targets(campaign, role) -> _Targets:
    t = _Targets(set(), set(), set())
    for target in campaign.targets.all():
        if target.role != role:
            continue
        if target.menu_item_id:
            t.items.add(target.menu_item_id)
        elif target.category_id:
            t.categories.add(target.category_id)
        elif target.option_id:
            t.options.add(target.option_id)
    return t


def _excluded(campaign, line) -> bool:
    return campaign.exclude_discounted_items and line.list_unit_price > line.unit_price


def _reward_unit_value(benefit, line) -> Decimal:
    value = line.unit_price if benefit.include_modifiers else line.unit_price - line.modifier_unit_total
    return max(to_decimal(value), ZERO)


def reward_options(campaign, *, limit: int = 30) -> list[RewardOption]:
    """Menu items a customer (or cashier) can pick as the free/reward item."""
    from merchants.models import MenuItem, MenuOption

    targets = _targets(campaign, PromotionTarget.ROLE_BENEFIT)
    if not targets:
        return []
    base = MenuItem.objects.filter(
        merchant=campaign.merchant, status=MenuItem.STATUS_ACTIVE, is_available=True,
    )
    options = []
    seen = set()
    for item in base.filter(Q(id__in=targets.items) | Q(category_ref_id__in=targets.categories)).order_by("price", "name")[:limit]:
        seen.add(item.id)
        options.append(RewardOption(menu_item_id=item.id, name=item.name, price=str(item.price)))
    if targets.options:
        for opt in (
            MenuOption.objects.filter(
                id__in=targets.options, is_available=True, group__is_active=True,
                group__menu_item__in=base,
            ).select_related("group", "group__menu_item")[:limit]
        ):
            item = opt.group.menu_item
            options.append(RewardOption(
                menu_item_id=item.id,
                name=f"{item.name} — {opt.name}",
                price=str(opt.price if opt.price is not None else item.price),
                selections=[{"group_id": opt.group_id, "option_id": opt.id}],
            ))
    return options[:limit]


def _units(lines, predicate, benefit=None):
    """Expand lines into (sort_key, line_key, unit_value) units."""
    units = []
    for line in lines:
        if not predicate(line):
            continue
        value = _reward_unit_value(benefit, line) if benefit is not None else to_decimal(line.unit_price)
        for i in range(line.quantity):
            units.append((line.key, value, line.is_reward, i))
    return units


def build_spec(claim, lines) -> AdjustmentSpec:
    """
    The claim's benefit against ``lines`` (pricing LineInputs). Rules that fail
    produce a spec with ``forced_reason`` so the order still prices normally
    and the UI can say exactly what is missing.
    """
    campaign = claim.campaign
    benefit = campaign.benefit
    quantum = currency_quantum(campaign.currency_code)
    common = {
        "kind": ADJ_PROMOTION,
        "label": campaign.title,
        "max_amount": to_decimal(campaign.max_discount_amount) if campaign.max_discount_amount is not None else None,
        "source_ref": source_ref_for(claim),
    }

    if benefit.kind in (PromotionBenefit.KIND_PERCENT, PromotionBenefit.KIND_AMOUNT):
        if benefit.scope == PromotionBenefit.SCOPE_TARGETS:
            targets = _targets(campaign, PromotionTarget.ROLE_BENEFIT)
            keys = {ln.key for ln in lines if targets.matches(ln) and not _excluded(campaign, ln)}
        else:
            keys = {ln.key for ln in lines if not _excluded(campaign, ln)}
        return AdjustmentSpec(
            calc_type="percentage" if benefit.kind == PromotionBenefit.KIND_PERCENT else CALC_FIXED,
            value=to_decimal(benefit.value),
            min_subtotal=to_decimal(campaign.min_order_amount) if campaign.min_order_amount is not None else None,
            eligible_line_keys=frozenset(keys),
            **common,
        )

    # Free item / buy X get Y: exact per-line amounts.
    spend = sum((to_decimal(ln.unit_price) * ln.quantity for ln in lines if not ln.is_reward), ZERO)
    if campaign.min_order_amount is not None and spend < campaign.min_order_amount:
        required = to_decimal(campaign.min_order_amount)
        return AdjustmentSpec(calc_type=CALC_LINES, value=ZERO, forced_reason={
            "code": "MINIMUM_ORDER_NOT_MET",
            "required": str(quantize(required, quantum)),
            "current": str(quantize(spend, quantum)),
            "shortfall": str(quantize(required - spend, quantum)),
        }, **common)

    reward_targets = _targets(campaign, PromotionTarget.ROLE_BENEFIT)
    pct = to_decimal(benefit.reward_discount_percent) / HUNDRED
    reward_units = _units(lines, lambda ln: reward_targets.matches(ln) and not _excluded(campaign, ln), benefit)
    # Prefer the line the customer picked as their reward, then the cheapest.
    reward_units.sort(key=lambda u: (not u[2], u[1], u[0], u[3]))

    line_amounts: dict[str, Decimal] = {}

    def give(unit):
        line_amounts[unit[0]] = line_amounts.get(unit[0], ZERO) + quantize(unit[1] * pct, quantum)

    if benefit.kind == PromotionBenefit.KIND_FREE_ITEM:
        chosen = reward_units[: benefit.reward_quantity]
        if not chosen:
            return AdjustmentSpec(calc_type=CALC_LINES, value=ZERO, forced_reason={
                "code": "REWARD_ITEM_REQUIRED",
                "reward_quantity": benefit.reward_quantity,
            }, **common)
        for unit in chosen:
            give(unit)
        return AdjustmentSpec(calc_type=CALC_LINES, value=ZERO, line_amounts=line_amounts, **common)

    # Buy X get Y.
    condition = next((c for c in campaign.conditions.all()
                      if c.kind == PromotionCondition.KIND_QUALIFYING_ITEMS), None)
    need_x = condition.quantity if condition else 1
    qual_targets = _targets(campaign, PromotionTarget.ROLE_QUALIFYING)
    qual_units = _units(
        lines,
        lambda ln: qual_targets.matches(ln) and not _excluded(campaign, ln) and not ln.is_reward,
    )
    qual_units.sort(key=lambda u: (-u[1], u[0], u[3]))  # most expensive qualify first

    used = set()
    applications = 0
    for _ in range(benefit.max_applications):
        rewards = [u for u in reward_units if (u[0], u[3]) not in used][: benefit.reward_quantity]
        reward_ids = {(u[0], u[3]) for u in rewards}
        quals = [u for u in qual_units if (u[0], u[3]) not in used and (u[0], u[3]) not in reward_ids][:need_x]
        if len(rewards) < benefit.reward_quantity or len(quals) < need_x:
            break
        for u in quals:
            used.add((u[0], u[3]))
        for u in rewards:
            used.add((u[0], u[3]))
            give(u)
        applications += 1

    if applications == 0:
        qualifying_count = len(qual_units)
        if qualifying_count < need_x:
            reason = {"code": "QUALIFYING_ITEMS_REQUIRED", "required": need_x, "current": qualifying_count}
        else:
            reason = {"code": "REWARD_ITEM_REQUIRED", "reward_quantity": benefit.reward_quantity}
        return AdjustmentSpec(calc_type=CALC_LINES, value=ZERO, forced_reason=reason, **common)
    return AdjustmentSpec(calc_type=CALC_LINES, value=ZERO, line_amounts=line_amounts, **common)


def load_claim(claim_id: int, *, lock: bool = False):
    qs = VoucherClaim.objects.select_related("campaign", "campaign__benefit", "merchant")
    if lock:
        qs = qs.select_for_update(of=("self",))
    claim = qs.get(pk=claim_id)
    # Targets/conditions are read repeatedly while building a spec.
    prefetch_related_objects([claim.campaign], "targets", "conditions")
    return claim


def resolve_promotion_adjustment(adjustment, lines, order) -> AdjustmentSpec:
    """Pricing-engine callback: recompute a promotion adjustment for the order's current lines."""
    claim_id = claim_id_from_ref(adjustment.source_ref)
    try:
        claim = load_claim(claim_id)
    except (VoucherClaim.DoesNotExist, TypeError, ValueError):
        return AdjustmentSpec(kind=ADJ_PROMOTION, calc_type=CALC_FIXED, value=ZERO, label=adjustment.label,
                              forced_reason={"code": "CLAIM_NOT_FOUND"})
    try:
        check_usable(claim, merchant=order.merchant, channel=channel_for_order(order), order=order)
    except OfferError as exc:
        return AdjustmentSpec(kind=ADJ_PROMOTION, calc_type=CALC_FIXED, value=ZERO, label=adjustment.label,
                              forced_reason={"code": exc.code, "message": str(exc)})
    return build_spec(claim, lines)


def channel_for_order(order) -> str:
    return CHANNEL_IN_STORE if (order.source or "").startswith("pos") or order.source in ("customer_qr",) else CHANNEL_ONLINE


# ── Previewing a claim against a basket ───────────────────────────────────────

@dataclass
class Evaluation:
    eligible: bool
    discount_amount: str
    reason: dict | None
    reward_options: list
    pricing: dict | None = None

    def as_dict(self) -> dict:
        return {
            "eligible": self.eligible,
            "discount_amount": self.discount_amount,
            "reason": self.reason,
            "reward_options": [o.__dict__ for o in self.reward_options],
            "pricing": self.pricing,
        }


def evaluate_lines(claim, merchant, lines, *, channel: str, order=None, charges=()) -> Evaluation:
    """What the claim would give on these lines, priced by the real engine."""
    try:
        check_usable(claim, merchant=merchant, channel=channel, order=order)
    except OfferError as exc:
        return Evaluation(False, "0.00", {"code": exc.code, "message": str(exc)}, [])
    spec = build_spec(claim, lines)
    result = calculate(context_for_merchant(merchant, lines, adjustments=(spec,), charges=charges))
    discount = result.discounts[0]
    options = []
    if not discount.eligible and (discount.reason or {}).get("code") == "REWARD_ITEM_REQUIRED":
        options = reward_options(claim.campaign)
    return Evaluation(
        eligible=discount.eligible and discount.amount > ZERO,
        discount_amount=str(discount.amount),
        reason=discount.reason,
        reward_options=options,
        pricing=result.to_dict(),
    )


def validate_reward_choice(claim, choice: dict) -> dict:
    """The request row for a chosen reward item, if it is one of the offer's rewards."""
    try:
        item_id = int(choice.get("menu_item_id"))
    except (TypeError, ValueError, AttributeError):
        raise OfferError("Choose a valid reward item.", code="INVALID_REWARD")
    allowed = {o.menu_item_id for o in reward_options(claim.campaign, limit=500)}
    if item_id not in allowed:
        raise OfferError("That item isn't part of this offer.", code="INVALID_REWARD")
    return {
        "menu_item_id": item_id,
        "quantity": 1,
        "selections": choice.get("selections") or [],
        "special_instructions": "",
    }


# ── Order lifecycle ───────────────────────────────────────────────────────────

def _lock_campaign_then_claim(claim_id: int):
    campaign_id = VoucherClaim.objects.values_list("campaign_id", flat=True).get(pk=claim_id)
    PromotionCampaign.objects.select_for_update().get(pk=campaign_id)
    return load_claim(claim_id, lock=True)


def reserve_for_order(claim, order, *, channel: str, created_by=None):
    """
    Attach ``claim`` to an open ``order`` the caller has locked. Returns the
    pricing result. Raises OfferError (nothing written) when it cannot apply.
    """
    from orders.pricing import PricingError

    with transaction.atomic():
        claim = _lock_campaign_then_claim(claim.pk)
        check_usable(claim, merchant=order.merchant, channel=channel, order=order)
        if claim.status == VoucherClaim.STATUS_RESERVED and claim.reserved_order_id == order.pk:
            return reprice_order(order)

        claim.status = VoucherClaim.STATUS_RESERVED
        claim.reserved_order = order
        claim.save(update_fields=["status", "reserved_order", "updated_at"])
        PromotionCampaign.objects.filter(pk=claim.campaign_id).update(reserved_count=F("reserved_count") + 1)
        try:
            _adjustment, result = attach_adjustment(
                order,
                AdjustmentSpec(kind=ADJ_PROMOTION, calc_type=CALC_FIXED, value=ZERO,
                               label=claim.campaign.title[:120], source_ref=source_ref_for(claim)),
                created_by=created_by,
            )
        except PricingError as exc:
            raise OfferError(str(exc), code=exc.code.upper(), status=409 if exc.code == "discount_slot_taken" else 400,
                             details=exc.details)
    return result


def release_claim(claim_id: int, *, order=None, reprice: bool = True) -> None:
    """Detach a reserved claim (order still open → re-price; closed → just free the claim)."""
    with transaction.atomic():
        claim = _lock_campaign_then_claim(claim_id)
        if claim.status != VoucherClaim.STATUS_RESERVED:
            return
        order = order or claim.reserved_order
        claim.status = VoucherClaim.STATUS_AVAILABLE
        claim.reserved_order = None
        claim.save(update_fields=["status", "reserved_order", "updated_at"])
        PromotionCampaign.objects.filter(pk=claim.campaign_id, reserved_count__gt=0).update(
            reserved_count=F("reserved_count") - 1,
        )
        if order is not None:
            order.adjustments.filter(kind=ADJ_PROMOTION, status="active", source_ref=source_ref_for(claim)).update(
                status="removed", removed_at=timezone.now(), updated_at=timezone.now(),
            )
            if reprice and not order.pricing_locked_at:
                reprice_order(order)


def _is_new_customer(customer, merchant, order) -> bool:
    from orders.models import Order

    earlier = Order.objects.filter(customer=customer, merchant=merchant).exclude(status=Order.STATUS_CANCELLED)
    if order is not None:
        earlier = earlier.exclude(pk=order.pk).filter(created_at__lt=order.created_at)
    return not earlier.exists()


def _snapshot(claim) -> dict:
    campaign = claim.campaign
    benefit = campaign.benefit
    return {
        "campaign_id": campaign.pk,
        "campaign_version": claim.campaign_version,
        "title": campaign.title,
        "benefit": {
            "kind": benefit.kind, "scope": benefit.scope,
            "value": str(benefit.value) if benefit.value is not None else None,
            "reward_quantity": benefit.reward_quantity,
            "reward_discount_percent": str(benefit.reward_discount_percent),
            "max_applications": benefit.max_applications,
        },
        "min_order_amount": str(campaign.min_order_amount) if campaign.min_order_amount is not None else None,
        "max_discount_amount": str(campaign.max_discount_amount) if campaign.max_discount_amount is not None else None,
        "targets": [
            {"role": t.role, "menu_item_id": t.menu_item_id, "category_id": t.category_id, "option_id": t.option_id}
            for t in campaign.targets.all()
        ],
    }


def _consume_use(claim) -> None:
    claim.uses_count += 1
    claim.status = VoucherClaim.STATUS_REDEEMED if claim.uses_count >= claim.uses_allowed else VoucherClaim.STATUS_AVAILABLE
    claim.reserved_order = None
    claim.save(update_fields=["uses_count", "status", "reserved_order", "updated_at"])


def _record_redemption(redemption, campaign_id) -> None:
    PromotionCampaign.objects.filter(pk=campaign_id).update(redemptions_count=F("redemptions_count") + 1)
    bump_stats(
        campaign_id,
        timezone.localdate(redemption.created_at) if redemption.created_at else None,
        redemptions=1,
        discount_total=redemption.discount_amount or ZERO,
        sales_total=redemption.order_total or ZERO,
        **({"new_customers": 1} if redemption.is_new_customer else {"returning_customers": 1}),
    )


def _notify_saved(redemption) -> None:
    from notifications.services import send_notification

    customer = redemption.customer
    if customer is None or not redemption.discount_amount:
        return
    symbol = redemption.merchant.currency_symbol or ""
    try:
        send_notification(
            user=customer.user,
            title=f"You saved {symbol} {redemption.discount_amount}",
            message=f"Your offer at {redemption.merchant.business_name} was applied.",
            merchant_name=redemption.merchant.business_name,
            context_url="/offers/mine",
            order_id=redemption.order_id,
            merchant_id=redemption.merchant_id,
        )
    except Exception:  # never let a notification break a sale
        logger.exception("offers.notify_saved_failed redemption=%s", redemption.pk)


def redeem_order_claims(order) -> list:
    """Order is financially final (paid/completed): turn its reservation into a redemption."""
    redemptions = []
    for claim_id in list(
        VoucherClaim.objects.filter(reserved_order=order, status=VoucherClaim.STATUS_RESERVED).values_list("pk", flat=True)
    ):
        with transaction.atomic():
            claim = _lock_campaign_then_claim(claim_id)
            if claim.status != VoucherClaim.STATUS_RESERVED or claim.reserved_order_id != order.pk:
                continue
            adjustment = order.adjustments.filter(
                kind=ADJ_PROMOTION, status="active", source_ref=source_ref_for(claim),
            ).first()
            if adjustment is None or not adjustment.eligible or adjustment.amount <= ZERO:
                # The offer gave nothing on the final bill: do not burn the voucher.
                claim.status = VoucherClaim.STATUS_AVAILABLE
                claim.reserved_order = None
                claim.save(update_fields=["status", "reserved_order", "updated_at"])
                PromotionCampaign.objects.filter(pk=claim.campaign_id, reserved_count__gt=0).update(
                    reserved_count=F("reserved_count") - 1,
                )
                continue
            if VoucherRedemption.objects.filter(order=order, status=VoucherRedemption.STATUS_APPLIED).exists():
                continue
            redemption = VoucherRedemption.objects.create(
                claim=claim,
                campaign=claim.campaign,
                merchant=order.merchant,
                customer=claim.customer,
                order=order,
                channel=VoucherRedemption.CHANNEL_POS if channel_for_order(order) == CHANNEL_IN_STORE
                else VoucherRedemption.CHANNEL_ONLINE,
                currency_code=order.currency_code_snapshot or order.merchant.currency_code,
                order_subtotal=order.subtotal,
                discount_amount=adjustment.amount,
                order_total=order.total_amount,
                rules_snapshot=_snapshot(claim),
                redeemed_by_worker=order.processed_by_worker,
                confirmed_via=VoucherRedemption.CONFIRMED_ORDER,
                idempotency_key=f"order:{order.uuid}",
                is_new_customer=_is_new_customer(claim.customer, order.merchant, order),
            )
            _consume_use(claim)
            PromotionCampaign.objects.filter(pk=claim.campaign_id, reserved_count__gt=0).update(
                reserved_count=F("reserved_count") - 1,
            )
            _record_redemption(redemption, claim.campaign_id)
            transaction.on_commit(lambda r=redemption: _notify_saved(r))
            redemptions.append(redemption)
    return redemptions


def void_order_redemptions(order, *, reason: str) -> None:
    """A redeemed order was cancelled/refunded: void it, restoring the use if allowed."""
    now = timezone.now()
    for redemption_id, campaign_id in list(
        VoucherRedemption.objects.filter(order=order, status=VoucherRedemption.STATUS_APPLIED)
        .values_list("pk", "campaign_id")
    ):
        with transaction.atomic():
            # Same lock order as everywhere else: campaign, then the rest.
            campaign = PromotionCampaign.objects.select_for_update().get(pk=campaign_id) if campaign_id else None
            redemption = VoucherRedemption.objects.select_for_update().get(pk=redemption_id)
            if redemption.status != VoucherRedemption.STATUS_APPLIED:
                continue
            redemption.status = VoucherRedemption.STATUS_VOIDED
            redemption.voided_at = now
            redemption.void_reason = reason[:120]
            redemption.save(update_fields=["status", "voided_at", "void_reason"])
            if campaign is not None:
                PromotionCampaign.objects.filter(pk=campaign.pk, redemptions_count__gt=0).update(
                    redemptions_count=F("redemptions_count") - 1,
                )
                bump_stats(campaign.pk, voids=1)
                bump_stats(
                    campaign.pk, timezone.localdate(redemption.created_at),
                    discount_total=-(redemption.discount_amount or ZERO),
                    sales_total=-(redemption.order_total or ZERO),
                )
                if campaign.restore_on_cancel and redemption.claim_id:
                    claim = VoucherClaim.objects.select_for_update().get(pk=redemption.claim_id)
                    if claim.uses_count > 0 and not claim.is_expired(now) and claim.status != VoucherClaim.STATUS_REVOKED:
                        claim.uses_count -= 1
                        claim.status = VoucherClaim.STATUS_AVAILABLE
                        claim.save(update_fields=["uses_count", "status", "updated_at"])


def finalize_order(order) -> None:
    """Called whenever a pricing-locked order is saved (idempotent)."""
    from orders.models import Order

    closed_without_sale = order.status in (Order.STATUS_CANCELLED, "refunded") or order.payment_status == "refunded"
    if closed_without_sale:
        for claim_id in list(
            VoucherClaim.objects.filter(reserved_order=order, status=VoucherClaim.STATUS_RESERVED).values_list("pk", flat=True)
        ):
            release_claim(claim_id, order=order, reprice=False)
        void_order_redemptions(order, reason=f"order {order.status}")
    else:
        redeem_order_claims(order)


# ── Counter confirmation without a Zentro order ──────────────────────────────

def reason_message(reason: dict | None, merchant) -> str:
    """A customer/staff-facing sentence for why an offer does not apply."""
    reason = reason or {}
    code = reason.get("code")
    symbol = merchant.currency_symbol or merchant.currency_code
    if code == "MINIMUM_ORDER_NOT_MET":
        return f"Add {symbol} {reason.get('shortfall')} more to use this offer."
    if code == "REWARD_ITEM_REQUIRED":
        return "Choose your free item to use this offer."
    if code == "QUALIFYING_ITEMS_REQUIRED":
        missing = max(int(reason.get("required", 1)) - int(reason.get("current", 0)), 1)
        return f"Add {missing} more qualifying item{'s' if missing > 1 else ''} to use this offer."
    if code == "NO_ELIGIBLE_ITEMS":
        return "Nothing in this order qualifies for this offer."
    return reason.get("message") or "This offer can't be used on this order."


def needs_bill_amount(campaign) -> bool:
    """
    At the counter there is no Zentro order to price, so money-based offers
    (and any offer with a minimum spend) need the bill amount to be checked.
    """
    return (
        campaign.benefit.kind in (PromotionBenefit.KIND_PERCENT, PromotionBenefit.KIND_AMOUNT)
        or campaign.min_order_amount is not None
    )


def bill_label(campaign) -> str:
    benefit = campaign.benefit
    if benefit.kind in (PromotionBenefit.KIND_PERCENT, PromotionBenefit.KIND_AMOUNT) and \
            benefit.scope == PromotionBenefit.SCOPE_TARGETS:
        return "Amount spent on the offer's items"
    return "Bill amount"


def evaluate_bill(claim, bill_amount):
    """
    ``(discount_or_None, reason_or_None)`` for a counter bill. Money offers are
    priced by the pricing engine (min spend, max discount, rounding); item
    offers only have their minimum spend checked (staff hand over the item).
    """
    from orders.pricing import LineInput

    campaign = claim.campaign
    benefit = campaign.benefit
    if bill_amount is None:
        return None, None
    if bill_amount <= ZERO:
        raise OfferError("Enter a bill amount above zero.", code="INVALID_BILL_AMOUNT")
    quantum = currency_quantum(campaign.currency_code)
    amount = quantize(bill_amount, quantum)
    min_order = to_decimal(campaign.min_order_amount) if campaign.min_order_amount is not None else None

    if benefit.kind in (PromotionBenefit.KIND_PERCENT, PromotionBenefit.KIND_AMOUNT):
        spec = AdjustmentSpec(
            kind=ADJ_PROMOTION,
            calc_type="percentage" if benefit.kind == PromotionBenefit.KIND_PERCENT else CALC_FIXED,
            value=to_decimal(benefit.value),
            min_subtotal=min_order,
            max_amount=to_decimal(campaign.max_discount_amount) if campaign.max_discount_amount is not None else None,
            eligible_line_keys=frozenset({"bill"}),
        )
        result = calculate(PricingContext(
            currency_code=campaign.currency_code, policy_code="legacy", tax_enabled=False,
            tax_components=(), lines=(LineInput("bill", "Bill", 1, amount, amount),), adjustments=(spec,),
        ))
        discount = result.discounts[0]
        return (discount.amount, None) if discount.eligible else (None, discount.reason)

    if min_order is not None and amount < min_order:
        return None, {
            "code": "MINIMUM_ORDER_NOT_MET",
            "required": str(quantize(min_order, quantum)),
            "current": str(amount),
            "shortfall": str(quantize(min_order - amount, quantum)),
        }
    return None, None


def redeem_in_store(
    claim_id: int, merchant, *, worker=None, user=None, idempotency_key: str,
    bill_amount=None, confirmed_via: str = VoucherRedemption.CONFIRMED_POS,
):
    if not idempotency_key or len(idempotency_key) > 64:
        raise OfferError("A request id is required.", code="IDEMPOTENCY_KEY_REQUIRED")
    existing = VoucherRedemption.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        if existing.claim_id != claim_id or existing.merchant_id != merchant.pk:
            raise OfferError("That request id was already used.", code="IDEMPOTENCY_CONFLICT", status=409)
        return existing, False

    try:
        with transaction.atomic():
            claim = _lock_campaign_then_claim(claim_id)
            check_usable(claim, merchant=merchant, channel=CHANNEL_IN_STORE)
            if bill_amount is None and needs_bill_amount(claim.campaign):
                raise OfferError(
                    "Enter the bill amount so the offer can be checked.", code="BILL_AMOUNT_REQUIRED",
                )
            discount, reason = evaluate_bill(claim, bill_amount)
            if reason:
                raise OfferError(reason_message(reason, merchant), code=reason.get("code", "NOT_ELIGIBLE"),
                                 details={"reason": reason})
            bill = quantize(bill_amount, currency_quantum(claim.campaign.currency_code)) if bill_amount else None
            redemption = VoucherRedemption.objects.create(
                claim=claim, campaign=claim.campaign, merchant=merchant, customer=claim.customer,
                channel=VoucherRedemption.CHANNEL_IN_STORE,
                confirmed_via=confirmed_via,
                currency_code=merchant.currency_code,
                order_subtotal=bill,
                discount_amount=discount,
                order_total=(bill - discount) if bill is not None and discount is not None else bill,
                rules_snapshot=_snapshot(claim),
                redeemed_by_worker=worker, redeemed_by_user=user,
                idempotency_key=idempotency_key,
                is_new_customer=_is_new_customer(claim.customer, merchant, None),
            )
            _consume_use(claim)
            _record_redemption(redemption, claim.campaign_id)
    except IntegrityError:
        # A concurrent retry with the same idempotency key won the race.
        existing = VoucherRedemption.objects.filter(idempotency_key=idempotency_key).first()
        if existing and existing.claim_id == claim_id:
            return existing, False
        raise
    return redemption, True


# ── Code lookup ───────────────────────────────────────────────────────────────

def resolve_scan(merchant, raw: str):
    """The claim a scanned QR / typed code refers to, only within ``merchant``; else None."""
    parsed = parse_scan(raw)
    if parsed is None:
        return None
    kind, value = parsed
    qs = VoucherClaim.objects.select_related("campaign", "campaign__benefit", "customer", "merchant").filter(merchant=merchant)
    return qs.filter(code=value).first() if kind == "code" else qs.filter(qr_token=value).first()


# ── Maintenance ───────────────────────────────────────────────────────────────

def expire_claims(now=None) -> int:
    now = now or timezone.now()
    return VoucherClaim.objects.filter(
        status=VoucherClaim.STATUS_AVAILABLE, expires_at__isnull=False, expires_at__lte=now,
    ).update(status=VoucherClaim.STATUS_EXPIRED, updated_at=now)


def end_finished_campaigns(now=None) -> int:
    now = now or timezone.now()
    return PromotionCampaign.objects.filter(
        status=PromotionCampaign.STATUS_PUBLISHED, ends_at__isnull=False, ends_at__lte=now,
    ).update(status=PromotionCampaign.STATUS_ENDED, updated_at=now)


def backfill_return_rates(now=None) -> int:
    """Did the customer come back within 7 / 30 days after redeeming?"""
    from orders.models import Order

    now = now or timezone.now()
    updated = 0
    for days, field_name in ((7, "returned_within_7d"), (30, "returned_within_30d")):
        pending = VoucherRedemption.objects.filter(
            **{f"{field_name}__isnull": True},
            status=VoucherRedemption.STATUS_APPLIED,
            customer__isnull=False,
            created_at__lte=now - timedelta(days=days),
        ).select_related("order")[:500]
        for r in pending:
            start = r.created_at
            returned = Order.objects.filter(
                customer_id=r.customer_id, merchant_id=r.merchant_id,
                created_at__gt=start + timedelta(minutes=1), created_at__lte=start + timedelta(days=days),
            ).exclude(status=Order.STATUS_CANCELLED)
            if r.order_id:
                returned = returned.exclude(pk=r.order_id)
            setattr(r, field_name, returned.exists())
            r.save(update_fields=[field_name])
            updated += 1
    return updated
