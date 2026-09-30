"""
loyalty/earning.py — what an order earns, from its paid lines.

The rule: **a reward never earns another reward.**

Loyalty progress (points, punches, qualifying order count, visit streak and
mission progress) is calculated from the order's *eligible paid lines*,
never from the mere existence of an order. A line or unit does not earn when
it was received as a reward or for free:

  * the whole order is a reward/comp order (punch-card claim, loyalty reward
    redemption, staff comp);
  * the line is an offer's reward line (``OrderItem.is_promotion_reward``) —
    free item, Buy X Get Y, voucher reward;
  * units made 100% free by a reward adjustment (loyalty reward, punch-card
    reward, promotion) — e.g. a BOGO that frees one unit of an ordinary line;
  * the line was paid nothing at all (100% discount, complimentary, price 0);
  * the line was cancelled or refunded.

The free product still exists as an ``OrderItem`` (POS, KDS, receipts and
fulfilment need it); it simply contributes nothing here. An order whose lines
are all rewards/free is a reward fulfilment: zero accrual, no punch, no count.

Every loyalty award goes through ``orders.views._award_loyalty``, which uses
``compute_loyalty_earning`` — so this applies to punch cards, loyalty
rewards, offers, BOGO, free items and any future promotion kind.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_FLOOR, Decimal

ZERO = Decimal("0")
CENT = Decimal("0.01")

# Orders that are themselves a reward or a comp: never earn.
NON_EARNING_ORDER_TYPES = frozenset({"punch_card_redemption", "reward_redemption", "staff_comp"})

# Order adjustments that GIVE something as a reward. A unit these make 100%
# free is a reward unit. (A manual discount is not a reward; a line it makes
# fully free is still excluded because nothing was paid for it.)
REWARD_ADJUSTMENT_KINDS = frozenset({"loyalty_reward", "punch_reward", "promotion"})

REASON_REWARD_ORDER = "reward_order"
REASON_REWARD_LINE = "reward_line"
REASON_REWARD_UNITS = "reward_units"
REASON_NOT_PAID = "not_paid"
REASON_CANCELLED = "cancelled"
REASON_REFUNDED = "refunded"


def _dec(value) -> Decimal:
    return Decimal(str(value if value is not None else 0))


@dataclass
class LineEarning:
    item_id: int
    name: str
    quantity: int
    eligible_units: int
    paid_amount: Decimal
    points: int
    reason: str = ""  # why (some of) the line does not earn

    @property
    def eligible(self) -> bool:
        return self.eligible_units > 0


@dataclass
class LoyaltyEarning:
    qualifies: bool                # counts as a qualifying (paid) purchase
    points: int                    # points to award
    item_points: int
    spend_points: int
    eligible_amount: Decimal       # paid goods amount on eligible lines
    eligible_units: int
    has_reward_lines: bool         # the order contained reward/free-by-reward goods
    lines: list[LineEarning] = field(default_factory=list)

    @property
    def reward_only(self) -> bool:
        """Only reward/free goods: a reward fulfilment with zero accrual."""
        return not self.qualifies and self.has_reward_lines


def _reward_allocations(order) -> dict[int, Decimal]:
    """Amount of each line given away by active reward adjustments."""
    from orders.models import OrderAdjustmentAllocation

    totals: dict[int, Decimal] = {}
    rows = OrderAdjustmentAllocation.objects.filter(
        adjustment__order=order,
        adjustment__status="active",
        adjustment__kind__in=REWARD_ADJUSTMENT_KINDS,
    ).values_list("order_item_id", "amount")
    for item_id, amount in rows:
        totals[item_id] = totals.get(item_id, ZERO) + _dec(amount)
    return totals


def compute_loyalty_earning(order) -> LoyaltyEarning:
    """What ``order`` earns. Pure: reads the persisted order, writes nothing."""
    from orders.models import OrderItem

    items = list(order.items.select_related("menu_item").all())
    reward_order = order.order_type in NON_EARNING_ORDER_TYPES or bool(order.reward_redemption_id) \
        or bool(order.punch_card_redemption_id)
    reward_alloc = {} if reward_order else _reward_allocations(order)

    lines: list[LineEarning] = []
    has_reward_lines = reward_order and bool(items)
    for item in items:
        qty = int(item.quantity or 0)
        net_qty = max(qty - int(item.refunded_quantity or 0), 0)
        unit_price = _dec(item.price)
        gross = unit_price * net_qty
        discount = _dec(item.discount_amount) * (Decimal(net_qty) / Decimal(qty)) if qty else ZERO
        paid = max(gross - discount, ZERO).quantize(CENT)

        reason = ""
        eligible_units = net_qty
        if reward_order:
            eligible_units, reason = 0, REASON_REWARD_ORDER
        elif item.is_promotion_reward:
            eligible_units, reason = 0, REASON_REWARD_LINE
            has_reward_lines = True
        elif item.preparation_status == OrderItem.CANCELLED:
            eligible_units, reason = 0, REASON_CANCELLED
        elif net_qty == 0:
            eligible_units, reason = 0, REASON_REFUNDED
        else:
            given = reward_alloc.get(item.id, ZERO)
            if given > 0:
                has_reward_lines = True
                free_units = (
                    net_qty if unit_price <= 0
                    else int(((given + Decimal("0.005")) / unit_price).to_integral_value(ROUND_FLOOR))
                )
                free_units = min(free_units, net_qty)
                if free_units:
                    eligible_units, reason = net_qty - free_units, REASON_REWARD_UNITS
            if paid <= 0:
                eligible_units, reason = 0, reason or REASON_NOT_PAID

        menu_item = item.menu_item
        per_unit = int(menu_item.points_per_item or 0) if menu_item and menu_item.loyalty_reward else 0
        points = max(per_unit, 0) * eligible_units
        lines.append(LineEarning(
            item_id=item.id,
            name=item.name,
            quantity=qty,
            eligible_units=eligible_units,
            paid_amount=paid if eligible_units else ZERO,
            points=points,
            reason=reason,
        ))

    eligible = [ln for ln in lines if ln.eligible]
    qualifies = bool(eligible) and order.customer_id is not None
    eligible_amount = sum((ln.paid_amount for ln in eligible), ZERO)
    eligible_units = sum(ln.eligible_units for ln in eligible)
    item_points = sum(ln.points for ln in eligible)

    if not qualifies:
        return LoyaltyEarning(
            qualifies=False, points=0, item_points=0, spend_points=0,
            eligible_amount=ZERO, eligible_units=0, has_reward_lines=has_reward_lines, lines=lines,
        )

    rate = getattr(order, "loyalty_spend_rate", None)
    if rate is None:
        # Orders created before the spend rate was recorded: keep their
        # estimate, minus whatever reward/free lines had been counted in it.
        excluded = sum(
            (int(i.menu_item.points_per_item or 0) if i.menu_item and i.menu_item.loyalty_reward else 0)
            * (max(int(i.quantity or 0) - int(i.refunded_quantity or 0), 0) - ln.eligible_units)
            for i, ln in zip(items, lines)
        )
        points = max(int(order.points_earned or 0) - max(excluded, 0), 0)
        spend_points = max(points - item_points, 0)
    else:
        spend_points = int((eligible_amount * _dec(rate)).to_integral_value(ROUND_FLOOR))
        points = item_points + spend_points

    return LoyaltyEarning(
        qualifies=True,
        points=points,
        item_points=item_points,
        spend_points=spend_points,
        eligible_amount=eligible_amount,
        eligible_units=eligible_units,
        has_reward_lines=has_reward_lines,
        lines=lines,
    )


def estimate_points(priced_lines, spend_rate=None) -> int:
    """Creation-time estimate from priced request lines, rewards excluded.

    The award at completion is authoritative (``compute_loyalty_earning``);
    this only keeps the number shown before completion honest.
    """
    paid = [p for p in priced_lines if not getattr(p.line, "is_reward", False)]
    points = sum(p.points for p in paid)
    if spend_rate:
        goods = sum((_dec(p.item_fields.get("subtotal")) for p in paid), ZERO)
        points += int((goods * _dec(spend_rate)).to_integral_value(ROUND_FLOOR))
    return points
