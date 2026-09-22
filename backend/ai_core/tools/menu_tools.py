"""AI tools that let the assistant answer menu & cart questions accurately.

These read the live menu (including variants/extras) and reuse the same
config.menu_pricing validation so AI answers match exactly what a customer
would pay — the backend stays the single source of truth.
"""

from __future__ import annotations

from .registry import tool_registry


def get_menu_item(*, merchant, menu_item_id=None, name=None, **kwargs):
    from merchants.models import MenuItem

    qs = MenuItem.objects.filter(
        merchant=merchant, status="active", is_available=True,
    ).select_related("category_ref").prefetch_related("option_groups__options")

    item = None
    if menu_item_id is not None:
        item = qs.filter(pk=menu_item_id).first()
    elif name:
        item = qs.filter(name__icontains=name.strip()).first()

    if item is None:
        return {"error": "Menu item not found."}

    groups = []
    for group in item.option_groups.filter(is_active=True).order_by("display_order", "id"):
        groups.append({
            "name": group.name,
            "kind": group.kind,
            "required": group.required,
            "min_select": group.min_select,
            "max_select": group.max_select,
            "options": [
                {
                    "name": opt.name,
                    "price": str(opt.price) if opt.price is not None else None,
                    "price_delta": str(opt.price_delta),
                    "is_available": opt.is_available,
                }
                for opt in group.options.order_by("display_order", "id")
            ],
        })

    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "base_price": str(item.price),
        "category": item.category,
        "image_url": item.image_url,
        "dietary_tags": item.dietary_tags,
        "allergens": item.allergens,
        "points_per_item": item.points_per_item,
        "option_groups": groups,
    }


def validate_cart(*, merchant, menu_item_id, selections=None, quantity=1, **kwargs):
    """Validate a prospective cart line and return its exact server price."""
    from config.menu_pricing import (
        validate_and_price_line, LineValidationError, menu_item_from_selection,
    )

    try:
        menu_item = menu_item_from_selection(merchant, menu_item_id)
        line = validate_and_price_line(
            menu_item,
            quantity,
            [(s.get("group_id"), s.get("option_id")) for s in (selections or [])],
        )
    except LineValidationError as exc:
        return {"valid": False, "error": str(exc)}

    return {
        "valid": True,
        "name": line.name,
        "unit_price": str(line.unit_price),
        "quantity": line.quantity,
        "subtotal": str(line.subtotal),
        "points_earned": line.points,
        "options": [
            {
                "group_name": opt.group_name,
                "option_name": opt.option_name,
                "price_effect": str(opt.price_effect),
            }
            for opt in line.options
        ],
    }


def register_menu_tools():
    tool_registry.register(
        get_menu_item,
        name="get_menu_item",
        description="Get a merchant's menu item with base price, category, dietary tags, allergens, points, and its selectable option groups (variants and modifiers/extras) with absolute prices and price deltas.",
        parameters={
            "type": "object",
            "properties": {
                "menu_item_id": {
                    "type": "integer",
                    "description": "ID of the menu item to fetch.",
                },
                "name": {
                    "type": "string",
                    "description": "Search term to match a menu item by name.",
                },
            },
        },
    )
    tool_registry.register(
        validate_cart,
        name="validate_cart",
        description="Validate a customer's prospective cart line (menu item + selected variant/extras + quantity) and return the exact authoritative price the server will charge. Use this before telling a customer what something costs.",
        parameters={
            "type": "object",
            "properties": {
                "menu_item_id": {
                    "type": "integer",
                    "description": "ID of the menu item.",
                },
                "quantity": {
                    "type": "integer",
                    "description": "Quantity (default 1).",
                },
                "selections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "group_id": {"type": "integer"},
                            "option_id": {"type": "integer"},
                        },
                    },
                    "description": "Selected variant/extras as [{'group_id': <id>, 'option_id': <id>}].",
                },
            },
        },
    )