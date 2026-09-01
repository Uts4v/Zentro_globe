"""
config/order_utils.py

Shared sanitizers/validators for order line items (C-5). Every order-creation
path must validate item quantity through `parse_quantity` so that fractional,
non-numeric, negative, zero, or absurdly large quantities can never reach the
DB as order items.
"""

MIN_ITEM_QUANTITY = 1
MAX_ITEM_QUANTITY = 999


class QuantityValidationError(ValueError):
    """Raised when a client-supplied quantity is invalid."""


def parse_quantity(value, *, default=None):
    """
    Coerce a client-supplied quantity to an int in [1, 999].

    Accepts int, integral float/Decimal, and numeric strings. Rejects bool,
    fractional values, negatives, zero, and quantities above MAX_ITEM_QUANTITY.
    If `value` is None and `default` is given, `default` is returned; if no
    default is given, `None` is treated as a missing-required-field error.
    """
    if value is None:
        if default is not None:
            return default
        raise QuantityValidationError("quantity is required")

    if isinstance(value, bool):
        raise QuantityValidationError("quantity must be an integer between "
                                      "1 and 999")

    try:
        if isinstance(value, str):
            value = int(value.strip())
        else:
            integer = int(value)
            if integer != value:
                raise QuantityValidationError(
                    "quantity must be a whole number between 1 and 999"
                )
            value = integer
    except (TypeError, ValueError, OverflowError):
        raise QuantityValidationError("quantity must be an integer between "
                                      "1 and 999")

    if value < MIN_ITEM_QUANTITY or value > MAX_ITEM_QUANTITY:
        raise QuantityValidationError(
            f"quantity must be between {MIN_ITEM_QUANTITY} and "
            f"{MAX_ITEM_QUANTITY}"
        )
    return value


__all__ = [
    "MIN_ITEM_QUANTITY",
    "MAX_ITEM_QUANTITY",
    "QuantityValidationError",
    "parse_quantity",
]