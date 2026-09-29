"""
PricingService: the single authority for order money in Zentro.

    lines (ItemPricing) -> DiscountEngine -> ChargeEngine -> TaxEngine -> PricingResult

``calculate`` is pure and deterministic. The other functions in this module
load an order's stored inputs, run ``calculate`` and persist the result onto
Order / OrderItem / OrderAdjustment / OrderCharge. Every flow that creates or
changes an order (customer app, guest/table QR, POS online/offline, add items,
discounts, conflict resolution, reward orders) goes through here, so the same
basket always produces the same numbers.
"""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

from django.utils import timezone

from .charges import compute_charges
from .discounts import apply_adjustments
from .items import line_from_order_item
from .money import ZERO, currency_quantum, quantize, to_decimal
from .tax import (
    apply_tax,
    components_from_json,
    components_to_json,
    get_policy,
    resolve_components,
)
from .types import (
    ADJ_MANUAL_DISCOUNT,
    CALC_FIXED,
    CALC_PERCENTAGE,
    CHARGE_SERVICE,
    PRICING_VERSION,
    AdjustmentSpec,
    ChargeSpec,
    PricedLineResult,
    PricingContext,
    PricingError,
    PricingResult,
)

# V1 business rule: one financial discount/reward per order. The engine and the
# schema support several; raising this (and dropping the matching partial
# unique constraint on OrderAdjustment) is all stacking would need.
MAX_ORDER_ADJUSTMENTS = 1

SLOT_TAKEN_MESSAGE = "Remove the current reward before applying another offer."

# Adjustment kinds whose amount another domain computes from the order's
# current lines (e.g. offers → "promotion"). A resolver receives the stored
# OrderAdjustment and the order's LineInputs and returns an AdjustmentSpec,
# so the rule lives in its own app while pricing stays the only place totals
# are calculated.
_ADJUSTMENT_RESOLVERS: dict = {}


def register_adjustment_resolver(kind: str, resolver) -> None:
    _ADJUSTMENT_RESOLVERS[kind] = resolver


# ── Pure calculation ──────────────────────────────────────────────────────────

def calculate(ctx: PricingContext) -> PricingResult:
    policy = get_policy(ctx.policy_code)
    quantum = currency_quantum(ctx.currency_code)

    lines = []
    for inp in ctx.lines:
        unit = quantize(inp.unit_price, quantum)
        list_unit = max(quantize(inp.list_unit_price, quantum), unit)
        line_subtotal = quantize(unit * inp.quantity, quantum)
        lines.append(PricedLineResult(
            key=inp.key,
            name=inp.name,
            quantity=inp.quantity,
            tax_class=inp.tax_class,
            unit_price=unit,
            list_unit_price=list_unit,
            special_discount=quantize((list_unit - unit) * inp.quantity, quantum),
            line_subtotal=line_subtotal,
            discount=quantize(ZERO, quantum),
            net_amount=line_subtotal,
        ))

    discounts = apply_adjustments(ctx.adjustments, lines, quantum)
    goods_amount = sum((ln.net_amount for ln in lines), ZERO)
    charges = compute_charges(ctx.charges, goods_amount, policy, quantum)
    components = ctx.tax_components if ctx.tax_enabled else ()
    taxes = apply_tax(lines, charges, components, policy, quantum)

    subtotal = sum((ln.line_subtotal for ln in lines), ZERO)
    discount_total = sum((d.amount for d in discounts), ZERO)
    tax_total = sum((t.amount for t in taxes), ZERO)
    charge_total = sum((c.amount for c in charges), ZERO)

    if policy.prices_include_tax:
        grand_total = subtotal - discount_total + charge_total
        charge_taxable = sum((c.amount - c.tax for c in charges if c.taxable), ZERO)
        charges_paid = charge_total
    else:
        grand_total = subtotal - discount_total + charge_total + tax_total
        charge_taxable = sum((c.amount for c in charges if c.taxable), ZERO)
        charges_paid = charge_total + sum((c.tax for c in charges), ZERO)

    # Line totals and charges must reconcile to the invoice exactly; a mismatch
    # would mean a bug in allocation, never something to paper over.
    if sum((ln.total for ln in lines), ZERO) + charges_paid != grand_total:
        raise PricingError("Pricing did not reconcile.", code="pricing_reconcile_failed")

    return PricingResult(
        currency_code=ctx.currency_code,
        policy_code=policy.code,
        prices_include_tax=policy.prices_include_tax,
        subtotal=quantize(subtotal, quantum),
        discount_total=quantize(discount_total, quantum),
        taxable_total=quantize(sum((ln.taxable_amount for ln in lines), ZERO) + charge_taxable, quantum),
        tax_total=quantize(tax_total, quantum),
        charge_total=quantize(charge_total, quantum),
        grand_total=quantize(grand_total, quantum),
        lines=lines,
        discounts=discounts,
        taxes=taxes,
        charges=charges,
    )


# ── Building contexts ─────────────────────────────────────────────────────────

def default_charges(merchant, *, fulfillment_type: str | None, order_type: str | None) -> tuple[ChargeSpec, ...]:
    """Charges a new order gets from the merchant's settings."""
    from orders.models import Order

    pct = to_decimal(getattr(merchant, "service_charge_percent", 0))
    if pct <= ZERO:
        return ()
    if order_type in (
        Order.ORDER_TYPE_STAFF_COMP,
        Order.ORDER_TYPE_REWARD_REDEMPTION,
        Order.ORDER_TYPE_PUNCH_REDEMPTION,
    ):
        return ()
    if getattr(merchant, "service_charge_dine_in_only", True) and fulfillment_type != Order.FULFILLMENT_DINE_IN:
        return ()
    return (ChargeSpec(kind=CHARGE_SERVICE, label="Service charge", calc_type=CALC_PERCENTAGE, value=pct),)


def context_for_merchant(merchant, lines, *, charges=(), adjustments=()) -> PricingContext:
    """Context for a basket priced with the merchant's current settings."""
    components = resolve_components(merchant)
    return PricingContext(
        currency_code=merchant.currency_code or "NPR",
        policy_code=getattr(merchant, "tax_policy", None) or "legacy",
        tax_enabled=bool(components),
        tax_components=components,
        lines=tuple(lines),
        adjustments=tuple(adjustments),
        charges=tuple(charges),
    )


def _adjustment_spec(adj) -> AdjustmentSpec:
    keys = None
    if adj.eligible_item_ids is not None:
        keys = frozenset(str(i) for i in adj.eligible_item_ids)
    return AdjustmentSpec(
        kind=adj.kind,
        calc_type=adj.calc_type,
        value=to_decimal(adj.value),
        label=adj.label,
        max_amount=to_decimal(adj.max_amount) if adj.max_amount is not None else None,
        min_subtotal=to_decimal(adj.min_subtotal) if adj.min_subtotal is not None else None,
        eligible_line_keys=keys,
        source_ref=f"adjustment:{adj.pk}",
    )


def _legacy_discount_adjustment(order):
    """
    Orders discounted before pricing v1 only carry Order.discount_*; turn that
    into a stored adjustment the first time the order is re-priced.
    """
    from orders.models import OrderAdjustment

    if to_decimal(order.discount_amount) <= ZERO or order.adjustments.exists():
        return None
    if order.discount_type == CALC_PERCENTAGE and to_decimal(order.discount_value) > ZERO:
        calc_type, value = CALC_PERCENTAGE, to_decimal(order.discount_value)
    else:
        calc_type, value = CALC_FIXED, to_decimal(order.discount_amount)
    return OrderAdjustment.objects.create(
        order=order, kind=ADJ_MANUAL_DISCOUNT, calc_type=calc_type, value=value,
        label="Discount", source_ref="legacy",
    )


def context_for_order(order, items) -> PricingContext:
    """Context rebuilt from an order's own stored inputs and snapshots."""
    merchant = order.merchant
    if order.pricing_version:
        components = components_from_json(order.tax_components_snapshot)
        policy_code = order.tax_policy_snapshot or "legacy"
        currency = order.currency_code_snapshot or merchant.currency_code
    else:
        components = resolve_components(merchant)
        policy_code = getattr(merchant, "tax_policy", None) or "legacy"
        currency = merchant.currency_code

    _legacy_discount_adjustment(order)
    lines = tuple(line_from_order_item(i) for i in items)
    adjustments = []
    for adj in order.adjustments.filter(status="active").order_by("id"):
        resolver = _ADJUSTMENT_RESOLVERS.get(adj.kind)
        if resolver is None:
            adjustments.append(_adjustment_spec(adj))
        else:
            spec = resolver(adj, lines, order)
            adjustments.append(replace(spec, source_ref=f"adjustment:{adj.pk}"))
    charges = [
        ChargeSpec(kind=c.kind, label=c.label, calc_type=c.calc_type, value=to_decimal(c.value), taxable=c.taxable)
        for c in order.charges.order_by("id")
    ]
    if not order.pricing_version and not charges and to_decimal(order.service_charge) > ZERO:
        charges = [ChargeSpec(kind=CHARGE_SERVICE, label="Service charge", calc_type=CALC_FIXED,
                              value=to_decimal(order.service_charge))]
    return PricingContext(
        currency_code=currency or "NPR",
        policy_code=policy_code,
        tax_enabled=bool(components),
        tax_components=components,
        lines=lines,
        adjustments=tuple(adjustments),
        charges=tuple(charges),
    )


def order_items_for_pricing(order):
    return list(
        order.items.all().select_related("menu_item").prefetch_related("options").order_by("id")
    )


# ── Persistence ───────────────────────────────────────────────────────────────

def _rate_str(rate: Decimal) -> str:
    return format(rate.normalize(), "f")


def order_fields(ctx: PricingContext, result: PricingResult, merchant) -> dict:
    """Order column values for a pricing result (new orders and re-pricing)."""
    from config.tax_utils import get_tax_display_label

    first = next((d for d in result.discounts), None)
    return {
        "subtotal": result.subtotal,
        "discount_type": (first.calc_type if first and first.amount > ZERO else ""),
        "discount_value": (first.value if first and first.amount > ZERO else ZERO),
        "discount_amount": result.discount_total,
        "taxable_amount": result.taxable_total,
        "tax_amount": result.tax_total,
        "tax_breakdown": [
            {"name": t.name, "rate": _rate_str(t.rate), "amount": str(t.amount)} for t in result.taxes
        ],
        "service_charge": sum((c.amount for c in result.charges if c.kind == CHARGE_SERVICE), ZERO),
        "total_amount": result.grand_total,
        "pricing_version": PRICING_VERSION,
        "tax_policy_snapshot": result.policy_code,
        "prices_include_tax": result.prices_include_tax,
        "tax_components_snapshot": components_to_json(ctx.tax_components),
        "currency_code_snapshot": ctx.currency_code,
        "currency_symbol_snapshot": getattr(merchant, "currency_symbol", "") or "",
        "tax_type_snapshot": get_tax_display_label(merchant)[:50] if ctx.tax_components else "",
        "tax_rate_snapshot": sum((c.rate for c in ctx.tax_components), ZERO),
    }


def _persist(order, ctx: PricingContext, result: PricingResult, items_by_key: dict) -> None:
    from orders.models import OrderAdjustmentAllocation, OrderCharge, OrderItem

    changed_items = []
    for line in result.lines:
        item = items_by_key[line.key]
        item.list_unit_price = line.list_unit_price
        item.discount_amount = line.discount
        item.taxable_amount = line.taxable_amount
        item.tax_amount = line.tax
        item.total_amount = line.total
        changed_items.append(item)
    OrderItem.objects.bulk_update(
        changed_items,
        ["list_unit_price", "discount_amount", "taxable_amount", "tax_amount", "total_amount"],
        batch_size=200,
    )

    active = {f"adjustment:{a.pk}": a for a in order.adjustments.filter(status="active")}
    OrderAdjustmentAllocation.objects.filter(adjustment__in=active.values()).delete()
    allocation_rows = []
    for discount in result.discounts:
        adj = active.get(discount.source_ref)
        if adj is None:
            continue
        adj.amount = discount.amount
        adj.eligible = discount.eligible
        adj.reason = discount.reason
        adj.save(update_fields=["amount", "eligible", "reason", "updated_at"])
        for key, amount in discount.allocations.items():
            allocation_rows.append(OrderAdjustmentAllocation(
                adjustment=adj, order_item=items_by_key[key], amount=amount,
            ))
    OrderAdjustmentAllocation.objects.bulk_create(allocation_rows, batch_size=200)

    order.charges.all().delete()
    OrderCharge.objects.bulk_create([
        OrderCharge(
            order=order, kind=c.kind, label=c.label, calc_type=c.calc_type,
            value=c.value, amount=c.amount, taxable=c.taxable, tax_amount=c.tax,
        )
        for c in result.charges
    ])

    fields = order_fields(ctx, result, order.merchant)
    for name, value in fields.items():
        setattr(order, name, value)
    order.save(update_fields=[*fields.keys(), "updated_at"])


def price_new_order_lines(merchant, priced_lines, *, fulfillment_type, order_type):
    """Price a new basket. Returns ``(ctx, result)`` for ``Order`` creation."""
    ctx = context_for_merchant(
        merchant,
        [p.line for p in priced_lines],
        charges=default_charges(merchant, fulfillment_type=fulfillment_type, order_type=order_type),
    )
    return ctx, calculate(ctx)


def persist_new_order(order, ctx: PricingContext, result: PricingResult, created_items) -> None:
    """Write line-level results for items just created from ``priced_lines`` (same order)."""
    items_by_key = {line.key: item for line, item in zip(result.lines, created_items)}
    _persist(order, ctx, result, items_by_key)


def reprice_order(order) -> PricingResult:
    """
    Recalculate an open order from its stored lines, adjustments and charges,
    re-validating any attached discount, and persist the result.
    """
    if order.pricing_locked_at:
        raise PricingError(
            "This order's pricing is final and can no longer change.", code="pricing_locked",
        )
    items = order_items_for_pricing(order)
    ctx = context_for_order(order, items)
    result = calculate(ctx)
    _persist(order, ctx, result, {str(i.pk): i for i in items})
    return result


def attach_adjustment(order, spec: AdjustmentSpec, *, replaces_kinds=(), created_by=None):
    """
    Attach an order-level discount/reward and re-price. The caller must hold a
    row lock on ``order``. Applying the same kind listed in ``replaces_kinds``
    swaps it (e.g. a cashier changing 10% to 15%); anything else occupying the
    slot is refused with ``discount_slot_taken``.
    """
    from orders.models import OrderAdjustment

    if order.pricing_locked_at:
        raise PricingError("This order's pricing is final and can no longer change.", code="pricing_locked")

    _legacy_discount_adjustment(order)
    active = list(order.adjustments.filter(status="active"))
    blocking = [a for a in active if a.kind not in replaces_kinds]
    if len(blocking) + 1 > MAX_ORDER_ADJUSTMENTS:
        current = blocking[0]
        raise PricingError(
            SLOT_TAKEN_MESSAGE, code="discount_slot_taken",
            details={"current_kind": current.kind, "current_label": current.label},
        )
    now = timezone.now()
    for adj in active:
        if adj.kind in replaces_kinds:
            adj.status = "removed"
            adj.removed_at = now
            adj.save(update_fields=["status", "removed_at", "updated_at"])

    adjustment = OrderAdjustment.objects.create(
        order=order,
        kind=spec.kind,
        calc_type=spec.calc_type,
        value=spec.value,
        label=spec.label,
        max_amount=spec.max_amount,
        min_subtotal=spec.min_subtotal,
        eligible_item_ids=sorted(int(k) for k in spec.eligible_line_keys) if spec.eligible_line_keys else None,
        source_ref=spec.source_ref,
        created_by=created_by,
    )
    result = reprice_order(order)
    adjustment.refresh_from_db()
    return adjustment, result


def remove_adjustments(order, *, kinds=None) -> PricingResult:
    if order.pricing_locked_at:
        raise PricingError("This order's pricing is final and can no longer change.", code="pricing_locked")
    _legacy_discount_adjustment(order)
    qs = order.adjustments.filter(status="active")
    if kinds:
        qs = qs.filter(kind__in=kinds)
    qs.update(status="removed", removed_at=timezone.now(), updated_at=timezone.now())
    return reprice_order(order)
