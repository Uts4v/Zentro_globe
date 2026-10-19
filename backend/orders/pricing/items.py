"""
Item pricing: turns requested cart lines, or existing order lines, into
``LineInput`` values for the engine.

Per-unit pricing (variants, modifiers, Today's Special, availability, selection
rules, cross-merchant checks) stays in ``config.menu_pricing``, which every flow
already shared. This module only adapts it, so there is one line-price
authority. Lines already on an order are re-priced from their stored snapshot,
never from today's menu, so a menu edit cannot change an open bill.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from config.menu_pricing import LineValidationError, PricedOption, validate_and_price_line
from config.order_utils import QuantityValidationError, parse_quantity

from .money import ZERO, to_decimal
from .types import TAX_CLASS_STANDARD, TAX_CLASSES, LineInput, PricingError

# Ad-hoc POS lines take their price from the request, so it is bounded here the
# same way OrderItem.price is (max_digits=10, decimal_places=2).
MAX_CUSTOM_NAME_LENGTH = 255
MAX_CUSTOM_PRICE = Decimal("99999999.99")
MAX_CUSTOM_INSTRUCTIONS = 500


@dataclass
class PricedRequestLine:
    line: LineInput
    item_fields: dict            # kwargs for OrderItem(...)
    options: list[PricedOption] = field(default_factory=list)
    points: int = 0


def _tax_class(menu_item) -> str:
    value = getattr(menu_item, "tax_class", TAX_CLASS_STANDARD) or TAX_CLASS_STANDARD
    return value if value in TAX_CLASSES else TAX_CLASS_STANDARD


def price_custom_line(
    row,
    *,
    staff_comp: bool = False,
    allow_free: bool = False,
    free_by=None,
    key_prefix: str = "new",
    index: int = 0,
) -> PricedRequestLine:
    """
    Price an ad-hoc POS line that has no menu item behind it.

    The name and price come from the request (there is no catalog row to read
    them from), so both are strictly validated; callers must only reach here for
    an authorised employee. Otherwise the line is an ordinary priced order line:
    ``standard`` tax class, eligible for order-level discounts, no loyalty
    points, and never persisted to the menu catalog.
    """
    name = str(row.get("name") or "").strip()
    if not name:
        raise PricingError("A custom item needs a name.", code="invalid_custom_item")
    name = name[:MAX_CUSTOM_NAME_LENGTH]

    raw_price = row.get("price")
    if raw_price is None or raw_price == "":
        raise PricingError("A custom item needs a price.", code="invalid_custom_item")
    try:
        unit_price = to_decimal(raw_price)
    except (InvalidOperation, TypeError, ValueError):
        raise PricingError("A custom item needs a valid price.", code="invalid_custom_item")
    if unit_price < ZERO:
        raise PricingError(
            "A custom item price cannot be negative.", code="invalid_custom_item",
        )
    if unit_price > MAX_CUSTOM_PRICE:
        raise PricingError("That custom item price is too large.", code="invalid_custom_item")

    try:
        quantity = parse_quantity(row.get("quantity"), default=1)
    except QuantityValidationError as exc:
        raise PricingError(f"{name}: {exc}", code="invalid_custom_item")

    if row.get("selections"):
        raise PricingError(
            "A custom item cannot carry menu options.", code="invalid_custom_item",
        )

    special_instructions = str(row.get("special_instructions") or "")[:MAX_CUSTOM_INSTRUCTIONS]
    tax_class = row.get("tax_class")
    if tax_class not in TAX_CLASSES:
        tax_class = TAX_CLASS_STANDARD

    is_free = bool(allow_free and row.get("is_free")) and not staff_comp
    charged_price = ZERO if (staff_comp or is_free) else unit_price

    item_fields = {
        "menu_item": None,
        "name": name,
        "price": charged_price,
        "list_unit_price": unit_price,
        "quantity": quantity,
        "subtotal": charged_price * quantity,
        "special_instructions": special_instructions,
        "tax_class": tax_class,
        "is_custom": True,
    }
    if is_free:
        item_fields.update({
            "is_complimentary": True,
            "complimentary_value": unit_price * quantity,
            "complimentary_by": free_by,
        })

    return PricedRequestLine(
        line=LineInput(
            key=f"{key_prefix}:{index}",
            name=name,
            quantity=quantity,
            unit_price=charged_price,
            list_unit_price=unit_price,
            tax_class=tax_class,
            menu_item_id=None,
            category_id=None,
            option_ids=frozenset(),
            modifier_unit_total=ZERO,
        ),
        item_fields=item_fields,
        options=[],
        points=0,
    )


def price_request_lines(
    merchant,
    request_items,
    *,
    loyalty_eligible: bool = True,
    staff_comp: bool = False,
    allow_free: bool = False,
    free_by=None,
    key_prefix: str = "new",
) -> list[PricedRequestLine]:
    """
    Price client-requested lines for ``merchant``. Only the item ids, selections,
    quantities and instructions are read from the request; every price comes
    from the database. A row flagged ``is_custom`` is an authorised ad-hoc POS
    line whose name and price come from the request instead (see
    ``price_custom_line``). Raises ``PricingError`` for anything the server
    rejects.

    A row flagged ``is_free`` is charged nothing only when the caller passes
    ``allow_free`` (after checking the merchant setting, the employee's
    permission and the PIN); otherwise the flag is ignored and the line is
    charged normally. ``free_by`` is the employee recorded on the line.
    """
    from merchants.models import MenuItem

    ids = [
        row.get("menu_item_id")
        for row in request_items
        if not row.get("is_custom") and row.get("menu_item_id") is not None
    ]
    menu_items = {
        mi.id: mi
        for mi in MenuItem.objects.filter(id__in=ids, merchant=merchant, is_available=True)
    }

    priced = []
    for index, row in enumerate(request_items):
        if row.get("is_custom"):
            priced.append(price_custom_line(
                row,
                staff_comp=staff_comp,
                allow_free=allow_free,
                free_by=free_by,
                key_prefix=key_prefix,
                index=index,
            ))
            continue

        menu_item = menu_items.get(row.get("menu_item_id"))
        if menu_item is None:
            raise PricingError(
                f"Menu item {row.get('menu_item_id')} not found or unavailable.",
                code="item_unavailable",
            )
        selections = [
            (sel.get("group_id"), sel.get("option_id"))
            for sel in (row.get("selections") or [])
        ]
        is_free = bool(allow_free and row.get("is_free")) and not staff_comp
        try:
            line = validate_and_price_line(
                menu_item,
                row.get("quantity", 1),
                selections,
                special_instructions=row.get("special_instructions", ""),
                loyalty_eligible=loyalty_eligible and not staff_comp and not is_free,
            )
        except LineValidationError as exc:
            raise PricingError(f"{menu_item.name}: {exc}", code=getattr(exc, "code", None) or "invalid_line")

        if staff_comp or is_free:
            unit_price = list_unit_price = ZERO
        else:
            unit_price = line.unit_price
            list_unit_price = line.unit_price + to_decimal(line.unit_discount)
        tax_class = _tax_class(menu_item)
        modifier_total = sum(
            (to_decimal(opt.price_effect) for opt in line.options if opt.kind != "variant"), ZERO,
        )

        priced.append(PricedRequestLine(
            line=LineInput(
                key=f"{key_prefix}:{index}",
                name=line.name,
                quantity=line.quantity,
                unit_price=unit_price,
                list_unit_price=list_unit_price,
                tax_class=tax_class,
                menu_item_id=menu_item.id,
                category_id=getattr(menu_item, "category_ref_id", None),
                option_ids=frozenset(o.option_id for o in line.options if o.option_id),
                modifier_unit_total=ZERO if (staff_comp or is_free) else modifier_total,
            ),
            item_fields={
                "menu_item": menu_item,
                "name": line.name,
                "price": unit_price,
                "list_unit_price": list_unit_price,
                "quantity": line.quantity,
                "subtotal": unit_price * line.quantity,
                "special_instructions": line.special_instructions,
                "tax_class": tax_class,
                **(
                    {
                        "is_complimentary": True,
                        "complimentary_value": to_decimal(line.unit_price) * line.quantity,
                        "complimentary_by": free_by,
                    }
                    if is_free else {}
                ),
            },
            options=line.options,
            points=0 if (staff_comp or is_free) else line.points,
        ))
    return priced


def mark_reward(priced_line: PricedRequestLine) -> PricedRequestLine:
    """Flag a requested line as an offer's reward item."""
    from dataclasses import replace

    priced_line.line = replace(priced_line.line, is_reward=True)
    priced_line.item_fields["is_promotion_reward"] = True
    return priced_line


def line_from_order_item(item) -> LineInput:
    """An existing order line, from its stored snapshot (callers prefetch options/menu_item)."""
    price = to_decimal(item.price)
    list_price = to_decimal(item.list_unit_price) if item.list_unit_price is not None else price
    options = list(item.options.all())
    return LineInput(
        key=str(item.pk),
        name=item.name,
        quantity=item.quantity,
        unit_price=price,
        list_unit_price=max(list_price, price),
        tax_class=item.tax_class or TAX_CLASS_STANDARD,
        menu_item_id=item.menu_item_id,
        category_id=item.menu_item.category_ref_id if item.menu_item_id and item.menu_item else None,
        option_ids=frozenset(o.option_id for o in options if o.option_id),
        modifier_unit_total=sum(
            (to_decimal(o.price_effect) for o in options if o.kind != "variant"), ZERO,
        ),
        is_reward=bool(getattr(item, "is_promotion_reward", False)),
    )
