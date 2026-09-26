"""
config/menu_pricing.py

Single shared source of truth for pricing and validating an order line against
the live menu. The backend is the price authority (spec 75 / C-1): client-sent
totals are never trusted â€” every order-creation path recomputes unit prices,
applies variant/modifier pricing, enforces required groups and selection
bounds, and rejects unavailable / cross-merchant options.

Every order-creation path (customer app, guest/table QR, POS online/offline,
add-items-to-order) must compute line prices through this module so that
variances are impossible (single-source-of-truth, spec 108).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q

from config.order_utils import QuantityValidationError, parse_quantity

MAX_SPECIAL_INSTRUCTIONS = 500
MONEY = Decimal("0.01")

DISCOUNT_NONE = "none"
DISCOUNT_PERCENTAGE = "percentage"
DISCOUNT_FIXED = "fixed"


def _money(value):
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def resolve_discount(menu_item, now=None):
    """
    Return the discount currently in force for ``menu_item`` as a
    ``(discount_type, discount_value)`` pair, or ``(none, None)``.

    A special-sourced discount is only honoured while a live Today's Special
    (active + inside its ``starts_at``/``ends_at`` window) is linked to the
    item, so a stale persisted value can never be charged.
    """
    discount_type = getattr(menu_item, "discount_type", DISCOUNT_NONE) or DISCOUNT_NONE
    discount_value = getattr(menu_item, "discount_value", None)
    if discount_type == DISCOUNT_NONE or discount_value is None:
        return DISCOUNT_NONE, None

    discount_value = Decimal(discount_value)
    if discount_value <= 0:
        return DISCOUNT_NONE, None

    if getattr(menu_item, "discount_source", "manual") == "special":
        from django.utils import timezone
        from loyalty.models import TodaySpecial

        moment = now or timezone.now()
        live = (
            TodaySpecial.objects.filter(
                linked_menu_item_id=menu_item.id,
                merchant_id=menu_item.merchant_id,
                is_active=True,
            )
            .filter(
                Q(starts_at__isnull=True) | Q(starts_at__lte=moment),
                Q(ends_at__isnull=True) | Q(ends_at__gte=moment),
            )
            .exclude(discount_type=TodaySpecial.DISCOUNT_NONE)
            .order_by("-updated_at")
            .first()
        )
        if live is None or not live.discount_value or Decimal(live.discount_value) <= 0:
            return DISCOUNT_NONE, None
        discount_type = live.discount_type
        discount_value = Decimal(live.discount_value)

    if discount_type == DISCOUNT_PERCENTAGE:
        discount_value = min(discount_value, Decimal("100"))
    return discount_type, discount_value


def apply_discount(amount, discount_type, discount_value):
    """Return ``(discounted_amount, discount_amount)``; never negative."""
    amount = _money(amount)
    if discount_type == DISCOUNT_PERCENTAGE and discount_value:
        cut = amount * Decimal(discount_value) / Decimal("100")
    elif discount_type == DISCOUNT_FIXED and discount_value:
        cut = Decimal(discount_value)
    else:
        return amount, Decimal("0")

    cut = _money(cut)
    if cut < 0:
        cut = Decimal("0")
    if cut > amount:
        cut = amount
    return amount - cut, cut



class LineValidationError(ValueError):
    """Raised when a client-supplied cart line is invalid."""

    def __init__(self, message, *, code=None):
        super().__init__(message)
        self.code = code


def _selection_bounds_message(group, count):
    """
    Human-readable selection error.

    Staff and customers both read this verbatim, so it must read as an
    instruction ("Choose one option for X"), never as a validation code
    ("max_selection exceeded").
    """
    low, high = group.min_select, group.max_select
    noun = "option" if high == 1 else "options"
    if low == high:
        if low == 1:
            return f"Choose one option for {group.name}."
        return f"Choose {low} options for {group.name}."
    if count < low:
        if low == 1:
            return f"Choose one option for {group.name}."
        return f"Choose at least {low} options for {group.name}."
    if high == 1:
        return f"Choose only one {noun} for {group.name}."
    return f"You can choose up to {high} {noun} for {group.name}."


@dataclass
class PricedOption:
    """A single snapshot entry for an order line (variant or modifier)."""

    group_name: str
    option_name: str
    kind: str
    price_effect: Decimal


@dataclass
class PricedLine:
    """Server-computed, authoritative price breakdown for one cart line."""

    menu_item_id: int
    name: str
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    points: int
    special_instructions: str
    original_unit_price: Decimal | None = None
    unit_discount: Decimal = Decimal("0")
    options: list[PricedOption] = field(default_factory=list)


def _validate_instructions(special_instructions):
    instructions = (special_instructions or "").strip()
    if len(instructions) > MAX_SPECIAL_INSTRUCTIONS:
        raise LineValidationError(
            "Special instructions must be 500 characters or fewer.",
            code="instructions_too_long",
        )
    return instructions


def _validate_selections(menu_item, selection_pairs):
    """
    Check every supplied (group_id, option_id) pair belongs to the menu item
    and the same merchant, and that required-group / min-max constraints hold.

    Returns (variant_opts, modifier_opts) lists ordered by group display order.
    """
    if not selection_pairs:
        selection_pairs = []

    groups = list(
        menu_item.option_groups.filter(is_active=True).prefetch_related("options")
    )
    groups_by_id = {group.id: group for group in groups}
    groups_with_options = {
        group.id for group in groups if group.options.all()
    }
    options_by_pair = {}
    used_ids = set()

    for group_id, option_id in selection_pairs:
        group = groups_by_id.get(group_id)
        if group is None:
            raise LineValidationError(
                "One of your selections is no longer available. Please review "
                "your choices and try again.",
                code="invalid_group",
            )
        # Guard against duplicate selections of the same option across groups.
        key = (group_id, option_id)
        if key in used_ids:
            raise LineValidationError(
                f"Duplicate selection for '{group.name}'.",
                code="duplicate_option",
            )
        used_ids.add(key)
        options_by_pair[key] = option_id

    from merchants.models import MenuOption

    option_rows = (
        MenuOption.objects.filter(
            group__menu_item=menu_item,
            group__merchant=menu_item.merchant,
            group__is_active=True,
            is_available=True,
        )
        .select_related("group")
        .order_by("group__display_order", "display_order", "id")
    )

    option_by_id = {opt.id: opt for opt in option_rows}
    choices = {group.id: [] for group in groups}

    for (group_id, option_id) in used_ids:
        option = option_by_id.get(option_id)
        if option is None:
            group = groups_by_id.get(group_id)
            name = group.name if group else "one of your choices"
            raise LineValidationError(
                f"{name} is sold out or no longer available. Please review your choices.",
                code="invalid_option",
            )
        if option.group.id != group_id:
            raise LineValidationError(
                "One of your selections does not belong to that choice group.",
                code="invalid_option",
            )
        choices[group_id].append(option)

    variant_opts: list[object] = []
    modifier_opts: list[object] = []

    def _kind_rank(kind):
        return 0 if kind == "variant" else 1

    for group_id, group in sorted(
        groups_by_id.items(),
        key=lambda kv: (_kind_rank(kv[1].kind), kv[1].display_order, kv[1].id),
    ):
        if group_id not in groups_with_options:
            continue
        selected = choices[group_id]
        count = len(selected)
        # `min_select` is a floor, not a hint: a group configured min=1 is
        # mandatory even when `required=False` (e.g. a required "sugar level"
        # group where the merchant never ticked the Required box). Previously
        # this was only checked when something *was* selected, so an empty
        # selection silently bypassed the floor.
        if count < group.min_select or count > group.max_select:
            if group.required and count == 0:
                raise LineValidationError(
                    f"Choose one option for {group.name}.",
                    code="required_group_missing",
                )
            raise LineValidationError(
                _selection_bounds_message(group, count),
                code="selection_bounds",
            )

        if group.kind == "variant":
            # A variant group is single-select (DB-enforced), so anything beyond
            # one here means the data was written before that constraint.
            if count > 1:
                raise LineValidationError(
                    f"Choose only one option for {group.name}.",
                    code="selection_bounds",
                )
            variant_opts.extend(selected)
        else:
            modifier_opts.extend(selected)

    return variant_opts, modifier_opts


def validate_and_price_line(
    menu_item,
    quantity,
    selection_pairs=None,
    *,
    special_instructions="",
    loyalty_eligible=True,
):
    """
    Validate one cart line and compute its authoritative price.

    selection_pairs: iterable of (group_id, option_id).
    Raises LineValidationError for anything the server must reject.
    Returns a PricedLine.
    """
    try:
        qty = parse_quantity(quantity)
    except QuantityValidationError as exc:
        raise LineValidationError(f"Invalid quantity for {menu_item.name}: {exc}")

    instructions = _validate_instructions(special_instructions)

    from merchants.models import MenuItem

    if menu_item.status != MenuItem.STATUS_ACTIVE:
        raise LineValidationError(
            f"{menu_item.name} is no longer available.", code="item_unavailable"
        )
    if not menu_item.is_available:
        raise LineValidationError(
            f"Sorry, {menu_item.name} is currently sold out.", code="sold_out"
        )

    variant_opts, modifier_opts = _validate_selections(menu_item, selection_pairs)

    base_price = _money(menu_item.price)
    item_price = base_price
    has_absolute_variant = False
    priced_options = []

    # A variant option with an absolute price REPLACES the base price; otherwise
    # the base price stands. Modifier deltas are added on top.
    #
    # A product may legitimately carry more than one priced variant group
    # (Size=Large 850 + Temperature=Hot 850 would be ambiguous). Selection order
    # above already sorts by group display_order, so the *last* priced variant
    # group wins deterministically. Merchants are advised in the product editor
    # to leave secondary variant groups unpriced when they want a price effect.
    for opt in variant_opts:
        opt_price = Decimal(opt.price) if opt.price is not None else None
        if opt_price is not None:
            item_price = _money(opt_price)
            has_absolute_variant = True
        priced_options.append(PricedOption(
            group_name=opt.group.name,
            option_name=opt.name,
            kind=opt.group.kind,
            price_effect=opt_price if opt_price is not None else Decimal("0"),

        ))

    # Item-level discount applies to the base price only. A variant that carries
    # its own absolute price is already a deliberate price, so it is not reduced.
    original_unit_price = item_price
    unit_discount = Decimal("0")
    if not has_absolute_variant:
        discount_type, discount_value = resolve_discount(menu_item)
        if discount_type != DISCOUNT_NONE:
            item_price, unit_discount = apply_discount(item_price, discount_type, discount_value)

    unit_price = item_price
    for opt in modifier_opts:
        delta = _money(opt.price_delta)
        unit_price += delta
        priced_options.append(PricedOption(
            group_name=opt.group.name,
            option_name=opt.name,
            kind=opt.group.kind,
            price_effect=delta,

        ))

    unit_price = _money(unit_price)
    subtotal = _money(unit_price * qty)
    points = 0
    if menu_item.loyalty_reward and loyalty_eligible:
        points = menu_item.points_per_item * qty

    return PricedLine(
        menu_item_id=menu_item.id,
        name=menu_item.name,
        quantity=qty,
        unit_price=unit_price,
        subtotal=subtotal,
        points=points,
        special_instructions=instructions,
        original_unit_price=original_unit_price,
        unit_discount=unit_discount,
        options=priced_options,
    )


def menu_item_from_selection(merchant, menu_item_id):
    """Fetch a live menu item belonging to `merchant` or raise LineValidationError."""
    from merchants.models import MenuItem

    try:
        menu_item = MenuItem.objects.get(
            pk=menu_item_id,
            merchant=merchant,
            status=MenuItem.STATUS_ACTIVE,
            is_available=True,
        )
    except MenuItem.DoesNotExist:
        raise LineValidationError(
            f"Menu item {menu_item_id} is not available.", code="item_unavailable"
        )
    return menu_item


__all__ = [
    "LineValidationError",
    "PricedLine",
    "PricedOption",
    "MAX_SPECIAL_INSTRUCTIONS",
    "DISCOUNT_NONE",
    "DISCOUNT_PERCENTAGE",
    "DISCOUNT_FIXED",
    "resolve_discount",
    "apply_discount",
    "validate_and_price_line",
    "menu_item_from_selection",
]
