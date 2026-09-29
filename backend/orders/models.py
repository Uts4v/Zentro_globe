# orders/models.py
import uuid

from django.db import models
from django.utils import timezone


class PreparationArea(models.Model):
    """
    A merchant-specific preparation area (Bar, Kitchen, Bakery, Main Counter, etc.).
    Only created when preparation_routing_enabled is True on the merchant.
    """
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="preparation_areas",
    )
    name = models.CharField(max_length=100)
    is_default = models.BooleanField(
        default=False,
        help_text="Fallback area for unassigned menu items",
    )
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)

    color = models.CharField(
        max_length=20, blank=True, default="",
        help_text="Optional display color (hex or name)",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "preparation_areas"
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "name"],
                name="unique_area_name_per_merchant",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class Order(models.Model):
    STATUS_PENDING   = "pending"
    STATUS_CONFIRMED = "confirmed"
    STATUS_PREPARING = "preparing"
    STATUS_READY     = "ready"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_PENDING,   "Pending"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_PREPARING, "Preparing"),
        (STATUS_READY,     "Ready"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    # Valid status transitions (source -> set of allowed targets)
    VALID_TRANSITIONS = {
        STATUS_PENDING:   {STATUS_CONFIRMED, STATUS_CANCELLED},
        STATUS_CONFIRMED: {STATUS_PREPARING, STATUS_CANCELLED, STATUS_READY, STATUS_COMPLETED},
        STATUS_PREPARING: {STATUS_READY, STATUS_CANCELLED},
        STATUS_READY:     {STATUS_COMPLETED, STATUS_CANCELLED},
        STATUS_COMPLETED: set(),
        STATUS_CANCELLED: set(),
    }

    ORDER_TYPE_REGULAR         = "regular"
    ORDER_TYPE_PUNCH_REDEMPTION = "punch_card_redemption"
    ORDER_TYPE_REWARD_REDEMPTION = "reward_redemption"
    ORDER_TYPE_STAFF_COMP       = "staff_comp"

    ORDER_TYPE_CHOICES = [
        (ORDER_TYPE_REGULAR,           "Regular"),
        (ORDER_TYPE_PUNCH_REDEMPTION,  "Punch Card Redemption"),
        (ORDER_TYPE_REWARD_REDEMPTION, "Reward Redemption"),
        (ORDER_TYPE_STAFF_COMP,        "Staff Free / Comp"),
    ]

    # Fulfillment type
    FULFILLMENT_DINE_IN  = "dine_in"
    FULFILLMENT_PICKUP   = "pickup"
    FULFILLMENT_DELIVERY = "delivery"

    FULFILLMENT_CHOICES = [
        (FULFILLMENT_DINE_IN,  "Dine In"),
        (FULFILLMENT_PICKUP,   "Pickup"),
        (FULFILLMENT_DELIVERY, "Delivery"),
    ]

    CANCEL_REASON_CUSTOMER_REQUEST = "customer_request"
    CANCEL_REASON_OUT_OF_STOCK     = "out_of_stock"
    CANCEL_REASON_STORE_CLOSING    = "store_closing"
    CANCEL_REASON_OTHER            = "other"

    CANCEL_REASON_CHOICES = [
        (CANCEL_REASON_CUSTOMER_REQUEST, "Customer Request"),
        (CANCEL_REASON_OUT_OF_STOCK,     "Out of Stock"),
        (CANCEL_REASON_STORE_CLOSING,    "Store Closing"),
        (CANCEL_REASON_OTHER,            "Other"),
    ]

    CANCELLED_BY_CUSTOMER = "customer"
    CANCELLED_BY_MERCHANT = "merchant"

    # Order source
    SOURCE_CUSTOMER_APP = "customer_app"
    SOURCE_TABLE_QR = "table_qr"
    SOURCE_MERCHANT_DASHBOARD = "merchant_dashboard"
    SOURCE_POS_ONLINE = "pos_online"
    SOURCE_POS_OFFLINE = "pos_offline"

    SOURCE_CHOICES = [
        (SOURCE_CUSTOMER_APP, "Customer App"),
        (SOURCE_TABLE_QR, "Table QR"),
        (SOURCE_MERCHANT_DASHBOARD, "Merchant Dashboard"),
        (SOURCE_POS_ONLINE, "POS Online"),
        (SOURCE_POS_OFFLINE, "POS Offline"),
    ]

    # UUID for client-facing identification (prevents local/server ID collisions)
    uuid = models.UUIDField(default=uuid.uuid4, db_index=True)

    # Nullable customer — walk-in POS orders have customer=null
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="orders",
        null=True, blank=True,
    )
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="orders",
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES,
        default=STATUS_PENDING, db_index=True,
    )
    order_type = models.CharField(
        max_length=30, choices=ORDER_TYPE_CHOICES,
        default=ORDER_TYPE_REGULAR,
        db_index=True,
    )
    source = models.CharField(
        max_length=30, choices=SOURCE_CHOICES,
        default=SOURCE_CUSTOMER_APP,
        db_index=True,
    )
    fulfillment_type = models.CharField(
        max_length=20, choices=FULFILLMENT_CHOICES,
        default=FULFILLMENT_PICKUP,
        db_index=True,
    )

    # Totals (server-calculated)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_type = models.CharField(
        max_length=20, blank=True, default="",
        help_text="fixed or percentage",
    )
    discount_value = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Discount amount or percentage value",
    )
    discount_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Calculated discount applied to subtotal",
    )
    tax_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
    )
    tax_breakdown = models.JSONField(
        default=list, blank=True,
        help_text=(
            "Per-component tax breakdown stored at creation time, e.g. "
            '[{"name":"CGST","rate":9.0,"amount":45.00},{"name":"SGST","rate":9.0,"amount":45.00}]'
        ),
    )
    service_charge = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
    )
    total_amount    = models.DecimalField(max_digits=10, decimal_places=2)
    points_earned   = models.IntegerField(default=0)
    loyalty_awarded = models.BooleanField(default=False)
    is_reward_order = models.BooleanField(default=False)
    notes           = models.TextField(blank=True)

    # Table association (only for dine-in orders)
    table = models.ForeignKey(
        "merchants.MerchantTable",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="orders",
    )
    table_name_snapshot = models.CharField(
        max_length=100, blank=True, default="",
        help_text="Preserved table name for historical reference",
    )
    table_number_snapshot = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Preserved table number for historical reference",
    )

    # Cancellation
    cancellation_reason = models.CharField(
        max_length=50, choices=CANCEL_REASON_CHOICES,
        blank=True, default="",
    )
    cancelled_by = models.CharField(max_length=20, blank=True, default="")

    # For punch card redemption orders — link back to the card
    punch_card_redemption = models.ForeignKey(
        "loyalty.CustomerPunchCard",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="redemption_orders",
    )

    # For reward redemption orders — link back to the redemption record,
    # mirrors punch_card_redemption above.
    reward_redemption = models.ForeignKey(
        "loyalty.Redemption",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="order",
    )

    # ── POS fields ─────────────────────────────────────────────────────────────
    processed_by_worker = models.ForeignKey(
        "pos.ShiftWorker",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="orders",
        help_text="POS worker who processed this order",
    )
    pos_device = models.ForeignKey(
        "pos.PosDevice",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="orders",
        help_text="POS device that created this order",
    )
    cash_shift = models.ForeignKey(
        "pos.CashShift",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="orders",
        help_text="Cash shift during which this order was created",
    )
    payment_status = models.CharField(
        max_length=20, default="unpaid",
        help_text="unpaid, paid, partially_paid, refunded",
        db_index=True,
    )
    payment_method = models.CharField(
        max_length=30, blank=True, default="",
        help_text="Primary payment method for this order",
    )
    kot_number = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Kitchen Order Ticket number (sequential per merchant)",
    )

    # ── Currency & tax snapshots (preserved at creation for historical integrity) ─
    currency_code_snapshot = models.CharField(
        max_length=3, blank=True, default="",
        help_text="Currency code at time of order (e.g. NPR, INR)",
    )
    currency_symbol_snapshot = models.CharField(
        max_length=5, blank=True, default="",
        help_text="Currency symbol at time of order (e.g. Rs, ₹)",
    )
    tax_type_snapshot = models.CharField(
        max_length=50, blank=True, default="",
        help_text="Tax type name at time of order (e.g. VAT, GST)",
    )
    tax_rate_snapshot = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Combined tax rate at time of order",
    )

    # ── Pricing engine snapshot (orders.pricing) ─────────────────────────────
    # Empty pricing_version = the order was priced before pricing v1.
    pricing_version = models.CharField(max_length=8, blank=True, default="")
    tax_policy_snapshot = models.CharField(
        max_length=20, blank=True, default="",
        help_text="Tax policy code applied (see orders.pricing.tax.POLICIES)",
    )
    prices_include_tax = models.BooleanField(default=False)
    tax_components_snapshot = models.JSONField(
        default=list, blank=True,
        help_text='Tax components applied, e.g. [{"name":"VAT","rate":"13"}]',
    )
    taxable_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    pricing_locked_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Set once the order is paid, completed, cancelled or refunded; pricing is frozen after.",
    )

    # ── Guest order fields ────────────────────────────────────────────────────
    guest_session_id = models.CharField(
        max_length=64, blank=True, default="",
        help_text="Client-generated UUID for guest session (for future guest→member conversion)",
    )
    guest_name_snapshot = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Guest name at time of order (preserved for historical reference)",
    )

    # Optimistic concurrency and sync
    version = models.PositiveIntegerField(
        default=1,
        help_text="Increments on every update for conflict detection",
    )
    client_mutation_id = models.UUIDField(
        null=True, blank=True, db_index=True,
        help_text="Idempotency key for offline sync",
    )
    client_created_at = models.DateTimeField(
        null=True, blank=True,
        help_text="Client-side timestamp for offline orders",
    )
    sync_origin = models.CharField(
        max_length=20, blank=True, default="",
        help_text="Origin of the order for sync tracking",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "orders"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "-created_at"], name="orders_merchant_created_idx"),
            models.Index(fields=["merchant", "status", "-created_at"], name="orders_merchant_status_idx"),
            models.Index(fields=["customer", "-created_at"], name="orders_customer_created_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "merchant", "client_mutation_id"],
                condition=~models.Q(client_mutation_id__isnull=True),
                name="uniq_customer_merchant_mutation",
            ),
        ]

    def __str__(self):
        customer_label = self.customer or "Walk-in"
        return f"Order #{self.id} [{self.status}] — {customer_label}"

    PRICING_LOCK_STATUSES = frozenset({"completed", "cancelled", "refunded"})
    PRICING_LOCK_PAYMENT_STATUSES = frozenset({"paid", "refunded"})

    def save(self, *args, **kwargs):
        # Money on a settled order is historical fact: freeze its pricing the
        # moment it is paid, completed, cancelled or refunded, whichever path
        # got it there.
        if self.pricing_locked_at is None and (
            self.status in self.PRICING_LOCK_STATUSES
            or self.payment_status in self.PRICING_LOCK_PAYMENT_STATUSES
        ):
            self.pricing_locked_at = timezone.now()
            update_fields = kwargs.get("update_fields")
            if update_fields is not None and "pricing_locked_at" not in update_fields:
                kwargs["update_fields"] = [*update_fields, "pricing_locked_at"]
        super().save(*args, **kwargs)

    def can_transition_to(self, new_status):
        """Check if a status transition is valid."""
        return new_status in self.VALID_TRANSITIONS.get(self.status, set())

    def transition_to(self, new_status):
        """
        Validate and perform a status transition.
        Raises ValueError if transition is invalid.
        """
        if not self.can_transition_to(new_status):
            raise ValueError(
                f"Cannot transition from '{self.status}' to '{new_status}'. "
                f"Allowed: {', '.join(self.VALID_TRANSITIONS.get(self.status, set())) or 'none'}"
            )
        self.status = new_status
        self.version += 1


class OrderItem(models.Model):
    PENDING = "pending"
    PREPARING = "preparing"
    READY = "ready"
    CANCELLED = "cancelled"

    PREPARATION_STATUS_CHOICES = [
        (PENDING, "Pending"),
        (PREPARING, "Preparing"),
        (READY, "Ready"),
        (CANCELLED, "Cancelled"),
    ]

    VALID_PREPARATION_TRANSITIONS = {
        PENDING: {PREPARING, CANCELLED},
        PREPARING: {READY, CANCELLED},
        READY: set(),
        CANCELLED: set(),
    }

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    menu_item = models.ForeignKey(
        "merchants.MenuItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    name = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.IntegerField(default=1)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    special_instructions = models.TextField(
        blank=True, default="",
        help_text="Per-line customer special requests (stored as an immutable snapshot).",
    )

    # ── Preparation routing (snapshot from menu item at order creation) ────────
    preparation_area = models.ForeignKey(
        PreparationArea,
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name="order_items",
    )
    requires_preparation = models.BooleanField(
        default=True,
        help_text="Snapshot: whether this item requires preparation",
    )
    preparation_status = models.CharField(
        max_length=20,
        choices=PREPARATION_STATUS_CHOICES,
        default=PENDING,
        db_index=True,
    )
    preparation_started_at = models.DateTimeField(null=True, blank=True)
    preparation_ready_at = models.DateTimeField(null=True, blank=True)

    # ── Preparation attribution (who did what, which KDS shift) ───────────────
    preparation_started_by = models.ForeignKey(
        "pos.ShiftWorker",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="started_preparation_items",
    )
    preparation_ready_by = models.ForeignKey(
        "pos.ShiftWorker",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="ready_preparation_items",
    )
    preparation_staff_shift = models.ForeignKey(
        "pos.StaffShift",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="prepared_items",
    )

    # ── Pricing snapshot (orders.pricing). `price` is the effective unit
    # selling price; these record how the line was charged. ─────────────────
    list_unit_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Unit price before Today's Special; null on pre-v1 lines.",
    )
    tax_class = models.CharField(max_length=12, default="standard")
    discount_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Order-level discounts allocated to this line.",
    )
    taxable_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="What the customer paid for this line (0 on pre-v1 lines).",
    )
    refunded_quantity = models.PositiveIntegerField(default=0)
    refunded_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_promotion_reward = models.BooleanField(
        default=False,
        help_text="Added as an offer's free/reward item (still a real, priced line).",
    )

    class Meta:
        db_table = "order_items"
        indexes = [
            models.Index(fields=["preparation_area", "preparation_status"]),
            models.Index(fields=["order", "requires_preparation"]),
        ]

    def __str__(self):
        return f"{self.quantity}× {self.name}"

    def can_transition_preparation_to(self, new_status):
        return new_status in self.VALID_PREPARATION_TRANSITIONS.get(
            self.preparation_status, set()
        )


class OrderItemOption(models.Model):
    """
    Immutable snapshot of a selected variant/modifier on an order line.

    Kept structured (not a free-text blob) so POS, KDS, receipts, and
    analytics can query exact selections after the menu item is renamed or
    deleted (D-4, single-source-of-truth, section 108).
    """

    order_item = models.ForeignKey(
        OrderItem,
        on_delete=models.CASCADE,
        related_name="options",
    )
    group_name = models.CharField(max_length=255)
    option_name = models.CharField(max_length=255)
    kind = models.CharField(max_length=20, default="modifier")
    price_effect = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Absolute variant price or modifier price_delta applied to this line.",
    )
    option_id = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="MenuOption id at order time (for variant-targeted offers); null on older rows.",
    )
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "order_item_options"
        ordering = ["display_order", "id"]

    def __str__(self):
        return f"{self.option_name} ({self.group_name})"


class OrderAdjustment(models.Model):
    """
    An order-level discount or reward (POS manual discount, loyalty reward,
    punch reward, future promotion). Stores the *definition*, so pricing can
    re-evaluate it whenever the order changes; ``amount`` is the latest result.
    """

    STATUS_ACTIVE = "active"
    STATUS_REMOVED = "removed"
    STATUS_CHOICES = [(STATUS_ACTIVE, "Active"), (STATUS_REMOVED, "Removed")]

    KIND_CHOICES = [
        ("manual_discount", "Manual discount"),
        ("loyalty_reward", "Loyalty reward"),
        ("punch_reward", "Punch-card reward"),
        ("promotion", "Promotion"),
    ]
    CALC_CHOICES = [("percentage", "Percentage"), ("fixed", "Fixed amount")]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="adjustments")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    calc_type = models.CharField(max_length=12, choices=CALC_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    label = models.CharField(max_length=120, blank=True, default="")
    max_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    min_subtotal = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    eligible_item_ids = models.JSONField(
        null=True, blank=True,
        help_text="OrderItem ids the adjustment applies to; null = whole order.",
    )
    source_ref = models.CharField(
        max_length=64, blank=True, default="",
        help_text='Where it came from, e.g. "pos_discount:12".',
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    eligible = models.BooleanField(default=True)
    reason = models.JSONField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    removed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "order_adjustments"
        ordering = ["id"]
        constraints = [
            # V1 business rule: one financial discount/reward per order. Drop
            # this (and raise pricing.MAX_ORDER_ADJUSTMENTS) to allow stacking.
            models.UniqueConstraint(
                fields=["order"],
                condition=models.Q(status="active"),
                name="one_active_order_adjustment_v1",
            ),
        ]

    def __str__(self):
        return f"{self.kind} {self.calc_type} {self.value} on order #{self.order_id}"


class OrderAdjustmentAllocation(models.Model):
    """How much of an adjustment landed on each line (sums to its amount)."""

    adjustment = models.ForeignKey(OrderAdjustment, on_delete=models.CASCADE, related_name="allocations")
    order_item = models.ForeignKey(OrderItem, on_delete=models.CASCADE, related_name="adjustment_allocations")
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = "order_adjustment_allocations"
        constraints = [
            models.UniqueConstraint(fields=["adjustment", "order_item"], name="uniq_adjustment_line"),
        ]


class OrderCharge(models.Model):
    """A non-product charge on an order (service, delivery, packaging, other)."""

    KIND_CHOICES = [
        ("service", "Service charge"),
        ("delivery", "Delivery fee"),
        ("packaging", "Packaging fee"),
        ("other", "Other"),
    ]

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="charges")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    label = models.CharField(max_length=80)
    calc_type = models.CharField(max_length=12, choices=OrderAdjustment.CALC_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    taxable = models.BooleanField(default=False)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "order_charges"
        ordering = ["id"]

    def __str__(self):
        return f"{self.label} {self.amount} on order #{self.order_id}"
