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

from config.menu_pricing import LineValidationError, PricedOption, validate_and_price_line

from .money import ZERO, to_decimal
from .types import TAX_CLASS_STANDARD, TAX_CLASSES, LineInput, PricingError


@dataclass
class PricedRequestLine:
    line: LineInput
    item_fields: dict            # kwargs for OrderItem(...)
    options: list[PricedOption] = field(default_factory=list)
    points: int = 0


def _tax_class(menu_item) -> str:
    value = getattr(menu_item, "tax_class", TAX_CLASS_STANDARD) or TAX_CLASS_STANDARD
    return value if value in TAX_CLASSES else TAX_CLASS_STANDARD


def price_request_lines(
    merchant,
    request_items,
    *,
    loyalty_eligible: bool = True,
    staff_comp: bool = False,
    key_prefix: str = "new",
) -> list[PricedRequestLine]:
    """
    Price client-requested lines for ``merchant``. Only the item ids, selections,
    quantities and instructions are read from the request; every price comes
    from the database. Raises ``PricingError`` for anything the server rejects.
    """
    from merchants.models import MenuItem

    ids = [row.get("menu_item_id") for row in request_items]
    menu_items = {
        mi.id: mi
        for mi in MenuItem.objects.filter(id__in=ids, merchant=merchant, is_available=True)
    }

    priced = []
    for index, row in enumerate(request_items):
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
        try:
            line = validate_and_price_line(
                menu_item,
                row.get("quantity", 1),
                selections,
                special_instructions=row.get("special_instructions", ""),
                loyalty_eligible=loyalty_eligible and not staff_comp,
            )
        except LineValidationError as exc:
            raise PricingError(f"{menu_item.name}: {exc}", code=getattr(exc, "code", None) or "invalid_line")

        if staff_comp:
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
                modifier_unit_total=ZERO if staff_comp else modifier_total,
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
            },
            options=line.options,
            points=0 if staff_comp else line.points,
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
