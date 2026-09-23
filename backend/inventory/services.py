"""
inventory/services.py

Authoritative service layer. Every InventoryBalance mutation flows through
InventoryMovementService. Nothing else in the codebase writes balances.

Guarantees:
  * tenant scoping (merchant passed explicitly, verified on every object)
  * transaction.atomic() + select_for_update() on balances
  * idempotency keys prevent duplicate receiving / count approval / transfers
  * Decimal everywhere
  * immutable ledger: incorrect entries are corrected with REVERSAL, never
    silently deleted
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.db.models import F, Max, Q, Sum
from django.utils import timezone

from .models import (
    AnItemType,
    CountStatus,
    DEFAULT_CATEGORIES,
    DEFAULT_LOCATIONS,
    InventoryAdjustment,
    InventoryAuditLog,
    InventoryBalance,
    InventoryCategory,
    InventoryLocation,
    InventoryMovement,
    InventoryReceiving,
    InventoryReceivingLine,
    InventoryTransfer,
    InventoryTransferLine,
    InventorySettings,
    InventoryWasteRecord,
    MovementSource,
    MovementType,
    OrderStatus,
    PurchaseOrder,
    PurchaseOrderLine,
    StockCount,
    StockCountLine,
    Supplier,
    SupplierItem,
    TransferStatus,
    UnitKind,
    UnitOfMeasure,
    InventoryItem,
)

ZERO = Decimal("0")

# ─────────────────────────────────────────────────────────────────────────────
# Unit helpers
# ─────────────────────────────────────────────────────────────────────────────


def to_decimal(value, max_places: int = 6):
    if value is None or value == "":
        return None
    try:
        return Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"Invalid decimal value: {value!r}")


def same_kind(a: UnitOfMeasure, b: UnitOfMeasure) -> bool:
    return a.kind == b.kind


def convert_quantity(
    quantity: Decimal,
    from_unit: UnitOfMeasure,
    to_unit: UnitOfMeasure,
) -> Decimal:
    """Convert a quantity from one unit to another. Same kind only.

    value_in_base = qty * from.factor_to_base
    to_new        = value_in_base / to.factor_to_base
    """
    if not same_kind(from_unit, to_unit):
        raise ValueError(
            f"Cannot convert {from_unit.code} ({from_unit.kind}) to "
            f"{to_unit.code} ({to_unit.kind}): incompatible unit kinds."
        )
    base = quantity * from_unit.factor_to_base
    base = base.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    return base / to_unit.factor_to_base


def base_quantity_for_purchase(
    item: InventoryItem,
    quantity_in_purchase_units: Decimal,
    purchase_unit_conversion: Decimal | None = None,
) -> Decimal:
    """Base units represented by `quantity_in_purchase_units`.

    Uses the explicit purchase-unit conversion (item-specific, e.g.
    25kg sack = 25000 g). Never guesses conversions between kinds.
    """
    conversion = purchase_unit_conversion
    if conversion is None:
        conversion = item.purchase_unit_conversion
    if conversion:
        return (quantity_in_purchase_units * conversion).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        )
    # No purchase unit: treat the entered quantity as base units already.
    return quantity_in_purchase_units.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


# ─────────────────────────────────────────────────────────────────────────────
# Stock status
# ─────────────────────────────────────────────────────────────────────────────


def stock_status(item: InventoryItem, on_hand: Decimal) -> str:
    """HEALTHY | LOW | CRITICAL | OUT | OVERSTOCK"""
    qty = on_hand
    if qty <= 0:
        return "OUT"

    par = item.par_level
    reorder = item.reorder_point
    critical = item.critical_level
    if reorder is None and par is None and critical is None:
        return "HEALTHY"

    if par is not None and qty > par * Decimal("1.5"):
        return "OVERSTOCK"

    if critical is None:
        critical = (reorder or ZERO) / 2 if reorder else ZERO
    if critical > 0 and qty <= critical:
        return "CRITICAL"

    if reorder is not None and qty <= reorder:
        return "LOW"
    return "HEALTHY"


def suggested_order_qty(item: InventoryItem, on_hand: Decimal) -> Decimal:
    """Initial formula: max(PAR - current_stock, 0)."""
    if item.par_level is None:
        return ZERO
    return max(item.par_level - on_hand, ZERO)


# ─────────────────────────────────────────────────────────────────────────────
# Seeding / reference data
# ─────────────────────────────────────────────────────────────────────────────


def seed_default_units() -> None:
    """Create system units as needed (idempotent, global catalog).

    Each unit has a unique ``code`` among system rows (partial unique index
    ``uniq_inventory_system_unit_code``), so racing requests can never create
    duplicates — ``get_or_create`` re-fetches on conflict.
    """
    system = {
        "mg": (UnitKind.WEIGHT, "0.001", True),
        "g": (UnitKind.WEIGHT, "1", True),
        "kg": (UnitKind.WEIGHT, "1000", True),
        "ml": (UnitKind.VOLUME, "1", True),
        "L": (UnitKind.VOLUME, "1000", True),
        "piece": (UnitKind.COUNT, "1", True),
    }
    for code, (kind, factor, is_base) in system.items():
        UnitOfMeasure.objects.get_or_create(
            merchant=None,
            code=code,
            defaults={
                "name": {"piece": "Piece", "L": "Litre"}.get(code, code),
                "kind": kind,
                "factor_to_base": factor,
                "is_base": is_base,
            },
        )


def get_system_unit(code: str) -> UnitOfMeasure:
    return UnitOfMeasure.objects.get(merchant__isnull=True, code=code)


def seed_merchant_reference_data(merchant) -> None:
    """Idempotently ensure a merchant has categories, locations and units.

    Runs inside a transaction and uses ``get_or_create`` everywhere so that
    concurrent requests cannot violate the per-merchant or per-system unique
    constraints.
    """
    with transaction.atomic():
        seed_default_units()

        for idx, name in enumerate(DEFAULT_CATEGORIES):
            InventoryCategory.objects.get_or_create(
                merchant=merchant,
                name=name,
                defaults={"display_order": idx, "is_default": True},
            )

        for idx, name in enumerate(DEFAULT_LOCATIONS):
            InventoryLocation.objects.get_or_create(
                merchant=merchant,
                name=name,
                defaults={
                    "display_order": idx,
                    "is_default": (idx == 0),
                },
            )

        InventorySettings.for_merchant(merchant)


def validate_merchant(obj, merchant, label="object"):
    if obj.merchant_id != merchant.id:
        raise PermissionError(f"Cross-merchant access blocked: {label} belongs to another merchant.")


# ─────────────────────────────────────────────────────────────────────────────
# The authoritative movement service
# ─────────────────────────────────────────────────────────────────────────────


class InventoryMovementService:
    """Single entry point for all stock mutations."""

    # ── Low level: apply one signed change to one item+location ────────────

    @staticmethod
    @transaction.atomic
    def apply_change(
        *,
        merchant,
        location,
        inventory_item,
        quantity_change: Decimal,
        movement_type: str,
        reason: str = "",
        note: str = "",
        source_type: str = "",
        source_id: str = "",
        performed_by=None,
        approved_by=None,
        unit_cost: Decimal | None = None,
        idempotency_key: str | None = None,
        reversal_of=None,
        prevent_negative: bool | None = None,
    ) -> InventoryMovement:
        """Apply a signed quantity change. Returns the created movement.

        Concurrency: the InventoryBalance row is locked with select_for_update
        so two employees receiving the same item cannot lose each other's work.
        """
        validate_merchant(location, merchant, "location")
        validate_merchant(inventory_item, merchant, "inventory_item")

        if idempotency_key:
            existing = InventoryMovement.objects.filter(
                merchant=merchant, idempotency_key=idempotency_key
            ).first()
            if existing:
                return existing

        change = to_decimal(quantity_change)
        if change == 0:
            raise ValueError("Quantity change cannot be zero.")

        if unit_cost is not None:
            unit_cost = to_decimal(unit_cost, 4).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )

        if prevent_negative is None:
            prevent_negative = InventorySettings.for_merchant(merchant).prevent_negative_stock

        balance, _ = InventoryBalance.objects.select_for_update().get_or_create(
            inventory_item=inventory_item,
            location=location,
            defaults={"merchant": merchant, "on_hand": ZERO},
        )

        before = balance.on_hand
        after = before + change

        if prevent_negative and after < 0:
            raise ValueError(
                f"Insufficient stock for {inventory_item.name} "
                f"@ {location.name}: have {before}, need {-change}."
            )

        # Weighted average cost on inbound movements only.
        if movement_type in (
            MovementType.RECEIVE,
            MovementType.TRANSFER_IN,
            MovementType.OPENING_BALANCE,
            MovementType.MANUAL_ADJUSTMENT,
            MovementType.RETURN_TO_SUPPLIER,
            MovementType.REVERSAL,
        ) and unit_cost is not None and change > 0:
            total_qty = before + change
            new_avg = (
                (before * balance.avg_cost + change * unit_cost) / total_qty
            ) if total_qty else unit_cost
            balance.avg_cost = new_avg.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            balance.latest_cost = unit_cost

        balance.on_hand = after.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        balance.save()

        movement = InventoryMovement.objects.create(
            merchant=merchant,
            location=location,
            inventory_item=inventory_item,
            quantity_change=change,
            movement_type=movement_type,
            source_type=source_type,
            source_id=str(source_id) if source_id else "",
            reason=reason,
            note=note,
            performed_by=performed_by,
            approved_by=approved_by,
            balance_before=before,
            balance_after=after,
            unit_cost=unit_cost,
            idempotency_key=idempotency_key,
            reversal_of=reversal_of,
        )
        return movement

    # ── Domains ─────────────────────────────────────────────────────────────

    @staticmethod
    def opening_balance(*, merchant, item, location, opening_qty, unit_cost=None,
                        performed_by=None, idempotency_key=None) -> InventoryMovement:
        if opening_qty is None or opening_qty <= 0:
            return None
        return InventoryMovementService.apply_change(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_change=opening_qty,
            movement_type=MovementType.OPENING_BALANCE,
            source_type=MovementSource.ITEM_CREATE,
            reason="Opening stock",
            performed_by=performed_by,
            unit_cost=unit_cost,
            idempotency_key=idempotency_key,
        )

    @staticmethod
    def receive(*, merchant, item, location, quantity, purchase_unit_label="",
                purchase_unit_conversion=None, unit_cost=None, reason="",
                source_type=MovementSource.RECEIVING, source_id="", note="",
                performed_by=None, idempotency_key=None) -> InventoryMovement:
        """Receiving increases stock immediately (purchase-unit aware)."""
        qty = to_decimal(quantity)
        if qty <= 0:
            raise ValueError("Receiving quantity must be positive.")
        base_qty = base_quantity_for_purchase(item, qty, purchase_unit_conversion)
        base_qty = base_qty.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

        # unit_cost is per purchase unit; convert to per-base-unit.
        effective_unit_cost = unit_cost
        if unit_cost is not None:
            total_purchase = qty * to_decimal(unit_cost, 4)
            effective_unit_cost = total_purchase / base_qty if base_qty else unit_cost

        return InventoryMovementService.apply_change(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_change=base_qty,
            movement_type=MovementType.RECEIVE,
            source_type=source_type,
            source_id=source_id,
            reason=reason or (purchase_unit_label or "Receiving"),
            note=note,
            performed_by=performed_by,
            unit_cost=effective_unit_cost,
            idempotency_key=idempotency_key,
        )

    @staticmethod
    @transaction.atomic
    def record_waste(*, merchant, item, location, quantity, reason, custom_reason="",
                     note="", performed_by=None, idempotency_key=None):
        qty = to_decimal(quantity)
        if qty <= 0:
            raise ValueError("Waste quantity must be positive.")

        waste = InventoryWasteRecord.objects.create(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity=qty,
            reason=reason,
            custom_reason=custom_reason,
            note=note,
            performed_by=performed_by,
        )
        balance = InventoryBalance.objects.filter(
            merchant=merchant, inventory_item=item, location=location
        ).first()
        per_unit_cost = balance.latest_cost if balance else None
        waste.per_unit_cost = per_unit_cost
        waste.save(update_fields=["per_unit_cost"])

        movement = InventoryMovementService.apply_change(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_change=-qty,
            movement_type=MovementType.EXPLICIT_WASTE,
            source_type=MovementSource.WASTE_RECORD,
            source_id=waste.id,
            reason=reason or "Waste",
            note=note,
            performed_by=performed_by,
            idempotency_key=idempotency_key,
        )
        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=performed_by,
            action=InventoryAuditLog.ACTION_WASTE,
            entity_type="waste",
            entity_id=str(waste.id),
            metadata={"item": item.id, "location": location.id, "quantity": str(qty), "reason": reason},
        )
        return waste

    @staticmethod
    @transaction.atomic
    def manual_adjustment(*, merchant, item, location, quantity_delta, reason, note="",
                          performed_by=None, approved_by=None, idempotency_key=None):
        delta = to_decimal(quantity_delta)
        if delta == 0:
            raise ValueError("Adjustment quantity cannot be zero.")

        adjustment = InventoryAdjustment.objects.create(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_delta=delta,
            reason=reason,
            note=note,
            performed_by=performed_by,
            approved=True,
            approved_by=approved_by,
        )
        movement = InventoryMovementService.apply_change(
            merchant=merchant,
            location=location,
            inventory_item=item,
            quantity_change=delta,
            movement_type=MovementType.MANUAL_ADJUSTMENT,
            source_type=MovementSource.ADJUSTMENT,
            source_id=adjustment.id,
            reason=reason,
            note=note,
            performed_by=performed_by,
            approved_by=approved_by,
            idempotency_key=idempotency_key,
        )
        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=performed_by,
            action=InventoryAuditLog.ACTION_ADJUSTMENT,
            entity_type="adjustment",
            entity_id=str(adjustment.id),
            metadata={"item": item.id, "location": location.id, "delta": str(delta), "reason": reason},
        )
        return adjustment

    @staticmethod
    def transfer(*, merchant, transfer: InventoryTransfer, performed_by=None,
                 idempotency_key=None):
        """Complete a transfer: one TRANSFER_OUT on source, one TRANSFER_IN on dest."""
        if transfer.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant transfer blocked.")
        if transfer.status == TransferStatus.RECEIVED:
            return transfer
        if transfer.status == TransferStatus.CANCELLED:
            raise ValueError("Transfer is cancelled.")
        if transfer.from_location_id == transfer.to_location_id:
            raise ValueError("Source and destination locations must differ.")

        key = idempotency_key or f"transfer-{uuid.uuid4()}"
        with transaction.atomic():
            existing = InventoryMovement.objects.filter(
                merchant=merchant,
                source_type=MovementSource.TRANSFER,
                source_id=str(transfer.id),
                movement_type=MovementType.TRANSFER_OUT,
            ).exists()
            if existing:
                raise ValueError("Transfer already completed.")

            for line in transfer.lines.select_related("inventory_item").all():
                qty = to_decimal(line.quantity)
                validate_merchant(line.inventory_item, merchant, "transfer line item")
                InventoryMovementService.apply_change(
                    merchant=merchant,
                    location=transfer.from_location,
                    inventory_item=line.inventory_item,
                    quantity_change=-qty,
                    movement_type=MovementType.TRANSFER_OUT,
                    source_type=MovementSource.TRANSFER,
                    source_id=transfer.id,
                    reason="Transfer out",
                    note=transfer.note,
                    performed_by=performed_by,
                    idempotency_key=f"{key}-out-{line.id}",
                )
                InventoryMovementService.apply_change(
                    merchant=merchant,
                    location=transfer.to_location,
                    inventory_item=line.inventory_item,
                    quantity_change=qty,
                    movement_type=MovementType.TRANSFER_IN,
                    source_type=MovementSource.TRANSFER,
                    source_id=transfer.id,
                    reason="Transfer in",
                    note=transfer.note,
                    performed_by=performed_by,
                    idempotency_key=f"{key}-in-{line.id}",
                )

            transfer.status = TransferStatus.RECEIVED
            transfer.completed_at = timezone.now()
            transfer.save(update_fields=["status", "completed_at", "updated_at"])

        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=performed_by,
            action=InventoryAuditLog.ACTION_TRANSFER_COMPLETE,
            entity_type="transfer",
            entity_id=str(transfer.id),
            metadata={"from": transfer.from_location_id, "to": transfer.to_location_id},
        )
        return transfer

    @staticmethod
    def reverse(*, merchant, movement: InventoryMovement, performed_by=None,
                reason="Reversal"):
        """Correct an incorrect entry with a REVERSAL movement. History preserved."""
        if movement.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant reversal blocked.")
        return InventoryMovementService.apply_change(
            merchant=merchant,
            location=movement.location,
            inventory_item=movement.inventory_item,
            quantity_change=-movement.quantity_change,
            movement_type=MovementType.REVERSAL,
            source_type=MovementSource.REVERSAL,
            source_id=movement.id,
            reason=reason,
            note=f"Reversing movement #{movement.id} ({movement.movement_type})",
            performed_by=performed_by,
            reversal_of=movement,
            idempotency_key=f"reversal-{movement.id}-{uuid.uuid4()}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Item lifecycle helpers
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Stock counts
# ─────────────────────────────────────────────────────────────────────────────


class StockCountService:
    @staticmethod
    def _items_for_count(merchant, item_ids, location=None, category_ids=None,
                         item_type=None):
        qs = InventoryItem.objects.filter(merchant=merchant, active=True, archived=False)
        if item_ids:
            qs = qs.filter(id__in=item_ids)
        if category_ids:
            qs = qs.filter(category_id__in=category_ids)
        if item_type:
            qs = qs.filter(item_type=item_type)
        return list(qs.distinct())

    @staticmethod
    @transaction.atomic
    def create_count(*, merchant, name, location=None, item_ids=None, count_type="Stock Count",
                     started_by=None, note="") -> StockCount:
        if location:
            validate_merchant(location, merchant, "location")
        count = StockCount.objects.create(
            merchant=merchant,
            name=name,
            count_type=count_type,
            location=location,
            status=CountStatus.IN_PROGRESS,
            started_at=timezone.now(),
            started_by=started_by,
            note=note,
        )
        items = StockCountService._items_for_count(merchant, item_ids, location=location)
        # Snapshot book quantities NOW (moving-target protection).
        for item in items:
            locs = [location] if location else list(
                InventoryLocation.objects.filter(
                    merchant=merchant, inventory_balances__inventory_item=item
                ).order_by("display_order")
            )
            if not locs and not location:
                locs = [item.default_location] if item.default_location else []
            if not locs and location:
                locs = [location]
            for loc in locs:
                if loc is None:
                    continue
                validate_merchant(loc, merchant, "location")
                balance = InventoryBalance.objects.filter(
                    merchant=merchant, inventory_item=item, location=loc
                ).first()
                book = balance.on_hand if balance else ZERO
                StockCountLine.objects.create(
                    stock_count=count,
                    inventory_item=item,
                    location=loc,
                    book_quantity=book,
                    previous_count_at=item.last_count_at,
                )
        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=started_by,
            action=InventoryAuditLog.ACTION_COUNT_STARTED,
            entity_type="stock_count",
            entity_id=str(count.id),
            metadata={"lines": count.lines.count()},
        )
        return count

    @staticmethod
    def upsert_line(*, count: StockCount, line_id, merchant, physical_quantity,
                    note="", performed_by=None):
        if count.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant count blocked.")
        if count.status in (CountStatus.SUBMITTED, CountStatus.APPROVED, CountStatus.CANCELLED):
            raise ValueError(f"Cannot edit a {count.status.lower()} count.")
        line = StockCountLine.objects.filter(stock_count=count, id=line_id).first()
        if not line:
            raise ValueError("Count line not found.")
        physical = to_decimal(physical_quantity)
        if physical is None:
            line.physical_quantity = None
            line.difference = None
        else:
            if physical < 0:
                raise ValueError("Physical count cannot be negative.")
            physical = physical.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            line.physical_quantity = physical
            line.difference = (physical - line.book_quantity).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )
        if note:
            line.note = note
        line.save()
        return line

    @staticmethod
    def submit(*, count: StockCount, merchant, submitted_by=None):
        if count.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant count blocked.")
        if count.status == CountStatus.CANCELLED:
            raise ValueError("Cancelled count cannot be submitted.")
        if count.status == CountStatus.APPROVED:
            return count
        if not count.lines.filter(physical_quantity__isnull=False).exists():
            raise ValueError("No items were counted.")

        settings_obj = InventorySettings.for_merchant(merchant)
        count.status = CountStatus.SUBMITTED
        count.submitted_at = timezone.now()
        count.submitted_by = submitted_by
        count.save(update_fields=["status", "submitted_at", "submitted_by", "updated_at"])

        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=submitted_by,
            action=InventoryAuditLog.ACTION_COUNT_SUBMITTED,
            entity_type="stock_count",
            entity_id=str(count.id),
            metadata={"require_approval": settings_obj.require_count_approval},
        )

        if not settings_obj.require_count_approval:
            return StockCountService.approve(
                count=count, merchant=merchant, approved_by=submitted_by
            )
        return count

    @staticmethod
    def approve(*, count: StockCount, merchant, approved_by=None) -> StockCount:
        if count.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant count blocked.")
        if count.status == CountStatus.CANCELLED:
            raise ValueError("Cancelled count cannot be approved.")
        # Idempotent approval — never reconcile twice.
        if count.status == CountStatus.APPROVED:
            return count
        if count.status != CountStatus.SUBMITTED:
            raise ValueError("Only a submitted count can be approved.")

        with transaction.atomic():
            unlocked = StockCount.objects.select_for_update().get(pk=count.pk)
            if unlocked.status == CountStatus.APPROVED:
                return unlocked

            counted = list(
                unlocked.lines.filter(physical_quantity__isnull=False).select_related(
                    "inventory_item", "location"
                )
            )
            for line in counted:
                validate_merchant(line.inventory_item, merchant, "count line item")
                validate_merchant(line.location, merchant, "count line location")
                diff = line.difference
                if diff is None:
                    continue
                if diff != 0:
                    InventoryMovementService.apply_change(
                        merchant=merchant,
                        location=line.location,
                        inventory_item=line.inventory_item,
                        quantity_change=diff,
                        movement_type=MovementType.COUNT_RECONCILIATION,
                        source_type=MovementSource.STOCK_COUNT,
                        source_id=unlocked.id,
                        reason="Stock count reconciliation",
                        note=f"Book {line.book_quantity} → physical {line.physical_quantity}",
                        performed_by=approved_by,
                        approved_by=approved_by,
                        idempotency_key=f"count-{unlocked.id}-line-{line.id}",
                    )
                # Update item count tracking (reminders only).
                item = line.inventory_item
                item.last_count_at = timezone.now().date()
                if item.count_schedule and item.count_schedule.frequency_days:
                    item.next_count_due = item.last_count_at + timezone.timedelta(
                        days=item.count_schedule.frequency_days
                    )
                item.save(update_fields=["last_count_at", "next_count_due", "updated_at"])

            unlocked.status = CountStatus.APPROVED
            unlocked.approved_at = timezone.now()
            unlocked.approved_by = approved_by
            unlocked.save(update_fields=["status", "approved_at", "approved_by", "updated_at"])

        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=approved_by,
            action=InventoryAuditLog.ACTION_COUNT_APPROVED,
            entity_type="stock_count",
            entity_id=str(unlocked.id),
            metadata={"lines_reconciled": len(counted)},
        )
        return unlocked

    @staticmethod
    def cancel(*, count: StockCount, merchant, cancelled_by=None) -> StockCount:
        if count.merchant_id != merchant.id:
            raise PermissionError("Cross-merchant count blocked.")
        if count.status in (CountStatus.APPROVED, CountStatus.CANCELLED):
            raise ValueError("Count cannot be cancelled.")
        count.status = CountStatus.CANCELLED
        count.save(update_fields=["status", "updated_at"])
        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=cancelled_by,
            action=InventoryAuditLog.ACTION_COUNT_CANCELLED,
            entity_type="stock_count",
            entity_id=str(count.id),
        )
        return count


# ─────────────────────────────────────────────────────────────────────────────
# Purchasing
# ─────────────────────────────────────────────────────────────────────────────


def next_po_number(merchant) -> str:
    last = (
        PurchaseOrder.objects.filter(merchant=merchant)
        .order_by("-id")
        .values_list("po_number", flat=True)
        .first()
    )
    if last and last.startswith("PO-"):
        try:
            return f"PO-{int(last.split('-')[1]) + 1:04d}"
        except (ValueError, IndexError):
            pass
    return "PO-0001"


class PurchaseOrderService:
    @staticmethod
    @transaction.atomic
    def create(*, merchant, supplier, delivery_location, lines, expected_date=None,
               notes="", created_by=None) -> PurchaseOrder:
        validate_merchant(supplier, merchant, "supplier")
        validate_merchant(delivery_location, merchant, "delivery location")
        po = PurchaseOrder.objects.create(
            merchant=merchant,
            po_number=next_po_number(merchant),
            supplier=supplier,
            status=OrderStatus.SENT,
            delivery_location=delivery_location,
            expected_date=expected_date,
            notes=notes,
            created_by=created_by,
        )
        total = ZERO
        for line in lines:
            item_id = line.get("item_id")
            item = InventoryItem.objects.filter(merchant=merchant, id=item_id).first()
            if not item:
                raise ValueError(f"Unknown item {item_id}.")
            qty = to_decimal(line.get("quantity"))
            unit_cost = to_decimal(line.get("unit_cost"), 4) or ZERO
            if qty <= 0:
                raise ValueError("PO line quantity must be positive.")
            label = line.get("purchase_unit_label") or item.purchase_unit_label or ""
            conversion = line.get("purchase_unit_conversion")
            if conversion is None:
                conversion = item.purchase_unit_conversion
            if conversion is not None:
                conversion = to_decimal(conversion)
            line_total = (qty * unit_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            total += line_total
            PurchaseOrderLine.objects.create(
                purchase_order=po,
                inventory_item=item,
                purchase_unit_label=label,
                purchase_unit_conversion=conversion,
                quantity=qty,
                unit_cost=unit_cost,
                line_total=line_total,
            )
        po.total_amount = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        po.save(update_fields=["total_amount"])
        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=created_by,
            action=InventoryAuditLog.ACTION_PO_CREATED,
            entity_type="purchase_order",
            entity_id=str(po.id),
            metadata={"supplier": supplier.id, "total": str(po.total_amount)},
        )
        return po

    @staticmethod
    def receive_lines(*, merchant, po: PurchaseOrder, received_map, location=None,
                      performed_by=None, idempotency_key=None) -> PurchaseOrder:
        """Partial receiving: stock increases by ACTUAL quantities, never ordered.

        received_map: {po_line_id: {"quantity": Decimal, "unit_cost": Decimal|None}}
        idempotency_key: client-generated per receive batch. Retrying the same
        key is a no-op; a new key starts a new (partial) batch, so repeated
        deliveries against one line work while double-clicks do not.
        """
        validate_merchant(po, merchant, "purchase order")
        if po.status == OrderStatus.CANCELLED:
            raise ValueError("PO is cancelled.")
        if location is None:
            location = po.delivery_location
        validate_merchant(location, merchant, "location")

        batch_key = idempotency_key or f"rcv-{uuid.uuid4()}"

        with transaction.atomic():
            po_locked = PurchaseOrder.objects.select_for_update().get(pk=po.pk)
            receiving = None
            total_value = ZERO
            for line_id, payload in received_map.items():
                try:
                    po_line = PurchaseOrderLine.objects.get(pk=line_id, purchase_order=po_locked)
                except PurchaseOrderLine.DoesNotExist:
                    raise ValueError(f"Line {line_id} does not belong to this purchase order.")
                per_line_key = f"{batch_key}-line-{line_id}"
                if InventoryMovement.objects.filter(
                    merchant=merchant, idempotency_key=per_line_key
                ).exists():
                    continue

                qty = to_decimal(payload.get("quantity"))
                if qty <= 0:
                    raise ValueError("Received quantity must be positive.")
                remaining = po_line.quantity - po_line.received_quantity
                if qty > remaining:
                    qty = remaining
                if qty <= 0:
                    continue

                unit_cost = to_decimal(payload.get("unit_cost"), 4)
                if unit_cost is None:
                    unit_cost = po_line.unit_cost
                line_total = (qty * unit_cost).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                total_value += line_total

                base_qty = base_quantity_for_purchase(
                    po_line.inventory_item, qty, po_line.purchase_unit_conversion
                )
                if receiving is None:
                    receiving = InventoryReceiving.objects.create(
                        merchant=merchant,
                        receipt_number=f"RCV-{next_receipt_seq(merchant)}",
                        supplier=po_locked.supplier,
                        purchase_order=po_locked,
                        location=location,
                        note=f"Receiving for {po_locked.po_number}",
                        received_by=performed_by,
                    )
                InventoryReceivingLine.objects.create(
                    receiving=receiving,
                    inventory_item=po_line.inventory_item,
                    purchase_unit_label=po_line.purchase_unit_label,
                    quantity_purchased=qty,
                    base_quantity=base_qty,
                    unit_cost=unit_cost,
                    line_total=line_total,
                )
                InventoryMovementService.apply_change(
                    merchant=merchant,
                    location=location,
                    inventory_item=po_line.inventory_item,
                    quantity_change=base_qty,
                    movement_type=MovementType.RECEIVE,
                    source_type=MovementSource.PO_RECEIVE,
                    source_id=receiving.id,
                    reason=f"{po_locked.po_number} receiving",
                    note=po_locked.supplier.name if po_locked.supplier else "",
                    performed_by=performed_by,
                    unit_cost=unit_cost / po_line.purchase_unit_conversion
                    if po_line.purchase_unit_conversion else unit_cost,
                    idempotency_key=per_line_key,
                )
                po_line.received_quantity += qty
                po_line.save(update_fields=["received_quantity"])

                item = po_line.inventory_item
                item.last_received_at = timezone.now().date()
                item.save(update_fields=["last_received_at", "updated_at"])

            if receiving is None:
                return po_locked

            receiving.total_value = total_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            receiving.save(update_fields=["total_value"])

            all_fulfilled = po_locked.lines.filter(
                received_quantity__lt=F("quantity")
            ).count() == 0
            if all_fulfilled:
                po_locked.status = OrderStatus.RECEIVED
            elif po_locked.lines.filter(received_quantity__gt=0).exists():
                po_locked.status = OrderStatus.PARTIALLY_RECEIVED
            else:
                po_locked.status = OrderStatus.SENT
            po_locked.save(update_fields=["status", "updated_at"])

        InventoryAuditLog.objects.create(
            merchant=merchant,
            user=performed_by,
            action=InventoryAuditLog.ACTION_PO_RECEIVED,
            entity_type="purchase_order",
            entity_id=str(po.pk),
            metadata={"receiving": receiving.id, "value": str(receiving.total_value)},
        )
        return po_locked


def next_receipt_seq(merchant) -> int:
    return InventoryReceiving.objects.filter(merchant=merchant).count() + 1


# ─────────────────────────────────────────────────────────────────────────────
# Overview / aggregates
# ─────────────────────────────────────────────────────────────────────────────


def merchant_overview(merchant):
    balances = list(
        InventoryBalance.objects.filter(merchant=merchant).select_related(
            "inventory_item", "location"
        )
    )
    by_item: dict[int, Decimal] = {}
    for b in balances:
        by_item[b.inventory_item_id] = by_item.get(b.inventory_item_id, ZERO) + b.on_hand

    items = list(
        InventoryItem.objects.filter(merchant=merchant, active=True, archived=False)
        .select_related("category", "default_location", "primary_supplier", "count_schedule")
        .prefetch_related("balances")
    )

    inventory_value = ZERO
    item_rows = []
    for item in items:
        on_hand = by_item.get(item.id, ZERO)
        # Weighted-average valuation: value = Σ(on_hand × avg_cost) per location.
        value = ZERO
        for b in balances:
            if b.inventory_item_id == item.id:
                value += b.on_hand * b.avg_cost
                value = value.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        inventory_value += value
        status = stock_status(item, on_hand)
        item_rows.append({
            "item": item,
            "on_hand": on_hand,
            "value": value,
            "status": status,
        })

    low = [r for r in item_rows if r["status"] in ("LOW", "CRITICAL")]
    out = [r for r in item_rows if r["status"] == "OUT"]
    overstock = [r for r in item_rows if r["status"] == "OVERSTOCK"]

    today = timezone.now().date()
    counts_due = items_due_for_count(merchant, ref_date=today)

    open_po = (
        PurchaseOrder.objects.filter(
            merchant=merchant,
            status__in=[OrderStatus.DRAFT, OrderStatus.SENT, OrderStatus.PARTIALLY_RECEIVED],
        ).count()
    )

    needs_attention = [
        {
            "id": r["item"].id,
            "name": r["item"].name,
            "category": r["item"].category.name if r["item"].category else "",
            "location": r["item"].default_location.name if r["item"].default_location else "",
            "available": r["on_hand"],
            "unit": r["item"].base_unit.code,
            "status": r["status"],
            "par": r["item"].par_level,
            "reorder_point": r["item"].reorder_point,
            "next_count_due": r["item"].next_count_due,
            "suggested_order": suggested_order_qty(r["item"], r["on_hand"]),
        }
        for r in item_rows
        if r["status"] in ("LOW", "CRITICAL", "OUT")
    ]
    needs_attention.sort(
        key=lambda x: (x["status"] != "CRITICAL", x["status"] != "OUT", str(x["suggested_order"]))
    )

    recent = list(
        InventoryMovement.objects.filter(merchant=merchant)
        .select_related("inventory_item", "location", "performed_by")
        .order_by("-created_at")[:12]
    )

    return {
        "inventory_value": inventory_value,
        "low_stock_count": len(low),
        "out_of_stock_count": len(out),
        "overstock_count": len(overstock),
        "counts_due": counts_due,
        "open_purchase_orders": open_po,
        "needs_attention": needs_attention,
        "recent_movements": [
            {
                "id": m.id,
                "movement_type": m.movement_type,
                "quantity_change": m.quantity_change,
                "item": m.inventory_item.name,
                "location": m.location.name,
                "reason": m.reason,
                "performed_by": m.performed_by.get_full_name() or m.performed_by.email
                if m.performed_by else "",
                "created_at": m.created_at,
            }
            for m in recent
        ],
    }


def items_due_for_count(merchant, ref_date=None):
    """Number of active items whose next_count_due is due/overdue (reminder only)."""
    ref_date = ref_date or timezone.now().date()
    return (
        InventoryItem.objects.filter(
            merchant=merchant,
            active=True,
            archived=False,
            next_count_due__isnull=False,
            next_count_due__lte=ref_date,
        ).count()
    )


def next_count_overview(merchant):
    """Reminder list for the overview 'Counts Due' section."""
    ref_date = timezone.now().date()
    items = InventoryItem.objects.filter(
        merchant=merchant,
        active=True,
        archived=False,
        next_count_due__isnull=False,
    ).select_related("count_schedule")
    rows = []
    for item in items:
        due = item.next_count_due
        if due <= ref_date:
            delta = (ref_date - due).days
            label = "Today" if delta == 0 else f"Overdue by {delta}d"
        else:
            label = f"Due in {(due - ref_date).days}d"
        rows.append({
            "item": item.name,
            "category": item.category.name if item.category else "",
            "due": due,
            "label": label,
        })
    rows.sort(key=lambda r: r["due"])
    return rows