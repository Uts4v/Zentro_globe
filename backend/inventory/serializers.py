"""
inventory/serializers.py
"""

from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .models import (
    InventoryItem,
    InventoryCategory,
    InventoryLocation,
    InventoryMovement,
    InventoryWasteRecord,
    InventoryReceiving,
    InventoryReceivingLine,
    InventoryTransfer,
    InventoryTransferLine,
    InventoryAdjustment,
    InventoryAuditLog,
    InventoryCountSchedule,
    PurchaseOrder,
    PurchaseOrderLine,
    StockCount,
    StockCountLine,
    Supplier,
    SupplierItem,
    UnitOfMeasure,
)
from .services import (
    InventoryMovementService,
    InventorySettings,
    base_quantity_for_purchase,
    merchant_overview,
    next_count_overview,
    stock_status,
    suggested_order_qty,
    validate_merchant,
)


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────


class UnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = UnitOfMeasure
        fields = ["id", "code", "name", "kind", "factor_to_base", "is_base"]


class CategorySerializer(serializers.ModelSerializer):
    item_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryCategory
        fields = ["id", "name", "display_order", "is_default", "is_active", "item_count"]

    def get_item_count(self, obj):
        return obj.inventory_items.count()


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryLocation
        fields = ["id", "name", "display_order", "is_default", "is_active"]


class ScheduleSerializer(serializers.ModelSerializer):
    scope_label = serializers.SerializerMethodField()

    class Meta:
        model = InventoryCountSchedule
        fields = [
            "id", "name", "scope_type", "item", "category", "location",
            "frequency_type", "frequency_days", "next_due_at", "last_run_at",
            "enabled", "scope_label",
        ]

    def get_scope_label(self, obj):
        if obj.item:
            return obj.item.name
        if obj.category:
            return obj.category.name
        if obj.location:
            return obj.location.name
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# Items & balances
# ─────────────────────────────────────────────────────────────────────────────


class InventoryItemSerializer(serializers.ModelSerializer):
    current_stock = serializers.SerializerMethodField()
    total_stock = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    suggested_order = serializers.SerializerMethodField()
    base_unit_code = serializers.CharField(source="base_unit.code", read_only=True)
    display_unit_code = serializers.SerializerMethodField()
    category_name = serializers.CharField(source="category.name", read_only=True)
    location_name = serializers.SerializerMethodField()
    supplier_name = serializers.SerializerMethodField()
    stock_value = serializers.SerializerMethodField()
    avg_cost = serializers.SerializerMethodField()
    balance_count = serializers.SerializerMethodField()

    class Meta:
        model = InventoryItem
        fields = [
            "id", "name", "item_type", "category", "category_name",
            "default_location", "location_name", "base_unit", "base_unit_code",
            "preferred_display_unit", "display_unit_code",
            "purchase_unit_label", "purchase_unit_conversion",
            "sku", "barcode", "description",
            "active", "archived", "par_level", "reorder_point", "critical_level",
            "primary_supplier", "supplier_name", "count_schedule",
            "last_count_at", "next_count_due", "last_received_at",
            "current_stock", "total_stock", "status", "suggested_order",
            "stock_value", "avg_cost", "balance_count",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "created_at", "updated_at", "current_stock", "total_stock",
            "status", "suggested_order", "stock_value", "avg_cost",
            "balance_count", "last_count_at", "next_count_due", "last_received_at",
        ]

    def _balance(self, obj):
        return getattr(obj, "_balance_map", None) or {}

    def get_current_stock(self, obj):
        # Stock table shows the full merchant total across locations by default.
        return self.get_total_stock(obj)

    def get_total_stock(self, obj):
        balances = list(self._balance(obj).values())
        if balances:
            return str(sum(Decimal(b.on_hand) for b in balances).quantize(Decimal("0.000001")))
        return "0"

    def get_display_unit_code(self, obj):
        unit = obj.preferred_display_unit or obj.base_unit
        return unit.code

    def get_status(self, obj):
        return stock_status(obj, Decimal(self.get_total_stock(obj)))

    def get_suggested_order(self, obj):
        return str(suggested_order_qty(obj, Decimal(self.get_total_stock(obj))))

    def get_location_name(self, obj):
        return obj.default_location.name if obj.default_location else ""

    def get_supplier_name(self, obj):
        return obj.primary_supplier.name if obj.primary_supplier else ""

    def get_balance_count(self, obj):
        return len(list(self._balance(obj).values()))

    def get_stock_value(self, obj):
        total = ZERO = Decimal("0")
        for b in self._balance(obj).values():
            total += b.on_hand * b.avg_cost
        return str(total.quantize(Decimal("0.0001")))

    def get_avg_cost(self, obj):
        balances = list(self._balance(obj).values())
        if not balances:
            return None
        total_qty = sum(b.on_hand for b in balances)
        if total_qty == 0:
            return None
        total_cost = sum(b.on_hand * b.avg_cost for b in balances)
        return str((total_cost / total_qty).quantize(Decimal("0.0001")))


class InventoryItemCreateSerializer(serializers.ModelSerializer):
    """Progressive item creation: accepts nested opening balance + cost."""

    opening_quantity = serializers.DecimalField(
        max_digits=24, decimal_places=6, required=False, allow_null=True, write_only=True
    )
    opening_unit_cost = serializers.DecimalField(
        max_digits=14, decimal_places=4, required=False, allow_null=True, write_only=True
    )

    class Meta:
        model = InventoryItem
        fields = [
            "id", "name", "item_type", "category", "default_location",
            "base_unit", "preferred_display_unit",
            "purchase_unit_label", "purchase_unit_conversion",
            "sku", "barcode", "description", "active",
            "par_level", "reorder_point", "critical_level",
            "primary_supplier", "count_schedule",
            "opening_quantity", "opening_unit_cost",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        opening_qty = validated_data.pop("opening_quantity", None)
        opening_cost = validated_data.pop("opening_unit_cost", None)
        merchant = self.context["merchant"]

        item = InventoryItem.objects.create(merchant=merchant, **validated_data)

        if opening_qty and opening_qty > 0 and validated_data.get("default_location"):
            InventoryMovementService.opening_balance(
                merchant=merchant,
                item=item,
                location=validated_data["default_location"],
                opening_qty=opening_qty,
                unit_cost=opening_cost,
                performed_by=self.context.get("user"),
                idempotency_key=f"item-create-{item.id}",
            )
        return item


class MovementSerializer(serializers.ModelSerializer):
    item = serializers.CharField(source="inventory_item.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMovement
        fields = [
            "id", "movement_type", "item", "location_name", "quantity_change", "unit_code",
            "source_type", "source_id", "reason", "note",
            "balance_before", "balance_after", "unit_cost",
            "performed_by_name", "created_at",
        ]

    def get_performed_by_name(self, obj):
        if not obj.performed_by:
            return ""
        return obj.performed_by.get_full_name() or obj.performed_by.email


# ─────────────────────────────────────────────────────────────────────────────
# Waste / Adjustment / Receiving / Transfer
# ─────────────────────────────────────────────────────────────────────────────


class WasteRecordSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryWasteRecord
        fields = [
            "id", "inventory_item", "item_name", "location", "location_name",
            "quantity", "unit_code", "reason", "custom_reason", "note",
            "per_unit_cost", "performed_by_name", "created_at",
        ]
        read_only_fields = ["per_unit_cost", "created_at"]

    def get_performed_by_name(self, obj):
        if not obj.performed_by:
            return ""
        return obj.performed_by.get_full_name() or obj.performed_by.email

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        record = InventoryMovementService.record_waste(
            merchant=merchant,
            item=validated_data["inventory_item"],
            location=validated_data["location"],
            quantity=validated_data["quantity"],
            reason=validated_data.get("reason", "OTHER"),
            custom_reason=validated_data.get("custom_reason", ""),
            note=validated_data.get("note", ""),
            performed_by=user,
            idempotency_key=self.context.get("idempotency_key"),
        )
        return record


class WasteFilterSerializer(serializers.Serializer):
    from_date = serializers.DateField(required=False)
    to_date = serializers.DateField(required=False)
    item = serializers.IntegerField(required=False)
    location = serializers.IntegerField(required=False)
    reason = serializers.CharField(required=False, allow_blank=True)


class AdjustmentSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryAdjustment
        fields = [
            "id", "inventory_item", "item_name", "location", "location_name",
            "quantity_delta", "unit_code", "reason", "note",
            "approved", "approved_by", "performed_by_name", "created_at",
        ]
        read_only_fields = ["approved", "approved_by", "created_at"]

    def get_performed_by_name(self, obj):
        if not obj.performed_by:
            return ""
        return obj.performed_by.get_full_name() or obj.performed_by.email

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        adjustment = InventoryMovementService.manual_adjustment(
            merchant=merchant,
            item=validated_data["inventory_item"],
            location=validated_data["location"],
            quantity_delta=validated_data["quantity_delta"],
            reason=validated_data["reason"],
            note=validated_data.get("note", ""),
            performed_by=user,
            approved_by=user,
            idempotency_key=self.context.get("idempotency_key"),
        )
        return adjustment


class ReceivingLineSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)

    class Meta:
        model = InventoryReceivingLine
        fields = [
            "id", "inventory_item", "item_name", "purchase_unit_label",
            "quantity_purchased", "base_quantity", "unit_cost", "line_total",
        ]


class ReceivingSerializer(serializers.ModelSerializer):
    supplier_name = serializers.SerializerMethodField()
    location_name = serializers.CharField(source="location.name", read_only=True)
    received_by_name = serializers.SerializerMethodField()
    lines = ReceivingLineSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryReceiving
        fields = [
            "id", "receipt_number", "supplier", "supplier_name",
            "purchase_order", "location", "location_name", "reference", "note",
            "total_value", "received_by_name", "received_at", "created_at", "lines",
        ]

    def get_supplier_name(self, obj):
        return obj.supplier.name if obj.supplier else ""

    def get_received_by_name(self, obj):
        if not obj.received_by:
            return ""
        return obj.received_by.get_full_name() or obj.received_by.email


class ReceivingCreateSerializer(serializers.ModelSerializer):
    lines = serializers.ListField(write_only=True)

    class Meta:
        model = InventoryReceiving
        fields = [
            "id", "supplier", "purchase_order", "location", "reference", "note", "lines",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        lines_data = validated_data.pop("lines", [])
        location = validated_data["location"]
        try:
            validate_merchant(location, merchant, "location")
            supplier = validated_data.get("supplier")
            if supplier:
                validate_merchant(supplier, merchant, "supplier")
        except PermissionError as exc:
            raise serializers.ValidationError(str(exc))

        with transaction.atomic():
            receiving = InventoryReceiving.objects.create(
                merchant=merchant,
                received_by=user,
                receipt_number=f"RCV-{InventoryReceiving.objects.filter(merchant=merchant).count() + 1:04d}",
                **validated_data,
            )
            total = Decimal("0")
            for line in lines_data:
                item = InventoryItem.objects.filter(
                    merchant=merchant, id=line.get("item_id")
                ).first()
                if not item:
                    raise serializers.ValidationError(f"Unknown item {line.get('item_id')}")
                qty = Decimal(str(line.get("quantity", 0)))
                if qty <= 0:
                    raise serializers.ValidationError("Receiving quantity must be positive.")
                label = line.get("purchase_unit_label") or item.purchase_unit_label or ""
                conversion = line.get("purchase_unit_conversion")
                if conversion is None:
                    conversion = item.purchase_unit_conversion
                if conversion is not None:
                    conversion = Decimal(str(conversion))
                unit_cost_line = None
                if line.get("unit_cost") not in (None, ""):
                    unit_cost_line = Decimal(str(line["unit_cost"]))
                line_total = (qty * (unit_cost_line or 0)).quantize(Decimal("0.01"))
                total += line_total
                base_qty = base_quantity_for_purchase(item, qty, conversion)

                InventoryReceivingLine.objects.create(
                    receiving=receiving,
                    inventory_item=item,
                    purchase_unit_label=label,
                    quantity_purchased=qty,
                    base_quantity=base_qty,
                    unit_cost=unit_cost_line,
                    line_total=line_total,
                )
                InventoryMovementService.receive(
                    merchant=merchant,
                    item=item,
                    location=location,
                    quantity=qty,
                    purchase_unit_label=label,
                    purchase_unit_conversion=conversion,
                    unit_cost=unit_cost_line,
                    reason=f"Receiving RCV-{receiving.receipt_number}",
                    note=supplier.name if supplier else "",
                    source_type="RECEIVING",
                    source_id=receiving.id,
                    performed_by=user,
                    idempotency_key=None,
                )
                item.last_received_at = timezone.now().date()
                item.save(update_fields=["last_received_at", "updated_at"])
            receiving.total_value = total.quantize(Decimal("0.01"))
            receiving.save(update_fields=["total_value"])
        return receiving


class TransferLineSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)

    class Meta:
        model = InventoryTransferLine
        fields = ["id", "inventory_item", "item_name", "quantity"]


class TransferSerializer(serializers.ModelSerializer):
    from_name = serializers.CharField(source="from_location.name", read_only=True)
    to_name = serializers.CharField(source="to_location.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    lines = TransferLineSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryTransfer
        fields = [
            "id", "from_location", "from_name", "to_location", "to_name",
            "status", "note", "created_by_name", "completed_at", "created_at", "lines",
        ]

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ""
        return obj.created_by.get_full_name() or obj.created_by.email


class TransferCreateSerializer(serializers.ModelSerializer):
    lines = serializers.ListField(write_only=True)

    class Meta:
        model = InventoryTransfer
        fields = ["id", "from_location", "to_location", "note", "lines"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        lines_data = validated_data.pop("lines", [])
        if validated_data["from_location"].merchant_id != merchant.id or \
                validated_data["to_location"].merchant_id != merchant.id:
            raise serializers.ValidationError("Both locations must belong to your business.")
        if validated_data["from_location"].id == validated_data["to_location"].id:
            raise serializers.ValidationError("Source and destination locations must differ.")

        with transaction.atomic():
            transfer = InventoryTransfer.objects.create(
                merchant=merchant,
                created_by=user,
                status="DRAFT",
                **validated_data,
            )
            for line in lines_data:
                item = InventoryItem.objects.filter(merchant=merchant, id=line.get("item_id")).first()
                if not item:
                    raise serializers.ValidationError(f"Unknown item {line.get('item_id')}")
                qty = Decimal(str(line.get("quantity", 0)))
                if qty <= 0:
                    raise serializers.ValidationError("Transfer quantity must be positive.")
                InventoryTransferLine.objects.create(
                    transfer=transfer, inventory_item=item, quantity=qty
                )
        return transfer


# ─────────────────────────────────────────────────────────────────────────────
# Counts
# ─────────────────────────────────────────────────────────────────────────────


class CountLineSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)

    class Meta:
        model = StockCountLine
        fields = [
            "id", "inventory_item", "item_name", "location", "location_name",
            "book_quantity", "physical_quantity", "difference",
            "previous_count_at", "note", "unit_code",
        ]


class StockCountSerializer(serializers.ModelSerializer):
    started_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    location_name = serializers.SerializerMethodField()
    lines = CountLineSerializer(many=True, read_only=True)
    line_count = serializers.SerializerMethodField()
    counted_count = serializers.SerializerMethodField()

    class Meta:
        model = StockCount
        fields = [
            "id", "name", "count_type", "location", "location_name",
            "status", "started_at", "submitted_at", "approved_at",
            "started_by_name", "submitted_by_name", "approved_by_name",
            "note", "created_at", "lines", "line_count", "counted_count",
        ]

    def get_started_by_name(self, obj):
        return obj.started_by.get_full_name() if obj.started_by else ""

    def get_submitted_by_name(self, obj):
        return obj.submitted_by.get_full_name() if obj.submitted_by else ""

    def get_approved_by_name(self, obj):
        return obj.approved_by.get_full_name() if obj.approved_by else ""

    def get_location_name(self, obj):
        return obj.location.name if obj.location else "All locations"

    def get_line_count(self, obj):
        return obj.lines.count()

    def get_counted_count(self, obj):
        return obj.lines.filter(physical_quantity__isnull=False).count()


class CountCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    count_type = serializers.CharField(max_length=80, required=False, allow_blank=True)
    location = serializers.IntegerField(required=False, allow_null=True)
    item_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=True
    )
    note = serializers.CharField(required=False, allow_blank=True)


class CountUpsertSerializer(serializers.Serializer):
    line_id = serializers.IntegerField()
    physical_quantity = serializers.DecimalField(
        max_digits=24, decimal_places=6, required=False, allow_null=True
    )
    note = serializers.CharField(required=False, allow_blank=True)


# ─────────────────────────────────────────────────────────────────────────────
# Suppliers & Purchase orders
# ─────────────────────────────────────────────────────────────────────────────


class SupplierItemSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)

    class Meta:
        model = SupplierItem
        fields = [
            "id", "inventory_item", "item_name", "supplier_sku",
            "purchase_unit_label", "purchase_unit_conversion",
            "latest_unit_cost", "preferred", "minimum_quantity", "lead_time_days",
        ]


class SupplierSerializer(serializers.ModelSerializer):
    item_mappings = SupplierItemSerializer(many=True, read_only=True)

    class Meta:
        model = Supplier
        fields = [
            "id", "name", "contact_person", "phone", "email", "address",
            "lead_time_days", "minimum_order", "payment_terms", "notes",
            "is_active", "archived", "item_mappings", "created_at", "updated_at",
        ]
        read_only_fields = ["archived", "created_at", "updated_at"]


class POCreateSerializer(serializers.Serializer):
    supplier = serializers.IntegerField()
    delivery_location = serializers.IntegerField()
    expected_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    lines = serializers.ListField()


class POReceiveSerializer(serializers.Serializer):
    received = serializers.DictField(
        child=serializers.DictField(),
        help_text='{"<line_id>": {"quantity": 45, "unit_cost": 120}}',
    )
    location = serializers.IntegerField(required=False, allow_null=True)
    idempotency_key = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class PurchaseOrderLineSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    remaining = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrderLine
        fields = [
            "id", "inventory_item", "item_name", "purchase_unit_label",
            "purchase_unit_conversion", "quantity", "unit_cost",
            "received_quantity", "line_total", "remaining",
        ]

    def get_remaining(self, obj):
        return str(obj.quantity - obj.received_quantity)


class PurchaseOrderSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    delivery_location_name = serializers.CharField(
        source="delivery_location.name", read_only=True
    )
    created_by_name = serializers.SerializerMethodField()
    lines = PurchaseOrderLineSerializer(many=True, read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "po_number", "supplier", "supplier_name", "status",
            "delivery_location", "delivery_location_name", "expected_date",
            "notes", "total_amount", "created_by_name", "created_at", "lines",
        ]

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return ""
        return obj.created_by.get_full_name() or obj.created_by.email


# ─────────────────────────────────────────────────────────────────────────────
# Overview / reports
# ─────────────────────────────────────────────────────────────────────────────


class OverviewSerializer(serializers.Serializer):
    inventory_value = serializers.DecimalField(max_digits=20, decimal_places=2)
    low_stock_count = serializers.IntegerField()
    out_of_stock_count = serializers.IntegerField()
    overstock_count = serializers.IntegerField()
    counts_due = serializers.IntegerField()
    open_purchase_orders = serializers.IntegerField()
    needs_attention = serializers.ListField()
    recent_movements = serializers.ListField()
    counts_due_list = serializers.ListField()

    @classmethod
    def build(cls, merchant):
        data = merchant_overview(merchant)
        data["inventory_value"] = data["inventory_value"].quantize(Decimal("0.01"))
        data["counts_due_list"] = next_count_overview(merchant)
        return cls(data).data


class InventorySettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventorySettings
        fields = [
            "require_count_approval",
            "require_adjustment_approval",
            "prevent_negative_stock",
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryAuditLog
        fields = ["id", "action", "entity_type", "entity_id", "metadata", "user_name", "created_at"]

    def get_user_name(self, obj):
        if not obj.user:
            return ""
        return obj.user.get_full_name() or obj.user.email