"""
inventory/tests.py

Service + API tests for the Zentro Inventory & Stock Management System.

Run with:  python manage.py test inventory

Core invariants verified here:
  1. Orders never touch inventory — stock changes only via the service.
  2. Count reconciliation sets the balance to the PHYSICAL quantity.
     (The classic regression: book 70kg → count 43kg → final 43kg,
      WHENEVER the waste 27kg was recorded separately. Never 16kg.)
  3. Stock variance is COUNT_RECONCILIATION, never auto-labelled waste/usage.
  4. Idempotency: repeated receiving / count approval / transfer refunds.
  5. Weighted-average costing and purchase-unit conversion.
  6. Tenant isolation: no merchant can touch another merchant's objects.
  7. Failure atomicity: a rejected movement leaves no orphan documents.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from merchants.models import MerchantProfile

from .models import (
    CountStatus,
    InventoryBalance,
    InventoryItem,
    InventoryMovement,
    InventoryReceiving,
    InventoryTransfer,
    InventoryTransferLine,
    InventoryWasteRecord,
    MovementType,
    OrderStatus,
    PurchaseOrder,
    StockCount,
    Supplier,
    TransferStatus,
    UnitOfMeasure,
    InventoryAdjustment,
)
from .services import (
    InventoryMovementService,
    PurchaseOrderService,
    StockCountService,
    base_quantity_for_purchase,
    next_po_number,
    seed_default_units,
    seed_merchant_reference_data,
    stock_status,
    suggested_order_qty,
)


class InventoryTestBase(TestCase):
    """Create two isolated merchants + items in g / kg for conversion tests."""

    @classmethod
    def setUpTestData(cls):
        seed_default_units()
        cls.g = UnitOfMeasure.objects.get(merchant__isnull=True, code="g")
        cls.kg = UnitOfMeasure.objects.get(merchant__isnull=True, code="kg")
        cls.piece = UnitOfMeasure.objects.get(merchant__isnull=True, code="piece")

        cls.merchant_user = get_user_model().objects.create_user(
            username="inv-owner", email="owner@inv.test", password="Pass123!", role="merchant"
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.merchant_user, business_name="Inv Cafe", slug="inv-cafe"
        )
        seed_merchant_reference_data(cls.merchant)
        cls.m2_user = get_user_model().objects.create_user(
            username="inv-other", email="other@inv.test", password="Pass123!", role="merchant"
        )
        cls.merchant2 = MerchantProfile.objects.create(
            user=cls.m2_user, business_name="Other Cafe", slug="other-cafe"
        )
        seed_merchant_reference_data(cls.merchant2)

        cls.kitchen = cls.merchant.inventory_locations.get(name="Main Kitchen")
        cls.bar = cls.merchant.inventory_locations.get(name="Bar")
        cls.category = cls.merchant.inventory_categories.get(name="Dry Goods")
        cls.category2 = cls.merchant2.inventory_categories.get(name="Dry Goods")
        cls.kitchen2 = cls.merchant2.inventory_locations.get(name="Main Kitchen")

        cls.flour = InventoryItem.objects.create(
            merchant=cls.merchant,
            name="Flour",
            item_type="INGREDIENT",
            category=cls.category,
            base_unit=cls.g,
            default_location=cls.kitchen,
            purchase_unit_label="25kg sack",
            purchase_unit_conversion=Decimal("25000"),
            par_level=Decimal("50000"),
            reorder_point=Decimal("10000"),
            critical_level=Decimal("5000"),
        )
        cls.milk = InventoryItem.objects.create(
            merchant=cls.merchant,
            name="Milk",
            item_type="INGREDIENT",
            category=cls.category,
            base_unit=cls.g,
            default_location=cls.kitchen,
            par_level=Decimal("20000"),
            reorder_point=Decimal("5000"),
        )
        cls.other_flour = InventoryItem.objects.create(
            merchant=cls.merchant2,
            name="Other Flour",
            item_type="INGREDIENT",
            category=cls.category2,
            base_unit=cls.g,
            default_location=cls.kitchen2,
        )

    def _balance(self, item, location=None):
        qs = InventoryBalance.objects.filter(inventory_item=item)
        if location:
            qs = qs.filter(location=location)
        return list(qs)


class MovementServiceTests(InventoryTestBase):
    def test_opening_balance_creates_ledger_and_balance(self):
        movement = InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("70000"), unit_cost=Decimal("0.05"),
        )
        self.assertIsNotNone(movement)
        self.assertEqual(movement.movement_type, MovementType.OPENING_BALANCE)
        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("70000"))
        self.assertEqual(balance.avg_cost, Decimal("0.05"))
        self.assertEqual(InventoryMovement.objects.count(), 1)

    def test_receive_with_purchase_unit_conversion(self):
        # 3 × 25kg sack = 75000 g
        movement = InventoryMovementService.receive(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            quantity=Decimal("3"), purchase_unit_label="25kg sack",
            purchase_unit_conversion=Decimal("25000"),
            unit_cost=Decimal("1500"),  # per sack → 1500/25000 = 0.06 per g
        )
        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("75000"))
        self.assertEqual(movement.quantity_change, Decimal("75000"))
        self.assertEqual(movement.unit_cost, Decimal("0.06"))

    def test_receive_without_conversion_uses_plain_quantity(self):
        self.flour.purchase_unit_conversion = None
        self.flour.save()
        InventoryMovementService.receive(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            quantity=Decimal("42"), unit_cost=Decimal("1"),
        )
        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("42"))

    def test_base_quantity_for_purchase_helpers(self):
        self.assertEqual(
            base_quantity_for_purchase(self.flour, Decimal("2"), Decimal("25000")),
            Decimal("50000"),
        )
        self.assertEqual(
            base_quantity_for_purchase(self.flour, Decimal("2")),
            Decimal("50000"),  # falls back to item.purchase_unit_conversion
        )

    def test_weighted_average_cost(self):
        InventoryMovementService.receive(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            quantity=Decimal("1000"), unit_cost=Decimal("0.10"),  # 10 per g
        )
        InventoryMovementService.receive(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            quantity=Decimal("1000"), unit_cost=Decimal("0.20"),  # 20 per g
        )
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        # avg = (1000*0.10 + 1000*0.20) / 2000 = 0.15
        self.assertEqual(balance.avg_cost, Decimal("0.15"))

    def test_waste_against_no_stock_is_rejected_and_records_rollback(self):
        with self.assertRaises(ValueError):
            InventoryMovementService.record_waste(
                merchant=self.merchant, item=self.milk, location=self.kitchen,
                quantity=Decimal("5"), reason="SPOILED",
            )
        self.assertEqual(InventoryWasteRecord.objects.count(), 0)
        self.assertEqual(InventoryMovement.objects.count(), 0)
        self.assertEqual(
            InventoryBalance.objects.filter(inventory_item=self.milk).count(), 0
        )

    def test_waste_reduces_stock_and_caps_at_balance(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("1000"), unit_cost=Decimal("0.5"),
        )
        InventoryMovementService.record_waste(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            quantity=Decimal("10"), reason="SPOILED",
        )
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("990"))
        self.assertEqual(InventoryWasteRecord.objects.get().per_unit_cost, Decimal("0.5"))

    def test_manual_adjustment_plus_and_minus(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("500"),
        )
        InventoryMovementService.manual_adjustment(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            quantity_delta=Decimal("25"), reason="found stock",
        )
        InventoryMovementService.manual_adjustment(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            quantity_delta=Decimal("-10"), reason="spill",
        )
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("515"))
        self.assertEqual(InventoryAdjustment.objects.count(), 2)

    def test_manual_adjustment_rejected_when_insufficient(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("10"),
        )
        with self.assertRaises(ValueError):
            InventoryMovementService.manual_adjustment(
                merchant=self.merchant, item=self.milk, location=self.kitchen,
                quantity_delta=Decimal("-50"), reason="nope",
            )
        self.assertEqual(InventoryAdjustment.objects.count(), 0)
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("10"))

    def test_transfer_moves_stock_total_unchanged(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("300"),
        )
        transfer = InventoryTransfer.objects.create(
            merchant=self.merchant, from_location=self.kitchen, to_location=self.bar,
            status=TransferStatus.DRAFT, created_by=self.merchant_user,
        )
        InventoryTransferLine.objects.create(
            transfer=transfer, inventory_item=self.milk, quantity=Decimal("100")
        )
        InventoryMovementService.transfer(
            merchant=self.merchant, transfer=transfer, performed_by=self.merchant_user
        )
        kitchen_bal = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        bar_bal = InventoryBalance.objects.get(inventory_item=self.milk, location=self.bar)
        self.assertEqual(kitchen_bal.on_hand, Decimal("200"))
        self.assertEqual(bar_bal.on_hand, Decimal("100"))
        self.assertEqual(kitchen_bal.on_hand + bar_bal.on_hand, Decimal("300"))
        transfer.refresh_from_db()
        self.assertEqual(transfer.status, TransferStatus.RECEIVED)

    def test_transfer_is_idempotent(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("300"),
        )
        transfer = InventoryTransfer.objects.create(
            merchant=self.merchant, from_location=self.kitchen, to_location=self.bar,
            status=TransferStatus.DRAFT, created_by=self.merchant_user,
        )
        InventoryTransferLine.objects.create(
            transfer=transfer, inventory_item=self.milk, quantity=Decimal("100")
        )
        InventoryMovementService.transfer(merchant=self.merchant, transfer=transfer)
        inventory_movements = InventoryMovement.objects.count()
        transfer.refresh_from_db()
        # Re-running is a no-op, not a second deduction.
        InventoryMovementService.transfer(merchant=self.merchant, transfer=transfer)
        self.assertEqual(InventoryMovement.objects.count(), inventory_movements)
        bar_bal = InventoryBalance.objects.get(inventory_item=self.milk, location=self.bar)
        self.assertEqual(bar_bal.on_hand, Decimal("100"))

    def test_reverse_restores_balance_and_preserves_history(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.milk, location=self.kitchen,
            opening_qty=Decimal("500"),
        )
        original = InventoryMovement.objects.get(movement_type=MovementType.OPENING_BALANCE)
        mutated = InventoryMovementService.reverse(
            merchant=self.merchant, movement=original, performed_by=self.merchant_user
        )
        self.assertEqual(mutated.movement_type, MovementType.REVERSAL)
        self.assertEqual(mutated.reversal_of_id, original.id)
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("0"))
        # Historical movements intact.
        self.assertEqual(InventoryMovement.objects.count(), 2)


class CountReconciliationTests(InventoryTestBase):
    def test_count_snapshots_book_and_reconciles_to_physical(self):
        """The core rule: final stock == physical count, exactly."""
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("70000"),  # 70 kg
        )
        count = StockCountService.create_count(
            merchant=self.merchant, name="End of week", location=self.kitchen,
            started_by=self.merchant_user,
        )
        line = count.lines.get(inventory_item=self.flour)
        self.assertEqual(line.book_quantity, Decimal("70000"))

        # Count 43 kg
        result = StockCountService.upsert_line(
            count=count, merchant=self.merchant, line_id=line.id,
            physical_quantity=Decimal("43000"),
        )
        self.assertEqual(result.difference, Decimal("43000") - Decimal("70000"))

        StockCountService.submit(count=count, merchant=self.merchant, submitted_by=self.merchant_user)
        StockCountService.approve(count=count, merchant=self.merchant, approved_by=self.merchant_user)

        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("43000"), "Final stock MUST equal physical count.")

        movements = InventoryMovement.objects.filter(
            inventory_item=self.flour, movement_type=MovementType.COUNT_RECONCILIATION
        )
        self.assertEqual(movements.count(), 1)
        self.assertEqual(movements.first().quantity_change, Decimal("43000") - Decimal("70000"))
        # Variance is reconciliation, not waste/usage.
        self.assertFalse(
            InventoryMovement.objects.filter(
                inventory_item=self.flour, movement_type__in=[
                    MovementType.EXPLICIT_WASTE, MovementType.RETURN_TO_SUPPLIER,
                ]
            ).exists()
        )

    def test_waste_then_count_regression(self):
        """The exact regression from the spec:
        open 70kg, waste 27kg, count 43kg → final MUST be 43kg, never 16kg.
        """
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("70000"),
        )
        InventoryMovementService.record_waste(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            quantity=Decimal("27000"), reason="SPOILED",
        )
        # Book is now 43kg. A physical count of 43kg → zero reconciliation.
        count = StockCountService.create_count(
            merchant=self.merchant, name="After waste", location=self.kitchen,
            started_by=self.merchant_user,
        )
        line = count.lines.get(inventory_item=self.flour)
        self.assertEqual(line.book_quantity, Decimal("43000"))
        StockCountService.upsert_line(
            count=count, merchant=self.merchant, line_id=line.id,
            physical_quantity=Decimal("43000"),
        )
        StockCountService.submit(count=count, merchant=self.merchant, submitted_by=self.merchant_user)
        StockCountService.approve(count=count, merchant=self.merchant, approved_by=self.merchant_user)

        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(
            balance.on_hand, Decimal("43000"),
            "Final stock must be 43kg; double-deduction to 16kg is FORBIDDEN.",
        )
        self.assertEqual(InventoryMovement.objects.filter(
            movement_type=MovementType.COUNT_RECONCILIATION
        ).count(), 0)

    def test_approval_is_idempotent(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("1000"),
        )
        count = StockCountService.create_count(
            merchant=self.merchant, name="Two approvals", location=self.kitchen,
        )
        line = count.lines.get(inventory_item=self.flour)
        StockCountService.upsert_line(
            count=count, merchant=self.merchant, line_id=line.id,
            physical_quantity=Decimal("900"),
        )
        StockCountService.submit(count=count, merchant=self.merchant, submitted_by=self.merchant_user)
        StockCountService.approve(count=count, merchant=self.merchant, approved_by=self.merchant_user)
        movements_after_first = InventoryMovement.objects.count()
        StockCountService.approve(count=count, merchant=self.merchant, approved_by=self.merchant_user)
        self.assertEqual(InventoryMovement.objects.count(), movements_after_first)
        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("900"))

    def test_submit_without_counts_rejected(self):
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("1000"),
        )
        count = StockCountService.create_count(
            merchant=self.merchant, name="Empty", location=self.kitchen,
        )
        with self.assertRaises(ValueError):
            StockCountService.submit(count=count, merchant=self.merchant)

    def test_auto_approve_when_required_flag_off(self):
        settings_obj = self.merchant.inventory_settings
        settings_obj.require_count_approval = False
        settings_obj.save()
        InventoryMovementService.opening_balance(
            merchant=self.merchant, item=self.flour, location=self.kitchen,
            opening_qty=Decimal("1000"),
        )
        count = StockCountService.create_count(
            merchant=self.merchant, name="Auto", location=self.kitchen,
        )
        line = count.lines.get(inventory_item=self.flour)
        StockCountService.upsert_line(
            count=count, merchant=self.merchant, line_id=line.id,
            physical_quantity=Decimal("750"),
        )
        result = StockCountService.submit(count=count, merchant=self.merchant, submitted_by=self.merchant_user)
        result.refresh_from_db()
        self.assertEqual(result.status, CountStatus.APPROVED)
        balance = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("750"))


class PurchaseOrderTests(InventoryTestBase):
    def setUp(self):
        self.supplier = Supplier.objects.create(
            merchant=self.merchant, name="Flour Co", phone="123"
        )

    def test_create_po_does_not_change_stock(self):
        po = PurchaseOrderService.create(
            merchant=self.merchant,
            supplier=self.supplier,
            delivery_location=self.kitchen,
            lines=[{
                "item_id": self.flour.id,
                "quantity": 2,
                "unit_cost": 1500,
                "purchase_unit_label": "25kg sack",
                "purchase_unit_conversion": 25000,
            }],
            created_by=self.merchant_user,
        )
        self.assertEqual(po.status, OrderStatus.SENT)
        self.assertEqual(next_po_number(self.merchant), "PO-0002")
        self.assertEqual(InventoryMovement.objects.count(), 0)
        self.assertEqual(
            InventoryBalance.objects.filter(inventory_item=self.flour).count(), 0
        )

    def test_receive_lines_partial_then_complete(self):
        po = PurchaseOrderService.create(
            merchant=self.merchant,
            supplier=self.supplier,
            delivery_location=self.kitchen,
            lines=[
                {"item_id": self.flour.id, "quantity": 2, "unit_cost": 1500,
                 "purchase_unit_label": "25kg sack", "purchase_unit_conversion": 25000},
                {"item_id": self.milk.id, "quantity": 10, "unit_cost": 50},
            ],
            created_by=self.merchant_user,
        )
        line_flour = po.lines.get(inventory_item=self.flour)
        line_milk = po.lines.get(inventory_item=self.milk)

        # Partial: receive 1 sack of flour (25kg).
        po.refresh_from_db()
        updated = PurchaseOrderService.receive_lines(
            merchant=self.merchant, po=po,
            received_map={str(line_flour.id): {"quantity": 1}},
            performed_by=self.merchant_user,
        )
        updated.refresh_from_db()
        self.assertEqual(updated.status, OrderStatus.PARTIALLY_RECEIVED)
        flour_bal = InventoryBalance.objects.get(inventory_item=self.flour, location=self.kitchen)
        self.assertEqual(flour_bal.on_hand, Decimal("25000"))
        # Po line conversion 25000 → per base unit 1500/25000 = 0.06
        self.assertEqual(flour_bal.avg_cost, Decimal("0.06"))

        # Complete everything.
        updated = PurchaseOrderService.receive_lines(
            merchant=self.merchant, po=updated,
            received_map={
                str(line_flour.id): {"quantity": 1},
                str(line_milk.id): {"quantity": 10},
            },
            performed_by=self.merchant_user,
        )
        updated.refresh_from_db()
        self.assertEqual(updated.status, OrderStatus.RECEIVED)
        milk_bal = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(milk_bal.on_hand, Decimal("10"))

    def test_receive_lines_idempotent_no_double_stock(self):
        po = PurchaseOrderService.create(
            merchant=self.merchant,
            supplier=self.supplier,
            delivery_location=self.kitchen,
            lines=[{"item_id": self.milk.id, "quantity": 10, "unit_cost": 50}],
            created_by=self.merchant_user,
        )
        line = po.lines.get(inventory_item=self.milk)
        PurchaseOrderService.receive_lines(
            merchant=self.merchant, po=po,
            received_map={str(line.id): {"quantity": 5}},
            performed_by=self.merchant_user,
            idempotency_key="batch-recv-1",
        )
        # Retrying the exact same batch is a no-op — no double stock.
        PurchaseOrderService.receive_lines(
            merchant=self.merchant, po=po,
            received_map={str(line.id): {"quantity": 5}},
            performed_by=self.merchant_user,
            idempotency_key="batch-recv-1",
        )
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("5"))
        self.assertEqual(InventoryReceiving.objects.count(), 1)
        self.assertEqual(InventoryMovement.objects.filter(movement_type=MovementType.RECEIVE).count(), 1)
        po.refresh_from_db()
        self.assertEqual(po.status, OrderStatus.PARTIALLY_RECEIVED)

    def test_receive_lines_multiple_batches_for_same_line(self):
        po = PurchaseOrderService.create(
            merchant=self.merchant,
            supplier=self.supplier,
            delivery_location=self.kitchen,
            lines=[{"item_id": self.milk.id, "quantity": 10, "unit_cost": 50}],
            created_by=self.merchant_user,
        )
        line = po.lines.get(inventory_item=self.milk)
        for n, key in ((5, "batch-a"), (3, "batch-b")):
            PurchaseOrderService.receive_lines(
                merchant=self.merchant, po=po,
                received_map={str(line.id): {"quantity": n}},
                performed_by=self.merchant_user,
                idempotency_key=key,
            )
        balance = InventoryBalance.objects.get(inventory_item=self.milk, location=self.kitchen)
        self.assertEqual(balance.on_hand, Decimal("8"))
        line.refresh_from_db()
        self.assertEqual(line.received_quantity, Decimal("8"))
        self.assertEqual(InventoryMovement.objects.filter(movement_type=MovementType.RECEIVE).count(), 2)
        po.refresh_from_db()
        self.assertEqual(po.status, OrderStatus.PARTIALLY_RECEIVED)

    def test_receiving_sets_last_received_at(self):
        po = PurchaseOrderService.create(
            merchant=self.merchant,
            supplier=self.supplier,
            delivery_location=self.kitchen,
            lines=[{"item_id": self.milk.id, "quantity": 5, "unit_cost": 50}],
        )
        line = po.lines.get(inventory_item=self.milk)
        PurchaseOrderService.receive_lines(
            merchant=self.merchant, po=po,
            received_map={str(line.id): {"quantity": 5}},
        )
        self.milk.refresh_from_db()
        self.assertIsNotNone(self.milk.last_received_at)


class TenantIsolationTests(InventoryTestBase):
    def test_cross_merchant_balance_move_rejected(self):
        with self.assertRaises(PermissionError):
            InventoryMovementService.receive(
                merchant=self.merchant, item=self.other_flour, location=self.kitchen,
                quantity=Decimal("10"),
            )
        with self.assertRaises(PermissionError):
            InventoryMovementService.opening_balance(
                merchant=self.merchant, item=self.other_flour, location=self.kitchen,
                opening_qty=Decimal("10"),
            )

    def test_cross_merchant_count_rejected(self):
        with self.assertRaises(PermissionError):
            StockCountService.create_count(
                merchant=self.merchant, name="Nope", location=self.kitchen2,
            )

    def test_cross_merchant_transfer_rejected(self):
        transfer = InventoryTransfer.objects.create(
            merchant=self.merchant2, from_location=self.kitchen2,
            to_location=self.merchant2.inventory_locations.get(name="Bar"),
            status=TransferStatus.DRAFT,
        )
        with self.assertRaises(PermissionError):
            InventoryMovementService.transfer(merchant=self.merchant, transfer=transfer)

    def test_po_supplier_scoped(self):
        other_supplier = Supplier.objects.create(
            merchant=self.merchant2, name="Other Supplier"
        )
        with self.assertRaises(PermissionError):
            PurchaseOrderService.create(
                merchant=self.merchant, supplier=other_supplier,
                delivery_location=self.kitchen, lines=[],
            )


class StockStatusTests(InventoryTestBase):
    def test_statuses(self):
        self.assertEqual(stock_status(self.flour, Decimal("0")), "OUT")
        self.assertEqual(stock_status(self.flour, Decimal("4999")), "CRITICAL")
        self.assertEqual(stock_status(self.flour, Decimal("5000")), "CRITICAL")
        self.assertEqual(stock_status(self.flour, Decimal("10000")), "LOW")
        self.assertEqual(stock_status(self.flour, Decimal("50000")), "HEALTHY")
        self.assertEqual(stock_status(self.flour, Decimal("75001")), "OVERSTOCK")

    def test_suggested_order(self):
        self.assertEqual(
            suggested_order_qty(self.flour, Decimal("20000")),
            Decimal("30000"),  # PAR 50000 - 20000
        )
        self.assertEqual(suggested_order_qty(self.flour, Decimal("60000")), Decimal("0"))