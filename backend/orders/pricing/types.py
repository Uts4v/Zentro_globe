"""
Value types passed into and out of the pricing engine.

Inputs are plain, immutable descriptions (no ORM objects), so ``calculate`` is
a pure function: the same context always produces the same ``PricingResult``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from .money import ZERO

PRICING_VERSION = "v1"

TAX_CLASS_STANDARD = "standard"
TAX_CLASS_EXEMPT = "exempt"
TAX_CLASS_ZERO_RATED = "zero_rated"
TAX_CLASSES = (TAX_CLASS_STANDARD, TAX_CLASS_EXEMPT, TAX_CLASS_ZERO_RATED)

CALC_PERCENTAGE = "percentage"
CALC_FIXED = "fixed"

ADJ_MANUAL_DISCOUNT = "manual_discount"
ADJ_LOYALTY_REWARD = "loyalty_reward"
ADJ_PUNCH_REWARD = "punch_reward"
ADJ_PROMOTION = "promotion"
ADJUSTMENT_KINDS = (ADJ_MANUAL_DISCOUNT, ADJ_LOYALTY_REWARD, ADJ_PUNCH_REWARD, ADJ_PROMOTION)

CHARGE_SERVICE = "service"
CHARGE_DELIVERY = "delivery"
CHARGE_PACKAGING = "packaging"
CHARGE_OTHER = "other"
CHARGE_KINDS = (CHARGE_SERVICE, CHARGE_DELIVERY, CHARGE_PACKAGING, CHARGE_OTHER)

# Reason codes returned when an adjustment no longer applies.
REASON_MINIMUM_ORDER_NOT_MET = "MINIMUM_ORDER_NOT_MET"
REASON_NO_ELIGIBLE_ITEMS = "NO_ELIGIBLE_ITEMS"


class PricingError(Exception):
    """A request the pricing engine must refuse, with a machine-readable code."""

    def __init__(self, message: str, *, code: str = "pricing_error", details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class LineInput:
    """One order line, already priced per unit by the item pricing step."""

    key: str
    name: str
    quantity: int
    unit_price: Decimal            # effective selling price incl. variants/modifiers/Today's Special
    list_unit_price: Decimal       # price before Today's Special (== unit_price when none applies)
    tax_class: str = TAX_CLASS_STANDARD
    menu_item_id: int | None = None
    category_id: int | None = None


@dataclass(frozen=True)
class AdjustmentSpec:
    """An order-level discount or reward, as stored (never a client-sent amount)."""

    kind: str
    calc_type: str
    value: Decimal
    label: str = ""
    max_amount: Decimal | None = None
    min_subtotal: Decimal | None = None
    # None = whole order; otherwise only these line keys are discounted.
    eligible_line_keys: frozenset[str] | None = None
    source_ref: str = ""


@dataclass(frozen=True)
class ChargeSpec:
    kind: str
    label: str
    calc_type: str
    value: Decimal
    # None = follow the tax policy's default for charges.
    taxable: bool | None = None


@dataclass(frozen=True)
class TaxComponent:
    name: str
    rate: Decimal


@dataclass(frozen=True)
class PricingContext:
    currency_code: str
    policy_code: str
    tax_enabled: bool
    tax_components: tuple[TaxComponent, ...]
    lines: tuple[LineInput, ...]
    adjustments: tuple[AdjustmentSpec, ...] = ()
    charges: tuple[ChargeSpec, ...] = ()


@dataclass
class PricedLineResult:
    key: str
    name: str
    quantity: int
    tax_class: str
    unit_price: Decimal
    list_unit_price: Decimal
    special_discount: Decimal      # (list - effective) x qty; informational, not a discount slot
    line_subtotal: Decimal         # effective unit price x qty
    discount: Decimal = ZERO       # order-level adjustments allocated to this line
    net_amount: Decimal = ZERO     # line_subtotal - discount (tax-inclusive when prices include tax)
    taxable_amount: Decimal = ZERO
    tax: Decimal = ZERO
    total: Decimal = ZERO          # what the customer pays for this line


@dataclass
class DiscountResult:
    kind: str
    calc_type: str
    value: Decimal
    label: str
    source_ref: str
    eligible: bool
    amount: Decimal
    allocations: dict[str, Decimal] = field(default_factory=dict)
    reason: dict | None = None


@dataclass
class TaxComponentResult:
    name: str
    rate: Decimal
    amount: Decimal


@dataclass
class ChargeResult:
    kind: str
    label: str
    calc_type: str
    value: Decimal
    amount: Decimal
    taxable: bool
    tax: Decimal = ZERO


@dataclass
class PricingResult:
    currency_code: str
    policy_code: str
    prices_include_tax: bool
    subtotal: Decimal
    discount_total: Decimal
    taxable_total: Decimal
    tax_total: Decimal
    charge_total: Decimal
    grand_total: Decimal
    lines: list[PricedLineResult]
    discounts: list[DiscountResult]
    taxes: list[TaxComponentResult]
    charges: list[ChargeResult]
    pricing_version: str = PRICING_VERSION

    @property
    def messages(self) -> list[dict]:
        """Why an attached discount currently gives nothing, for the UI."""
        return [
            {"kind": d.kind, "label": d.label, **d.reason}
            for d in self.discounts
            if not d.eligible and d.reason
        ]

    def line(self, key: str) -> PricedLineResult:
        for line in self.lines:
            if line.key == key:
                return line
        raise KeyError(key)

    def to_dict(self) -> dict:
        money = str
        return {
            "pricing_version": self.pricing_version,
            "currency": self.currency_code,
            "tax_policy": self.policy_code,
            "prices_include_tax": self.prices_include_tax,
            "subtotal": money(self.subtotal),
            "discount_total": money(self.discount_total),
            "taxable_total": money(self.taxable_total),
            "tax_total": money(self.tax_total),
            "charge_total": money(self.charge_total),
            "grand_total": money(self.grand_total),
            "lines": [
                {
                    "key": ln.key,
                    "name": ln.name,
                    "quantity": ln.quantity,
                    "tax_class": ln.tax_class,
                    "unit_price": money(ln.unit_price),
                    "list_unit_price": money(ln.list_unit_price),
                    "special_discount": money(ln.special_discount),
                    "line_subtotal": money(ln.line_subtotal),
                    "discount": money(ln.discount),
                    "taxable_amount": money(ln.taxable_amount),
                    "tax": money(ln.tax),
                    "line_total": money(ln.total),
                }
                for ln in self.lines
            ],
            "discounts": [
                {
                    "kind": d.kind,
                    "label": d.label,
                    "calc_type": d.calc_type,
                    "value": money(d.value),
                    "eligible": d.eligible,
                    "amount": money(d.amount),
                    "reason": d.reason,
                    "allocations": {k: money(v) for k, v in d.allocations.items()},
                }
                for d in self.discounts
            ],
            "taxes": [
                {"name": t.name, "rate": money(t.rate), "amount": money(t.amount)}
                for t in self.taxes
            ],
            "charges": [
                {
                    "kind": c.kind,
                    "label": c.label,
                    "calc_type": c.calc_type,
                    "value": money(c.value),
                    "amount": money(c.amount),
                    "taxable": c.taxable,
                    "tax": money(c.tax),
                }
                for c in self.charges
            ],
            "messages": self.messages,
        }
