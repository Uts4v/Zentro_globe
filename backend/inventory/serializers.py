"""
inventory/serializers.py
"""

from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from .models import (
    AnItemType,
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
    allocate_document_number,
    base_quantity_for_purchase,
    current_actor_label,
    merchant_overview,
    next_count_overview,
    stock_status,
    suggested_order_qty,
    to_decimal,
    validate_merchant,
)


def _person(user, label=""):
    """Display name for who did something: staff name first, then the account."""
    if label:
        return label
    if not user:
        return ""
    return user.get_full_name() or user.email


class CostPrivacyMixin:
    """Blank out money fields unless the viewer may see costs.

    Views pass ``include_cost`` in the serializer context (from
    ``view_cost_allowed``). It defaults to hidden, so a new call site that
    forgets the context can never leak costs.
    """

    cost_fields: tuple = ()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self.context.get("include_cost", False):
            for name in self.cost_fields:
                if name in data:
                    data[name] = None
        return data


def _merchant_owned(obj, merchant, label):
    """Serializer-level tenant check for a related object (None allowed)."""
    if obj is None:
        return None
    owner = getattr(obj, "merchant_id", None)
    if owner is not None and owner != merchant.id:
        raise serializers.ValidationError({label: "Not found."})
    return obj


def _check_unique_codes(merchant, *, sku, barcode, exclude_id=None):
    qs = InventoryItem.objects.filter(merchant=merchant, archived=False)
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    errors = {}
    if sku and qs.filter(sku__iexact=sku).exists():
        errors["sku"] = f"Another stock item already uses SKU “{sku}”."
    if barcode and qs.filter(barcode=barcode).exists():
        errors["barcode"] = f"Another stock item already uses barcode “{barcode}”."
    if errors:
        raise serializers.ValidationError(errors)


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
        annotated = getattr(obj, "n_items", None)
        return annotated if annotated is not None else obj.inventory_items.filter(archived=False).count()


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


class InventoryItemSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("stock_value", "avg_cost")

    locations = serializers.SerializerMethodField()
    location_quantity = serializers.SerializerMethodField()
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
    menu_links = serializers.SerializerMethodField()

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
            "stock_value", "avg_cost", "balance_count", "menu_links",
            "locations", "location_quantity",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "created_at", "updated_at", "current_stock", "total_stock",
            "status", "suggested_order", "stock_value", "avg_cost",
            "balance_count", "last_count_at", "next_count_due", "last_received_at",
        ]

    def get_locations(self, obj):
        """Where the stock is right now (one row per location holding stock)."""
        rows = [
            {
                "location": b.location_id,
                "location_name": b.location.name if hasattr(b, "location") and b.location else "",
                "on_hand": str(Decimal(b.on_hand).quantize(Decimal("0.000001"))),
            }
            for b in self._balance(obj).values()
            if b.on_hand
        ]
        rows.sort(key=lambda r: r["location_name"])
        return rows

    def get_location_quantity(self, obj):
        """Stock at the location the list is filtered by, when there is one."""
        location_id = self.context.get("location_id")
        if not location_id:
            return None
        balance = self._balance(obj).get(int(location_id))
        return str(balance.on_hand) if balance else "0"

    def get_menu_links(self, obj):
        return [
            {
                "id": link.id,
                "menu_item": link.menu_item_id,
                "menu_item_name": link.menu_item.name,
                "quantity_per_unit": str(link.quantity_per_unit),
            }
            for link in obj.menu_links.all()
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
        annotated = getattr(obj, "stock_state", None)
        if annotated:
            return annotated
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
        extra_kwargs = {"category": {"required": False, "allow_null": True}}

    def validate(self, attrs):
        merchant = self.context["merchant"]

        name = (attrs.get("name") or "").strip()
        if not name:
            raise serializers.ValidationError({"name": "Give the item a name."})
        attrs["name"] = name

        for field in ("category", "default_location", "primary_supplier", "count_schedule"):
            _merchant_owned(attrs.get(field), merchant, field)
        for field in ("base_unit", "preferred_display_unit"):
            unit = attrs.get(field)
            if unit is not None and unit.merchant_id not in (None, merchant.id):
                raise serializers.ValidationError({field: "Not found."})
        base, display = attrs.get("base_unit"), attrs.get("preferred_display_unit")
        if base and display and base.kind != display.kind:
            raise serializers.ValidationError(
                {"preferred_display_unit": "Choose a unit of the same kind as how you count it."}
            )

        if attrs.get("category") is None:
            # The short "Add Stock Item" form does not ask for a category.
            attrs["category"] = (
                InventoryCategory.objects.filter(merchant=merchant, name="Other").first()
                or InventoryCategory.objects.filter(merchant=merchant).order_by("display_order").first()
            )
            if attrs["category"] is None:
                raise serializers.ValidationError({"category": "Choose a category."})

        for field in ("par_level", "reorder_point", "critical_level", "purchase_unit_conversion"):
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Cannot be negative."})
        if attrs.get("purchase_unit_conversion") == 0:
            raise serializers.ValidationError({"purchase_unit_conversion": "Pack size must be more than 0."})

        opening = attrs.get("opening_quantity")
        if opening is not None and opening < 0:
            raise serializers.ValidationError({"opening_quantity": "Cannot be negative."})
        if opening and opening > 0 and not attrs.get("default_location"):
            raise serializers.ValidationError(
                {"default_location": "Choose where it is stored so the starting stock has a place."}
            )
        cost = attrs.get("opening_unit_cost")
        if cost is not None and cost < 0:
            raise serializers.ValidationError({"opening_unit_cost": "Cost cannot be negative."})

        _check_unique_codes(merchant, sku=attrs.get("sku", ""), barcode=attrs.get("barcode", ""))
        return attrs

    def create(self, validated_data):
        opening_qty = validated_data.pop("opening_quantity", None)
        opening_cost = validated_data.pop("opening_unit_cost", None)
        merchant = self.context["merchant"]

        with transaction.atomic():
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


class MovementSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("unit_cost",)

    item = serializers.CharField(source="inventory_item.name", read_only=True)
    item_id = serializers.IntegerField(source="inventory_item_id", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)
    performed_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    is_reversed = serializers.SerializerMethodField()

    class Meta:
        model = InventoryMovement
        fields = [
            "id", "movement_type", "item", "item_id", "location_name", "quantity_change",
            "unit_code", "source_type", "source_id", "reason", "note",
            "balance_before", "balance_after", "unit_cost",
            "performed_by_name", "approved_by_name", "reversal_of", "is_reversed", "created_at",
        ]

    def get_performed_by_name(self, obj):
        return _person(obj.performed_by, obj.actor_label)

    def get_approved_by_name(self, obj):
        if not obj.approved_by or obj.approved_by_id == obj.performed_by_id:
            return ""
        return _person(obj.approved_by)

    def get_is_reversed(self, obj):
        reversed_ids = self.context.get("reversed_ids")
        if reversed_ids is not None:
            return obj.id in reversed_ids
        return obj.reversals.exists()


# ─────────────────────────────────────────────────────────────────────────────
# Waste / Adjustment / Receiving / Transfer
# ─────────────────────────────────────────────────────────────────────────────


class WasteRecordSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("per_unit_cost",)

    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    location_name = serializers.CharField(source="location.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)
    reason_label = serializers.CharField(source="get_reason_display", read_only=True)
    performed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryWasteRecord
        fields = [
            "id", "inventory_item", "item_name", "location", "location_name",
            "quantity", "unit_code", "reason", "reason_label", "custom_reason", "note",
            "per_unit_cost", "performed_by_name", "created_at",
        ]
        read_only_fields = ["per_unit_cost", "created_at"]

    def get_performed_by_name(self, obj):
        return _person(obj.performed_by, obj.performed_by_label)

    def validate(self, attrs):
        merchant = self.context.get("merchant")
        if merchant is not None:
            _merchant_owned(attrs.get("inventory_item"), merchant, "inventory_item")
            _merchant_owned(attrs.get("location"), merchant, "location")
        if attrs.get("quantity") is not None and attrs["quantity"] <= 0:
            raise serializers.ValidationError({"quantity": "Enter how much was wasted."})
        return attrs

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
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = InventoryAdjustment
        fields = [
            "id", "inventory_item", "item_name", "location", "location_name",
            "quantity_delta", "unit_code", "reason", "note", "status",
            "approved", "approved_by", "approved_by_name", "decided_at",
            "performed_by_name", "created_at",
        ]
        read_only_fields = ["status", "approved", "approved_by", "decided_at", "created_at"]

    def get_performed_by_name(self, obj):
        return _person(obj.performed_by, obj.performed_by_label)

    def get_approved_by_name(self, obj):
        return _person(obj.approved_by) if obj.approved_by else ""

    def validate(self, attrs):
        merchant = self.context.get("merchant")
        if merchant is not None:
            _merchant_owned(attrs.get("inventory_item"), merchant, "inventory_item")
            _merchant_owned(attrs.get("location"), merchant, "location")
        if not (attrs.get("reason") or "").strip():
            raise serializers.ValidationError({"reason": "Say why the stock needs fixing."})
        return attrs

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        requires_approval = bool(self.context.get("requires_approval"))
        adjustment = InventoryMovementService.manual_adjustment(
            merchant=merchant,
            item=validated_data["inventory_item"],
            location=validated_data["location"],
            quantity_delta=validated_data["quantity_delta"],
            reason=validated_data["reason"],
            note=validated_data.get("note", ""),
            performed_by=user,
            approved_by=None if requires_approval else user,
            idempotency_key=self.context.get("idempotency_key"),
            requires_approval=requires_approval,
        )
        return adjustment


class ReceivingLineSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("unit_cost", "line_total")

    item_name = serializers.CharField(source="inventory_item.name", read_only=True)
    unit_code = serializers.CharField(source="inventory_item.base_unit.code", read_only=True)

    class Meta:
        model = InventoryReceivingLine
        fields = [
            "id", "inventory_item", "item_name", "purchase_unit_label",
            "quantity_purchased", "base_quantity", "unit_code", "unit_cost", "line_total",
        ]


class ReceivingSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("total_value",)

    supplier_name = serializers.SerializerMethodField()
    location_name = serializers.CharField(source="location.name", read_only=True)
    received_by_name = serializers.SerializerMethodField()
    lines = serializers.SerializerMethodField()

    def get_lines(self, obj):
        return ReceivingLineSerializer(obj.lines.all(), many=True, context=self.context).data

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

    def validate(self, attrs):
        merchant = self.context["merchant"]
        _merchant_owned(attrs.get("location"), merchant, "location")
        _merchant_owned(attrs.get("supplier"), merchant, "supplier")
        _merchant_owned(attrs.get("purchase_order"), merchant, "purchase_order")
        if not attrs.get("lines"):
            raise serializers.ValidationError({"lines": "Add at least one item that arrived."})
        return attrs

    @staticmethod
    def _line_decimal(line, key, label):
        try:
            return to_decimal(line.get(key))
        except ValueError:
            raise serializers.ValidationError({"lines": f"{label} must be a number."})

    def create(self, validated_data):
        merchant = self.context["merchant"]
        user = self.context["user"]
        idempotency_key = (self.context.get("idempotency_key") or "").strip()[:128]
        lines_data = validated_data.pop("lines", [])
        location = validated_data["location"]
        supplier = validated_data.get("supplier")

        if idempotency_key:
            existing = InventoryReceiving.objects.filter(
                merchant=merchant, idempotency_key=idempotency_key
            ).first()
            if existing:
                return existing

        with transaction.atomic():
            receiving = InventoryReceiving.objects.create(
                merchant=merchant,
                received_by=user,
                receipt_number=allocate_document_number(merchant, "receipt"),
                idempotency_key=idempotency_key,
                **validated_data,
            )
            total = Decimal("0")
            for index, line in enumerate(lines_data):
                if not isinstance(line, dict):
                    raise serializers.ValidationError({"lines": "Each line needs an item and amount."})
                item = InventoryItem.objects.filter(
                    merchant=merchant, id=line.get("item_id"), archived=False
                ).first()
                if not item:
                    raise serializers.ValidationError({"lines": "One of the items was not found."})
                qty = self._line_decimal(line, "quantity", "Amount")
                if qty is None or qty <= 0:
                    raise serializers.ValidationError({"lines": f"Enter how much {item.name} arrived."})
                label = line.get("purchase_unit_label") or item.purchase_unit_label or ""
                if "purchase_unit_conversion" in line:
                    # Sent explicitly: a pack size, or empty/null meaning the
                    # amount is already in the unit the item is counted in.
                    conversion = self._line_decimal(line, "purchase_unit_conversion", "Pack size")
                    if conversion is None:
                        conversion = Decimal("1")
                        label = ""
                else:
                    conversion = item.purchase_unit_conversion
                if conversion is not None and conversion <= 0:
                    raise serializers.ValidationError({"lines": "Pack size must be more than 0."})
                if not conversion:
                    label = ""
                unit_cost_line = self._line_decimal(line, "unit_cost", "Cost")
                if unit_cost_line is not None and unit_cost_line < 0:
                    raise serializers.ValidationError({"lines": "Cost cannot be negative."})
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
                    reason=f"Receiving {receiving.receipt_number}",
                    note=supplier.name if supplier else "",
                    source_type="RECEIVING",
                    source_id=receiving.id,
                    performed_by=user,
                    idempotency_key=f"receiving-{receiving.id}-line-{index}",
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
        """Create a move. With context ``complete`` the stock moves right away.

        Completing in the same transaction means a move that fails (e.g. not
        enough stock at the source) leaves nothing behind.
        """
        merchant = self.context["merchant"]
        user = self.context["user"]
        lines_data = validated_data.pop("lines", [])
        if validated_data["from_location"].merchant_id != merchant.id or \
                validated_data["to_location"].merchant_id != merchant.id:
            raise serializers.ValidationError("Both locations must belong to your business.")
        if validated_data["from_location"].id == validated_data["to_location"].id:
            raise serializers.ValidationError("Choose two different places to move between.")
        if not lines_data:
            raise serializers.ValidationError("Add at least one item to move.")

        with transaction.atomic():
            transfer = InventoryTransfer.objects.create(
                merchant=merchant,
                created_by=user,
                status="DRAFT",
                **validated_data,
            )
            for line in lines_data:
                if not isinstance(line, dict):
                    raise serializers.ValidationError("Each line needs an item and amount.")
                item = InventoryItem.objects.filter(
                    merchant=merchant, id=line.get("item_id"), archived=False
                ).first()
                if not item:
                    raise serializers.ValidationError("One of the items was not found.")
                try:
                    qty = to_decimal(line.get("quantity"))
                except ValueError:
                    raise serializers.ValidationError("Amount must be a number.")
                if qty is None or qty <= 0:
                    raise serializers.ValidationError(f"Enter how much {item.name} to move.")
                InventoryTransferLine.objects.create(
                    transfer=transfer, inventory_item=item, quantity=qty
                )
            if self.context.get("complete"):
                try:
                    InventoryMovementService.transfer(
                        merchant=merchant,
                        transfer=transfer,
                        performed_by=user,
                        idempotency_key=f"transfer-{transfer.id}",
                    )
                except ValueError as exc:
                    raise serializers.ValidationError(str(exc))
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


class StockCountSummarySerializer(serializers.ModelSerializer):
    """List view: no lines, counts come from annotations when present."""

    location_name = serializers.SerializerMethodField()
    started_by_name = serializers.SerializerMethodField()
    submitted_by_name = serializers.SerializerMethodField()
    line_count = serializers.SerializerMethodField()
    counted_count = serializers.SerializerMethodField()
    difference_count = serializers.SerializerMethodField()

    class Meta:
        model = StockCount
        fields = [
            "id", "name", "count_type", "location", "location_name", "status",
            "started_at", "submitted_at", "approved_at", "started_by_name",
            "submitted_by_name", "note", "created_at",
            "line_count", "counted_count", "difference_count",
        ]

    def get_location_name(self, obj):
        return obj.location.name if obj.location else "All locations"

    def get_started_by_name(self, obj):
        return _person(obj.started_by)

    def get_submitted_by_name(self, obj):
        return _person(obj.submitted_by)

    def get_line_count(self, obj):
        value = getattr(obj, "n_lines", None)
        return value if value is not None else obj.lines.count()

    def get_counted_count(self, obj):
        value = getattr(obj, "n_counted", None)
        return value if value is not None else obj.lines.filter(physical_quantity__isnull=False).count()

    def get_difference_count(self, obj):
        value = getattr(obj, "n_different", None)
        if value is not None:
            return value
        return obj.lines.exclude(difference__isnull=True).exclude(difference=0).count()


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
        return _person(obj.started_by)

    def get_submitted_by_name(self, obj):
        return _person(obj.submitted_by)

    def get_approved_by_name(self, obj):
        return _person(obj.approved_by)

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


class SupplierItemSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("latest_unit_cost",)

    item_name = serializers.CharField(source="inventory_item.name", read_only=True)

    class Meta:
        model = SupplierItem
        fields = [
            "id", "inventory_item", "item_name", "supplier_sku",
            "purchase_unit_label", "purchase_unit_conversion",
            "latest_unit_cost", "preferred", "minimum_quantity", "lead_time_days",
        ]


class SupplierSerializer(serializers.ModelSerializer):
    item_mappings = serializers.SerializerMethodField()

    def get_item_mappings(self, obj):
        return SupplierItemSerializer(obj.item_mappings.all(), many=True, context=self.context).data

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


class PurchaseOrderLineSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("unit_cost", "line_total")

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


class PurchaseOrderSerializer(CostPrivacyMixin, serializers.ModelSerializer):
    cost_fields = ("total_amount",)

    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    delivery_location_name = serializers.CharField(
        source="delivery_location.name", read_only=True
    )
    created_by_name = serializers.SerializerMethodField()
    lines = serializers.SerializerMethodField()

    def get_lines(self, obj):
        return PurchaseOrderLineSerializer(obj.lines.all(), many=True, context=self.context).data

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
    inventory_value = serializers.DecimalField(max_digits=20, decimal_places=2, allow_null=True)
    total_items = serializers.IntegerField()
    low_stock_count = serializers.IntegerField()
    very_low_count = serializers.IntegerField()
    out_of_stock_count = serializers.IntegerField()
    overstock_count = serializers.IntegerField()
    attention_total = serializers.IntegerField()
    counts_due = serializers.IntegerField()
    open_purchase_orders = serializers.IntegerField()
    counts_waiting_review = serializers.IntegerField()
    corrections_waiting = serializers.IntegerField()
    needs_attention = serializers.ListField()
    recent_movements = serializers.ListField()
    counts_due_list = serializers.ListField()

    @classmethod
    def build(cls, merchant, include_cost=False):
        from .models import AdjustmentStatus, CountStatus

        data = merchant_overview(merchant, include_cost=include_cost)
        if data["inventory_value"] is not None:
            data["inventory_value"] = data["inventory_value"].quantize(Decimal("0.01"))
        data["counts_due_list"] = next_count_overview(merchant)
        data["counts_waiting_review"] = StockCount.objects.filter(
            merchant=merchant, status=CountStatus.SUBMITTED
        ).count()
        data["corrections_waiting"] = InventoryAdjustment.objects.filter(
            merchant=merchant, status=AdjustmentStatus.PENDING
        ).count()
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