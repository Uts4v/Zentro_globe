"""
inventory/models.py

Zentro Inventory & Stock Management.

Core principle (V1): inventory is maintained through receiving, physical
stock counts, reconciliation, transfers, explicitly recorded waste and
manual adjustments. Orders (POS / QR / AI Waiter / customer app) do NOT
automatically deduct inventory.

Authoritative stock mutations go through `InventoryMovementService`
(inventory/services.py). No code outside that service may write
`InventoryBalance`.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.core.exceptions import ValidationError

# ─────────────────────────────────────────────────────────────────────────────
# Choices
# ─────────────────────────────────────────────────────────────────────────────


class AnItemType(models.TextChoices):
    """System-controlled behavioural item types (not merchant categories)."""

    INGREDIENT = "INGREDIENT", "Ingredient"
    PREPARED = "PREPARED", "Prepared"
    DIRECT_SALE = "DIRECT_SALE", "Direct Sale"
    SUPPLY = "SUPPLY", "Supply"


class UnitKind(models.TextChoices):
    WEIGHT = "WEIGHT", "Weight"
    VOLUME = "VOLUME", "Volume"
    COUNT = "COUNT", "Count"


class MovementType(models.TextChoices):
    OPENING_BALANCE = "OPENING_BALANCE", "Opening Balance"
    RECEIVE = "RECEIVE", "Receiving"
    TRANSFER_IN = "TRANSFER_IN", "Transfer In"
    TRANSFER_OUT = "TRANSFER_OUT", "Transfer Out"
    EXPLICIT_WASTE = "EXPLICIT_WASTE", "Explicit Waste"
    MANUAL_ADJUSTMENT = "MANUAL_ADJUSTMENT", "Manual Adjustment"
    COUNT_RECONCILIATION = "COUNT_RECONCILIATION", "Count Reconciliation"
    RETURN_TO_SUPPLIER = "RETURN_TO_SUPPLIER", "Return to Supplier"
    REVERSAL = "REVERSAL", "Reversal"


class MovementSource(models.TextChoices):
    ITEM_CREATE = "ITEM_CREATE", "Item Create"
    RECEIVING = "RECEIVING", "Receiving"
    PO_RECEIVE = "PO_RECEIVE", "Purchase Order Receiving"
    WASTE_RECORD = "WASTE_RECORD", "Waste Record"
    ADJUSTMENT = "ADJUSTMENT", "Adjustment"
    TRANSFER = "TRANSFER", "Transfer"
    STOCK_COUNT = "STOCK_COUNT", "Stock Count"
    SUPPLIER_RETURN = "SUPPLIER_RETURN", "Supplier Return"
    REVERSAL = "REVERSAL", "Reversal"


class CountStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    SUBMITTED = "SUBMITTED", "Submitted"
    APPROVED = "APPROVED", "Approved"
    CANCELLED = "CANCELLED", "Cancelled"


class TransferStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    REQUESTED = "REQUESTED", "Requested"
    APPROVED = "APPROVED", "Approved"
    IN_TRANSIT = "IN_TRANSIT", "In Transit"
    RECEIVED = "RECEIVED", "Received"
    CANCELLED = "CANCELLED", "Cancelled"


class OrderStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    SENT = "SENT", "Sent"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED", "Partially Received"
    RECEIVED = "RECEIVED", "Received"
    CANCELLED = "CANCELLED", "Cancelled"


class ScheduleFrequency(models.TextChoices):
    DAILY = "DAILY", "Daily"
    EVERY_N_DAYS = "EVERY_N_DAYS", "Every N days"
    WEEKLY = "WEEKLY", "Weekly"
    MONTHLY = "MONTHLY", "Monthly"
    CUSTOM = "CUSTOM", "Custom"


class ScheduleScope(models.TextChoices):
    ITEM = "ITEM", "Item"
    CATEGORY = "CATEGORY", "Category"
    LOCATION = "LOCATION", "Location"


class WasteReason(models.TextChoices):
    SPOILED = "SPOILED", "Spoiled"
    EXPIRED = "EXPIRED", "Expired"
    DROPPED = "DROPPED", "Dropped"
    DAMAGED = "DAMAGED", "Damaged"
    OVER_PREPARED = "OVER_PREPARED", "Over-prepared"
    KITCHEN_MISTAKE = "KITCHEN_MISTAKE", "Kitchen mistake"
    CUSTOMER_RETURN = "CUSTOMER_RETURN", "Customer return"
    STAFF_MEAL = "STAFF_MEAL", "Staff meal"
    OTHER = "OTHER", "Other"


# ─────────────────────────────────────────────────────────────────────────────
# Reference data
# ─────────────────────────────────────────────────────────────────────────────


class UnitOfMeasure(models.Model):
    """
    Unit catalog. System base units are merchant=None:

      WEIGHT: mg (0.001), g (1), kg (1000)
      VOLUME: ml (1), L (1000)
      COUNT : piece (1)

    `factor_to_base` converts 1 of this unit into the canonical base of its
    kind (g / ml / piece). Merchant-created COUNT packaging units (bottle,
    can, packet, box, sack …) are created with factor 1 and act as base-ish
    units for that merchant. Item-specific purchase-unit conversions (e.g.
    "25kg sack = 25000 g") live on the item/supplier item, NOT here, so an
    incompatible "kg → liter" conversion can never be applied.

    Cross-kind conversions (kg -> L) are impossible by design.
    """

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_units",
        null=True,
        blank=True,
        help_text="Null for system units shared by every merchant.",
    )
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=60)
    kind = models.CharField(max_length=20, choices=UnitKind.choices)
    factor_to_base = models.DecimalField(
        max_digits=24, decimal_places=12, default=1,
        help_text="How many canonical base units (g/ml/piece) equal 1 of this unit.",
    )
    is_base = models.BooleanField(
        default=False,
        help_text="True if this unit defines the canonical base for its kind.",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_units"
        ordering = ["kind", "factor_to_base", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "code"],
                name="uniq_inventory_unit_code_per_merchant",
            ),
            models.UniqueConstraint(
                fields=["code"],
                condition=models.Q(merchant__isnull=True),
                name="uniq_inventory_system_unit_code",
            ),
            models.CheckConstraint(
                condition=models.Q(factor_to_base__gt=0),
                name="ck_inventory_unit_factor_positive",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.kind})"

    @classmethod
    def system_base_units(cls):
        return list(cls.objects.filter(merchant__isnull=True, is_base=True))

    def clean(self):
        if self.kind == UnitKind.COUNT and self.code.lower() == "piece":
            return
        if not self.is_base and self.factor_to_base is None:
            raise ValidationError("factor_to_base is required for derived units.")


class InventoryCategory(models.Model):
    """Merchant-customizable categories. Never hard-deleted when it has items."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_categories",
    )
    name = models.CharField(max_length=100)
    display_order = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_categories"
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "name"],
                name="uniq_inventory_category_per_merchant",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class InventoryLocation(models.Model):
    """Physical stock location. Merchant custom, defaults seeded per merchant."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_locations",
    )
    name = models.CharField(max_length=120)
    branch = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="+",
        help_text="Reserved for future multi-branch support. Null = current branch scope.",
    )
    display_order = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_locations"
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "name"],
                name="uniq_inventory_location_per_merchant",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class InventoryCountSchedule(models.Model):
    """Optional reminder-only schedule. Never modifies stock by itself."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_count_schedules",
    )
    name = models.CharField(max_length=120)
    scope_type = models.CharField(max_length=20, choices=ScheduleScope.choices)
    item = models.ForeignKey(
        "InventoryItem",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="count_schedules_dir",
    )
    category = models.ForeignKey(
        InventoryCategory,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="count_schedules",
    )
    location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="count_schedules",
    )
    frequency_type = models.CharField(max_length=20, choices=ScheduleFrequency.choices)
    frequency_days = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Used by EVERY_N_DAYS (and CUSTOM with a day interval).",
    )
    next_due_at = models.DateField(null=True, blank=True)
    last_run_at = models.DateField(null=True, blank=True)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_count_schedules"
        ordering = ["-next_due_at"]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


# ─────────────────────────────────────────────────────────────────────────────
# Core inventory
# ─────────────────────────────────────────────────────────────────────────────


class InventoryItem(models.Model):
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_items",
    )
    name = models.CharField(max_length=255)
    item_type = models.CharField(max_length=20, choices=AnItemType.choices)
    category = models.ForeignKey(
        InventoryCategory,
        on_delete=models.PROTECT,
        related_name="inventory_items",
    )
    default_location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="inventory_items",
    )
    base_unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="+",
        help_text="Unit in which on-hand quantity is stored internally.",
    )
    preferred_display_unit = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text="Optional larger display unit (e.g. kg when stored in g).",
    )
    # Item-specific purchase packaging (e.g. "25kg Sack" = 25000 g)
    purchase_unit_label = models.CharField(max_length=80, blank=True, default="")
    purchase_unit_conversion = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Base units contained in one purchase unit (e.g. 25000 for 25kg sack of g-based flour).",
    )
    sku = models.CharField(max_length=120, blank=True, default="")
    barcode = models.CharField(max_length=120, blank=True, default="")
    description = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    archived = models.BooleanField(default=False)

    par_level = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Preferred target quantity (base units).",
    )
    reorder_point = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Below this the stock status becomes LOW (base units).",
    )
    critical_level = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Below this the stock status becomes CRITICAL (base units). Falls back to half the reorder point when unset.",
    )

    primary_supplier = models.ForeignKey(
        "Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="primary_items",
    )
    count_schedule = models.ForeignKey(
        InventoryCountSchedule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scheduled_items",
    )

    last_count_at = models.DateField(null=True, blank=True)
    next_count_due = models.DateField(null=True, blank=True)
    last_received_at = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_items"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["merchant", "active", "archived"], name="inv_item_merchant_state_idx"),
            models.Index(fields=["merchant", "category"], name="inv_item_merchant_category_idx"),
            models.Index(fields=["merchant", "item_type"], name="inv_item_merchant_type_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(par_level__isnull=True) | models.Q(par_level__gte=0)
                ),
                name="ck_inv_item_par_nonneg",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(reorder_point__isnull=True) | models.Q(reorder_point__gte=0)
                ),
                name="ck_inv_item_reorder_nonneg",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class InventoryBalance(models.Model):
    """Current on-hand per (item, location). Optimized state; movements are truth."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_balances",
    )
    location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.PROTECT,
        related_name="inventory_balances",
    )
    inventory_item = models.ForeignKey(
        InventoryItem,
        on_delete=models.CASCADE,
        related_name="balances",
    )
    on_hand = models.DecimalField(
        max_digits=24, decimal_places=6, default=0,
        help_text="Current quantity in the item's base unit.",
    )
    avg_cost = models.DecimalField(
        max_digits=14, decimal_places=4, default=0,
        help_text="Weighted average purchase cost per base unit (item+location).",
    )
    latest_cost = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Most recent purchase cost per base unit.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_balances"
        indexes = [
            models.Index(fields=["merchant", "inventory_item"], name="inv_bal_merchant_item_idx"),
            models.Index(fields=["merchant", "location"], name="inv_bal_merchant_loc_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["inventory_item", "location"],
                name="uniq_inventory_balance_item_location",
            ),
            models.CheckConstraint(
                condition=models.Q(on_hand__gte=0),
                name="ck_inventory_balance_on_hand_nonneg",
            ),
        ]

    def __str__(self):
        return f"{self.inventory_item.name} @ {self.location.name}: {self.on_hand}"


class InventoryMovement(models.Model):
    """Immutable ledger. Every stock change creates exactly one movement."""

    id = models.BigAutoField(primary_key=True)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_movements",
    )
    location = models.ForeignKey(
        InventoryLocation,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
    )
    inventory_item = models.ForeignKey(
        InventoryItem,
        on_delete=models.PROTECT,
        related_name="inventory_movements",
    )
    quantity_change = models.DecimalField(
        max_digits=24, decimal_places=6,
        help_text="Signed change in base units. Inbound positive, outbound negative.",
    )
    movement_type = models.CharField(max_length=30, choices=MovementType.choices)
    source_type = models.CharField(
        max_length=30, choices=MovementSource.choices, blank=True, default=""
    )
    source_id = models.CharField(max_length=64, blank=True, default="")
    reason = models.CharField(max_length=255, blank=True, default="")
    note = models.TextField(blank=True, default="")

    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_movements",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_inventory_movements",
    )

    balance_before = models.DecimalField(max_digits=24, decimal_places=6, default=0)
    balance_after = models.DecimalField(max_digits=24, decimal_places=6, default=0)

    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Cost per base unit captured at movement time.",
    )
    reversal_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reversals",
        help_text="When REVERSAL, points to the movement being corrected.",
    )

    idempotency_key = models.CharField(
        max_length=128, unique=True, null=True, blank=True, db_index=True,
        help_text="Prevents duplicate movements from double-clicks / retries.",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "inventory_movements"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["merchant", "inventory_item", "-created_at"], name="inv_mov_item_created_idx"),
            models.Index(fields=["merchant", "movement_type"], name="inv_mov_type_idx"),
            models.Index(fields=["inventory_item", "location"], name="inv_mov_item_loc_idx"),
        ]

    def __str__(self):
        return f"{self.movement_type} {self.quantity_change} {self.inventory_item.name}"


# ─────────────────────────────────────────────────────────────────────────────
# Explicit business documents (each drives movements through the service)
# ─────────────────────────────────────────────────────────────────────────────


class InventoryAdjustment(models.Model):
    """Manual adjustment — exceptional correction outside physical counts."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_adjustments",
    )
    location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="inventory_adjustments"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="inventory_adjustments"
    )
    quantity_delta = models.DecimalField(
        max_digits=24, decimal_places=6,
        help_text="Signed change in base units (+ increase / - decrease).",
    )
    reason = models.CharField(max_length=255)
    note = models.TextField(blank=True, default="")
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_adjustments",
    )
    approved = models.BooleanField(default=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_inventory_adjustments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_adjustments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Adjustment {self.quantity_delta} {self.inventory_item.name}"


class InventoryWasteRecord(models.Model):
    """Explicitly recorded waste. Never inferred from count variance."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_waste_records",
    )
    location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="inventory_waste_records"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="inventory_waste_records"
    )
    quantity = models.DecimalField(max_digits=24, decimal_places=6, help_text="Positive, base units.")
    reason = models.CharField(max_length=40, choices=WasteReason.choices, default=WasteReason.OTHER)
    custom_reason = models.CharField(max_length=120, blank=True, default="")
    note = models.TextField(blank=True, default="")
    per_unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Reported cost per base unit at time of recording.",
    )
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_waste_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_waste_records"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="ck_inventory_waste_quantity_positive",
            ),
        ]

    def __str__(self):
        return f"Waste {self.quantity} {self.inventory_item.name} ({self.reason})"


class InventoryReceiving(models.Model):
    """Receiving document. Increases stock immediately."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_receivings",
    )
    receipt_number = models.CharField(max_length=40, blank=True, default="")
    supplier = models.ForeignKey(
        "Supplier", on_delete=models.PROTECT, null=True, blank=True, related_name="receivings"
    )
    purchase_order = models.ForeignKey(
        "PurchaseOrder", on_delete=models.SET_NULL, null=True, blank=True, related_name="receivings"
    )
    location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="inventory_receivings"
    )
    reference = models.CharField(max_length=120, blank=True, default="")
    note = models.TextField(blank=True, default="")
    total_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_receivings",
    )
    received_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_receivings"
        ordering = ["-received_at"]

    def __str__(self):
        return f"Receiving {self.receipt_number or self.id}"


class InventoryReceivingLine(models.Model):
    receiving = models.ForeignKey(
        InventoryReceiving, on_delete=models.CASCADE, related_name="lines"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="receiving_lines"
    )
    purchase_unit_label = models.CharField(max_length=80, blank=True, default="")
    quantity_purchased = models.DecimalField(
        max_digits=24, decimal_places=6,
        help_text="Quantity expressed in the purchase unit (e.g. sacks/cases).",
    )
    base_quantity = models.DecimalField(
        max_digits=24, decimal_places=6,
        help_text="Computed quantity in the item's base unit after conversion.",
    )
    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Cost per purchase unit.",
    )
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "inventory_receiving_lines"

    def __str__(self):
        return f"{self.base_quantity} × {self.inventory_item.name}"


class InventoryTransfer(models.Model):
    """Stock moved between locations. Merchant total unchanged."""

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_transfers",
    )
    from_location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="transfer_outs"
    )
    to_location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="transfer_ins"
    )
    status = models.CharField(
        max_length=20, choices=TransferStatus.choices, default=TransferStatus.DRAFT
    )
    note = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_transfers",
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_transfers"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.from_location.name} → {self.to_location.name}"


class InventoryTransferLine(models.Model):
    transfer = models.ForeignKey(
        InventoryTransfer, on_delete=models.CASCADE, related_name="lines"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="transfer_lines"
    )
    quantity = models.DecimalField(
        max_digits=24, decimal_places=6, help_text="Base units being moved.",
    )

    class Meta:
        db_table = "inventory_transfer_lines"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="ck_inventory_transfer_qty_positive",
            ),
        ]

    def __str__(self):
        return f"{self.quantity} × {self.inventory_item.name}"


class Supplier(models.Model):
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_suppliers",
    )
    name = models.CharField(max_length=200)
    contact_person = models.CharField(max_length=120, blank=True, default="")
    phone = models.CharField(max_length=40, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    lead_time_days = models.PositiveIntegerField(null=True, blank=True)
    minimum_order = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text="Optional minimum order value in merchant currency.",
    )
    payment_terms = models.CharField(max_length=120, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_suppliers"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "name"],
                name="uniq_inventory_supplier_per_merchant",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class SupplierItem(models.Model):
    supplier = models.ForeignKey(
        Supplier, on_delete=models.CASCADE, related_name="item_mappings"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.CASCADE, related_name="supplier_mappings"
    )
    supplier_sku = models.CharField(max_length=120, blank=True, default="")
    purchase_unit_label = models.CharField(max_length=80, blank=True, default="")
    purchase_unit_conversion = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Base units per purchase unit for THIS supplier.",
    )
    latest_unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, null=True, blank=True,
        help_text="Cost per purchase unit.",
    )
    preferred = models.BooleanField(default=False)
    minimum_quantity = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="Optional minimum order qty in purchase units.",
    )
    lead_time_days = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_supplier_items"
        constraints = [
            models.UniqueConstraint(
                fields=["supplier", "inventory_item"],
                name="uniq_actual_supplier_item",
            ),
        ]

    def __str__(self):
        return f"{self.supplier.name} → {self.inventory_item.name}"


class PurchaseOrder(models.Model):
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_purchase_orders",
    )
    po_number = models.CharField(max_length=40, blank=True, default="")
    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="purchase_orders"
    )
    status = models.CharField(max_length=30, choices=OrderStatus.choices, default=OrderStatus.DRAFT)
    delivery_location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="purchase_orders"
    )
    expected_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_purchase_orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_purchase_orders"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.po_number or self.id} ({self.supplier.name})"


class PurchaseOrderLine(models.Model):
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.CASCADE, related_name="lines"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="purchase_order_lines"
    )
    purchase_unit_label = models.CharField(max_length=80, blank=True, default="")
    purchase_unit_conversion = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
    )
    quantity = models.DecimalField(
        max_digits=24, decimal_places=6, help_text="Quantity in purchase units.",
    )
    unit_cost = models.DecimalField(
        max_digits=14, decimal_places=4, help_text="Cost per purchase unit.",
    )
    received_quantity = models.DecimalField(
        max_digits=24, decimal_places=6, default=0,
        help_text="Purchase units actually received so far.",
    )
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "inventory_purchase_order_lines"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="ck_inventory_po_line_qty_positive",
            ),
            models.CheckConstraint(
                condition=models.Q(received_quantity__gte=0),
                name="ck_inventory_po_line_received_nonneg",
            ),
        ]

    def __str__(self):
        return f"{self.quantity} × {self.inventory_item.name}"


# ─────────────────────────────────────────────────────────────────────────────
# Physical stock counts & reconciliation
# ─────────────────────────────────────────────────────────────────────────────


class StockCount(models.Model):
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_stock_counts",
    )
    name = models.CharField(max_length=160)
    count_type = models.CharField(max_length=80, blank=True, default="Stock Count")
    location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, null=True, blank=True,
        related_name="stock_counts",
        help_text="Optional single-location count. Null = across locations.",
    )
    status = models.CharField(
        max_length=20, choices=CountStatus.choices, default=CountStatus.DRAFT, db_index=True
    )
    started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="started_stock_counts",
    )
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="submitted_stock_counts",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_stock_counts",
    )
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_counts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "status"], name="inv_count_status_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.status})"


class StockCountLine(models.Model):
    stock_count = models.ForeignKey(
        StockCount, on_delete=models.CASCADE, related_name="lines"
    )
    inventory_item = models.ForeignKey(
        InventoryItem, on_delete=models.PROTECT, related_name="stock_count_lines"
    )
    location = models.ForeignKey(
        InventoryLocation, on_delete=models.PROTECT, related_name="stock_count_lines"
    )
    book_quantity = models.DecimalField(
        max_digits=24, decimal_places=6,
        help_text="Snapshot of the system balance at count start (prevents moving targets).",
    )
    physical_quantity = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="What the employee physically counted (base units).",
    )
    difference = models.DecimalField(
        max_digits=24, decimal_places=6, null=True, blank=True,
        help_text="physical - book. Stock variance, NOT waste and NOT usage.",
    )
    previous_count_at = models.DateField(null=True, blank=True)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_count_lines"
        constraints = [
            models.UniqueConstraint(
                fields=["stock_count", "inventory_item", "location"],
                name="uniq_stock_count_line_item_location",
            ),
        ]

    def __str__(self):
        return f"{self.inventory_item.name} (book {self.book_quantity})"


# ─────────────────────────────────────────────────────────────────────────────
# Settings & Audit
# ─────────────────────────────────────────────────────────────────────────────


class InventorySettings(models.Model):
    merchant = models.OneToOneField(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_settings",
    )
    require_count_approval = models.BooleanField(
        default=True,
        help_text="When OFF, a submitted count immediately reconciles. When ON, a manager must approve.",
    )
    require_adjustment_approval = models.BooleanField(
        default=False,
        help_text="When ON, manual adjustments require a manager approval step.",
    )
    prevent_negative_stock = models.BooleanField(
        default=True,
        help_text="Reject movements that would take on-hand below zero.",
    )
    update_items_last_received = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_settings"

    def __str__(self):
        return f"Inventory settings — {self.merchant.business_name}"

    @classmethod
    def for_merchant(cls, merchant) -> "InventorySettings":
        obj, _ = cls.objects.get_or_create(merchant=merchant)
        return obj


class InventoryAuditLog(models.Model):
    ACTION_ITEM_CREATED = "item_created"
    ACTION_ITEM_UPDATED = "item_updated"
    ACTION_OPENING_STOCK = "opening_stock"
    ACTION_RECEIVING = "receiving"
    ACTION_PO_CREATED = "po_created"
    ACTION_PO_RECEIVED = "po_received"
    ACTION_COUNT_STARTED = "count_started"
    ACTION_COUNT_SUBMITTED = "count_submitted"
    ACTION_COUNT_APPROVED = "count_approved"
    ACTION_COUNT_CANCELLED = "count_cancelled"
    ACTION_WASTE = "waste"
    ACTION_ADJUSTMENT = "adjustment"
    ACTION_TRANSFER = "transfer"
    ACTION_TRANSFER_COMPLETE = "transfer_complete"
    ACTION_SUPPLIER_EDIT = "supplier_edit"
    ACTION_SETTINGS_UPDATED = "settings_updated"
    ACTION_REVERSAL = "reversal"

    ACTION_CHOICES = [
        (ACTION_ITEM_CREATED, "Item Created"),
        (ACTION_ITEM_UPDATED, "Item Updated"),
        (ACTION_OPENING_STOCK, "Opening Stock"),
        (ACTION_RECEIVING, "Receiving"),
        (ACTION_PO_CREATED, "Purchase Order Created"),
        (ACTION_PO_RECEIVED, "Purchase Order Received"),
        (ACTION_COUNT_STARTED, "Count Started"),
        (ACTION_COUNT_SUBMITTED, "Count Submitted"),
        (ACTION_COUNT_APPROVED, "Count Approved"),
        (ACTION_COUNT_CANCELLED, "Count Cancelled"),
        (ACTION_WASTE, "Waste"),
        (ACTION_ADJUSTMENT, "Adjustment"),
        (ACTION_TRANSFER, "Transfer"),
        (ACTION_TRANSFER_COMPLETE, "Transfer Complete"),
        (ACTION_SUPPLIER_EDIT, "Supplier Edit"),
        (ACTION_SETTINGS_UPDATED, "Settings Updated"),
        (ACTION_REVERSAL, "Reversal"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="inventory_audit_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="inventory_audit_logs",
    )
    action = models.CharField(max_length=40, choices=ACTION_CHOICES, db_index=True)
    entity_type = models.CharField(max_length=60, blank=True, default="")
    entity_id = models.CharField(max_length=64, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "inventory_audit_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "-created_at"], name="inv_audit_merchant_created_idx"),
        ]

    def __str__(self):
        return f"[{self.action}] {self.entity_type} {self.entity_id}"


# ─────────────────────────────────────────────────────────────────────────────
# Defaults
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_CATEGORIES = [
    "Produce",
    "Meat & Poultry",
    "Seafood",
    "Dairy & Eggs",
    "Dry Goods",
    "Spices & Seasonings",
    "Sauces & Condiments",
    "Oils & Fats",
    "Bakery",
    "Frozen",
    "Coffee & Tea",
    "Beverages",
    "Syrups & Mixers",
    "Prepared Items",
    "Packaging",
    "Disposables",
    "Cleaning Supplies",
    "Retail Items",
    "Other",
]

DEFAULT_LOCATIONS = [
    "Main Kitchen",
    "Bar",
    "Walk-in Fridge",
    "Freezer",
    "Dry Storage",
    "Front Counter",
    "Bakery",
    "Warehouse / Store Room",
]

DEFAULT_WASTE_REASONS = [
    "Spoiled",
    "Expired",
    "Dropped",
    "Damaged",
    "Over-prepared",
    "Kitchen mistake",
    "Customer return",
    "Staff meal",
    "Other",
]