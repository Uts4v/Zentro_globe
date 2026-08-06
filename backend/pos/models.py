import uuid
import secrets
import hashlib

from django.db import models
from django.conf import settings
from django.utils import timezone


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _generate_device_token() -> str:
    return f"POS-{secrets.token_urlsafe(32)}"


def _generate_worker_pin_hash(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


# ── POS Device ─────────────────────────────────────────────────────────────────

class PosDevice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="pos_devices",
    )
    name = models.CharField(
        max_length=120,
        help_text="Human-readable device name, e.g. 'Front Counter Terminal'",
    )
    device_token_hash = models.CharField(
        max_length=255,
        help_text="SHA-256 hash of the device registration token",
    )
    platform = models.CharField(
        max_length=100, blank=True, default="",
        help_text="Device platform, e.g. 'ios', 'android', 'windows'",
    )
    user_agent = models.TextField(blank=True, default="")
    last_seen_at = models.DateTimeField(null=True, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pos_devices"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"

    @classmethod
    def register(cls, merchant, name, platform="", user_agent=""):
        token = _generate_device_token()
        device = cls.objects.create(
            merchant=merchant,
            name=name,
            device_token_hash=_hash_token(token),
            platform=platform,
            user_agent=user_agent,
            last_seen_at=timezone.now(),
        )
        return device, token

    def verify_token(self, token: str) -> bool:
        return self.device_token_hash == _hash_token(token)

    def deactivate(self):
        self.is_active = False
        self.save(update_fields=["is_active", "updated_at"])


# ── Shift Worker ───────────────────────────────────────────────────────────────

class ShiftWorker(models.Model):
    ROLE_CASHIER = "cashier"
    ROLE_WAITER = "waiter"
    ROLE_MANAGER = "manager"
    ROLE_ADMIN = "admin"

    ROLE_CHOICES = [
        (ROLE_CASHIER, "Cashier"),
        (ROLE_WAITER, "Waiter"),
        (ROLE_MANAGER, "Manager"),
        (ROLE_ADMIN, "Admin"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="shift_workers",
    )
    display_name = models.CharField(max_length=120)
    pin_hash = models.CharField(
        max_length=255,
        help_text="SHA-256 hash of the worker PIN",
    )
    role = models.CharField(
        max_length=50, choices=ROLE_CHOICES, default=ROLE_CASHIER,
    )
    is_active = models.BooleanField(default=True)
    can_apply_discount = models.BooleanField(default=False)
    can_process_refund = models.BooleanField(default=False)
    can_close_shift = models.BooleanField(default=False)
    can_view_reports = models.BooleanField(default=False)
    failed_pin_attempts = models.PositiveIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pos_workers"
        ordering = ["display_name"]

    def __str__(self):
        return f"{self.display_name} ({self.role})"

    def set_pin(self, pin: str):
        self.pin_hash = _hash_token(pin)

    def verify_pin(self, pin: str) -> bool:
        if self.locked_until and self.locked_until > timezone.now():
            return False
        if self.pin_hash == _hash_token(pin):
            self.failed_pin_attempts = 0
            self.locked_until = None
            self.save(update_fields=["failed_pin_attempts", "locked_until", "updated_at"])
            return True
        self.failed_pin_attempts += 1
        if self.failed_pin_attempts >= 5:
            self.locked_until = timezone.now() + timezone.timedelta(minutes=15)
        self.save(update_fields=["failed_pin_attempts", "locked_until", "updated_at"])
        return False


# ── Cash Shift ─────────────────────────────────────────────────────────────────

class CashShift(models.Model):
    STATUS_OPEN = "open"
    STATUS_CLOSED = "closed"
    STATUS_CONFLICT = "conflict"

    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_CLOSED, "Closed"),
        (STATUS_CONFLICT, "Conflict"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="cash_shifts",
    )
    device = models.ForeignKey(
        PosDevice,
        on_delete=models.CASCADE,
        related_name="cash_shifts",
    )
    opened_by = models.ForeignKey(
        ShiftWorker,
        on_delete=models.CASCADE,
        related_name="opened_shifts",
    )
    closed_by = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="closed_shifts",
    )
    opening_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closing_cash = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    cash_difference = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cash_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_card_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_other_sales = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_orders = models.PositiveIntegerField(default=0)
    cash_payouts = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Total cash removed from drawer during this shift (pay-outs)",
    )
    cash_payins = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Total cash added to drawer during this shift (pay-ins)",
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES,
        default=STATUS_OPEN, db_index=True,
    )
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    client_created_at = models.DateTimeField(null=True, blank=True)
    sync_status = models.CharField(
        max_length=20, default="synced",
        help_text="synced, pending, syncing, failed, conflict",
    )
    version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "pos_shifts"
        ordering = ["-opened_at"]

    def __str__(self):
        return f"Shift {self.id} — {self.merchant.business_name} ({self.status})"


# ── POS Order (extends orders.Order via fields) ────────────────────────────────
# We add POS-specific fields directly to the Order model in orders/models.py
# This model tracks POS-specific metadata that doesn't belong on the core Order.


# ── PosPayment ─────────────────────────────────────────────────────────────────

class PosPayment(models.Model):
    METHOD_CASH = "cash"
    METHOD_CARD = "card"
    METHOD_BANK_QR = "bank_qr"
    METHOD_MOBILE_WALLET = "mobile_wallet"
    METHOD_CREDIT = "credit"
    METHOD_DEBIT = "debit"
    METHOD_SPLIT = "split"
    METHOD_OTHER = "other"

    METHOD_CHOICES = [
        (METHOD_CASH, "Cash"),
        (METHOD_CARD, "Card"),
        (METHOD_BANK_QR, "Bank QR"),
        (METHOD_MOBILE_WALLET, "Mobile Wallet"),
        (METHOD_CREDIT, "Credit"),
        (METHOD_DEBIT, "Debit"),
        (METHOD_SPLIT, "Split"),
        (METHOD_OTHER, "Other"),
    ]

    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_REFUNDED = "refunded"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
        (STATUS_REFUNDED, "Refunded"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="pos_payments",
    )
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.CASCADE,
        related_name="pos_payments",
    )
    shift = models.ForeignKey(
        CashShift,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="payments",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="payments",
    )
    device = models.ForeignKey(
        PosDevice,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="payments",
    )
    payment_method = models.CharField(
        max_length=30, choices=METHOD_CHOICES,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES,
        default=STATUS_PENDING, db_index=True,
    )
    external_reference = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Gateway or provider reference for digital payments",
    )
    change_amount = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Cash change given back to customer",
    )
    client_mutation_id = models.UUIDField(
        unique=True,
        help_text="Idempotency key for offline sync",
    )
    client_created_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    sync_status = models.CharField(
        max_length=20, default="synced",
        help_text="synced, pending, syncing, failed, conflict",
    )

    class Meta:
        db_table = "pos_payments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Payment {self.id} — {self.payment_method} {self.amount}"


# ── PosDiscount ────────────────────────────────────────────────────────────────

class PosDiscount(models.Model):
    TYPE_FIXED = "fixed"
    TYPE_PERCENTAGE = "percentage"

    TYPE_CHOICES = [
        (TYPE_FIXED, "Fixed Amount"),
        (TYPE_PERCENTAGE, "Percentage"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="pos_discounts",
    )
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.CASCADE,
        related_name="pos_discounts",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="discounts_applied",
    )
    discount_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    discount_value = models.DecimalField(
        max_digits=10, decimal_places=2,
        help_text="Fixed amount or percentage value",
    )
    discount_amount = models.DecimalField(
        max_digits=10, decimal_places=2,
        help_text="Calculated discount amount applied to the order",
    )
    reason = models.CharField(max_length=255, blank=True, default="")
    authorized_by = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="discounts_authorized",
        help_text="Manager who authorized this discount (if required)",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pos_discounts"

    def __str__(self):
        return f"Discount {self.discount_type} {self.discount_value} on Order {self.order_id}"


# ── Pos Audit Log ──────────────────────────────────────────────────────────────

class PosAuditLog(models.Model):
    ACTION_DEVICE_REGISTER = "device_register"
    ACTION_DEVICE_DEACTIVATE = "device_deactivate"
    ACTION_WORKER_LOGIN = "worker_login"
    ACTION_WORKER_LOGOUT = "worker_logout"
    ACTION_WORKER_CREATE = "worker_create"
    ACTION_WORKER_UPDATE = "worker_update"
    ACTION_SHIFT_OPEN = "shift_open"
    ACTION_SHIFT_CLOSE = "shift_close"
    ACTION_STAFF_SHIFT_OPEN = "staff_shift_open"
    ACTION_STAFF_SHIFT_CLOSE = "staff_shift_close"
    ACTION_ORDER_CREATE = "order_create"
    ACTION_ORDER_UPDATE = "order_update"
    ACTION_ORDER_CANCEL = "order_cancel"
    ACTION_DISCOUNT_APPLY = "discount_apply"
    ACTION_PAYMENT = "payment"
    ACTION_REFUND = "refund"
    ACTION_CREDIT_SALE = "credit_sale"
    ACTION_CREDIT_REPAY = "credit_repay"
    ACTION_DEBIT_TOPUP = "debit_topup"
    ACTION_DEBIT_PURCHASE = "debit_purchase"
    ACTION_DEBIT_ADJUSTMENT = "debit_adjustment"
    ACTION_SYNC_ATTEMPT = "sync_attempt"
    ACTION_SYNC_CONFLICT = "sync_conflict"
    ACTION_SYNC_RESOLVE = "sync_resolve"
    ACTION_REPORT_GENERATE = "report_generate"
    ACTION_MERCHANT_LOGIN = "merchant_login"

    ACTION_CHOICES = [
        (ACTION_DEVICE_REGISTER, "Device Register"),
        (ACTION_DEVICE_DEACTIVATE, "Device Deactivate"),
        (ACTION_WORKER_LOGIN, "Worker Login"),
        (ACTION_WORKER_LOGOUT, "Worker Logout"),
        (ACTION_WORKER_CREATE, "Worker Create"),
        (ACTION_WORKER_UPDATE, "Worker Update"),
        (ACTION_SHIFT_OPEN, "Shift Open"),
        (ACTION_SHIFT_CLOSE, "Shift Close"),
        (ACTION_STAFF_SHIFT_OPEN, "Staff Shift Open"),
        (ACTION_STAFF_SHIFT_CLOSE, "Staff Shift Close"),
        (ACTION_ORDER_CREATE, "Order Create"),
        (ACTION_ORDER_UPDATE, "Order Update"),
        (ACTION_ORDER_CANCEL, "Order Cancel"),
        (ACTION_DISCOUNT_APPLY, "Discount Apply"),
        (ACTION_PAYMENT, "Payment"),
        (ACTION_REFUND, "Refund"),
        (ACTION_CREDIT_SALE, "Credit Sale"),
        (ACTION_CREDIT_REPAY, "Credit Repay"),
        (ACTION_DEBIT_TOPUP, "Debit Top-up"),
        (ACTION_DEBIT_PURCHASE, "Debit Purchase"),
        (ACTION_DEBIT_ADJUSTMENT, "Debit Adjustment"),
        (ACTION_SYNC_ATTEMPT, "Sync Attempt"),
        (ACTION_SYNC_CONFLICT, "Sync Conflict"),
        (ACTION_SYNC_RESOLVE, "Sync Resolve"),
        (ACTION_REPORT_GENERATE, "Report Generate"),
        (ACTION_MERCHANT_LOGIN, "Merchant Login"),
    ]

    id = models.BigAutoField(primary_key=True)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="pos_audit_logs",
    )
    device = models.ForeignKey(
        PosDevice,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="audit_logs",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="audit_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="pos_audit_logs",
    )
    action = models.CharField(
        max_length=50, choices=ACTION_CHOICES,
        db_index=True,
    )
    entity_type = models.CharField(max_length=50, blank=True, default="")
    entity_id = models.CharField(max_length=255, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "pos_audit_logs"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.action}] {self.entity_type} {self.entity_id} @ {self.created_at}"


# ── Processed Client Mutation (Idempotency) ────────────────────────────────────

class ProcessedClientMutation(models.Model):
    id = models.BigAutoField(primary_key=True)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="processed_mutations",
    )
    device = models.ForeignKey(
        PosDevice,
        on_delete=models.CASCADE,
        related_name="processed_mutations",
    )
    client_mutation_id = models.UUIDField()
    entity_type = models.CharField(max_length=50)
    operation = models.CharField(max_length=50)
    server_object_id = models.UUIDField(null=True, blank=True)
    response_data = models.JSONField(default=dict, blank=True)
    processed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pos_processed_mutations"
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "device", "client_mutation_id"],
                name="unique_pos_client_mutation",
            ),
        ]

    def __str__(self):
        return f"Mutation {self.client_mutation_id} ({self.entity_type}/{self.operation})"


# ── Credit Account ─────────────────────────────────────────────────────────────

class CreditAccount(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="credit_accounts",
    )
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="credit_accounts",
        null=True, blank=True,
        help_text="Null for walk-in credit accounts identified by name/phone",
    )
    contact_name = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Name for walk-in credit customers without a customer profile",
    )
    contact_phone = models.CharField(
        max_length=20, blank=True, default="",
    )
    credit_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    current_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pos_credit_accounts"

    def __str__(self):
        label = self.customer or self.contact_name or "Unknown"
        return f"Credit — {label} ({self.merchant.business_name})"

    @property
    def available_credit(self):
        return self.credit_limit - self.current_balance


# ── Credit Transaction ─────────────────────────────────────────────────────────

class CreditTransaction(models.Model):
    TYPE_SALE = "sale"
    TYPE_REPAYMENT = "repayment"
    TYPE_ADJUSTMENT = "adjustment"

    TYPE_CHOICES = [
        (TYPE_SALE, "Sale"),
        (TYPE_REPAYMENT, "Repayment"),
        (TYPE_ADJUSTMENT, "Adjustment"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        CreditAccount,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="credit_transactions",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="credit_transactions",
    )
    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=255, blank=True, default="")
    client_mutation_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sync_status = models.CharField(max_length=20, default="synced")

    class Meta:
        db_table = "pos_credit_transactions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} {self.amount} — {self.account}"


# ═════════════════════════════════════════════════════════════════════════════════
# DEBIT ACCOUNTS (Prepaid / Stored Value / Wallet)
# ═════════════════════════════════════════════════════════════════════════════════

class DebitAccount(models.Model):
    """
    Prepaid wallet: customer tops up, then pays POS orders from balance.
    Opposite of credit — customer loads money first, then spends.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="debit_accounts",
    )
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        help_text="Null for walk-in debit accounts identified by name/phone",
    )
    contact_name = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Name for walk-in debit customers without a customer profile",
    )
    contact_phone = models.CharField(max_length=20, blank=True, default="")
    balance = models.DecimalField(
        max_digits=12, decimal_places=2, default=0,
        help_text="Current stored value available to spend",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pos_debit_accounts"

    def __str__(self):
        label = self.customer or self.contact_name or "Unknown"
        return f"Debit — {label} ({self.merchant.business_name})"


class DebitTransaction(models.Model):
    TYPE_TOPUP = "topup"
    TYPE_PURCHASE = "purchase"
    TYPE_REFUND = "refund"
    TYPE_ADJUSTMENT = "adjustment"

    TYPE_CHOICES = [
        (TYPE_TOPUP, "Top-up"),
        (TYPE_PURCHASE, "Purchase"),
        (TYPE_REFUND, "Refund"),
        (TYPE_ADJUSTMENT, "Adjustment"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        DebitAccount,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="debit_transactions",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="debit_transactions",
    )
    transaction_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    balance_before = models.DecimalField(max_digits=12, decimal_places=2)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=255, blank=True, default="")
    client_mutation_id = models.UUIDField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sync_status = models.CharField(max_length=20, default="synced")

    class Meta:
        db_table = "pos_debit_transactions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} {self.amount} — {self.account}"


# ═════════════════════════════════════════════════════════════════════════════════
# CASH MOVEMENTS (Pay-ins, Pay-outs, Cash Drops)
# ═════════════════════════════════════════════════════════════════════════════════

class PosCashMovement(models.Model):
    TYPE_PAYOUT = "payout"
    TYPE_PAYIN = "payin"
    TYPE_CASHDROP = "cashdrop"

    TYPE_CHOICES = [
        (TYPE_PAYOUT, "Pay-out (Cash removed)"),
        (TYPE_PAYIN, "Pay-in (Cash added)"),
        (TYPE_CASHDROP, "Cash Drop (Bank deposit)"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shift = models.ForeignKey(
        CashShift,
        on_delete=models.CASCADE,
        related_name="cash_movements",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="cash_movements",
    )
    movement_type = models.CharField(
        max_length=20, choices=TYPE_CHOICES,
        db_index=True,
    )
    amount = models.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Always positive. Type determines direction.",
    )
    reason = models.CharField(
        max_length=255, blank=True, default="",
        help_text="Reason for the cash movement",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pos_cash_movements"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.movement_type} Rs {self.amount} — Shift {self.shift_id}"


# ═════════════════════════════════════════════════════════════════════════════════
# STAFF SCHEDULING (Phase 31+)
# ═════════════════════════════════════════════════════════════════════════════════

class StaffSchedule(models.Model):
    STATUS_SCHEDULED = "scheduled"
    STATUS_CONFIRMED = "confirmed"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    id = models.BigAutoField(primary_key=True)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="staff_schedules",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.CASCADE,
        related_name="schedules",
    )
    shift_date = models.DateField()
    start_time = models.TimeField()
    end_time = models.TimeField()
    role = models.CharField(
        max_length=50, default="cashier",
        help_text="Role for this shift (cashier, waiter, manager, etc.)",
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES,
        default=STATUS_SCHEDULED, db_index=True,
    )
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pos_staff_schedules"
        ordering = ["shift_date", "start_time"]

    def __str__(self):
        return f"{self.worker.display_name} — {self.shift_date} {self.start_time}-{self.end_time}"


# ═════════════════════════════════════════════════════════════════════════════════
# STAFF PREPARATION AREA ASSIGNMENTS
# ═════════════════════════════════════════════════════════════════════════════════

class StaffPreparationArea(models.Model):
    """
    Maps a POS worker to one or more preparation areas.
    A Barista may be assigned to Bar only; a Supervisor to Bar + Kitchen.
    """
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.CASCADE,
        related_name="preparation_area_assignments",
    )
    preparation_area = models.ForeignKey(
        "orders.PreparationArea",
        on_delete=models.CASCADE,
        related_name="staff_assignments",
    )

    class Meta:
        db_table = "staff_preparation_areas"
        constraints = [
            models.UniqueConstraint(
                fields=["worker", "preparation_area"],
                name="unique_worker_preparation_area",
            ),
        ]

    def __str__(self):
        return f"{self.worker.display_name} → {self.preparation_area.name}"


# ═════════════════════════════════════════════════════════════════════════════════
# STAFF SHIFTS (KDS clock-in/out)
# ═════════════════════════════════════════════════════════════════════════════════

class StaffShift(models.Model):
    """
    A per-staff clock-in/out shift for the preparation screens (KDS).

    Completely separate from CashShift (the cash-drawer shift). Kitchen and
    Bar staff open StaffShifts so multiple workers can be on duty at the same
    time — Ramesh on Bar, Sita on Kitchen, etc. — without touching cash
    accounting. Managers/admins may open a shift covering several areas.
    """
    STATUS_ACTIVE = "active"
    STATUS_CLOSED = "closed"

    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_CLOSED, "Closed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="staff_shifts",
    )
    worker = models.ForeignKey(
        ShiftWorker,
        on_delete=models.PROTECT,
        related_name="staff_shifts",
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES,
        default=STATUS_ACTIVE, db_index=True,
    )
    opened_at = models.DateTimeField(default=timezone.now)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        ShiftWorker,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="closed_staff_shifts",
    )
    opened_from_device_id = models.CharField(
        max_length=100, blank=True, default="",
        help_text="POS device that started this shift",
    )

    class Meta:
        db_table = "pos_staff_shifts"
        ordering = ["-opened_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["worker", "status"],
                condition=models.Q(status="active"),
                name="unique_active_staff_shift_per_worker",
            ),
        ]

    def __str__(self):
        return f"{self.worker.display_name} — {self.status}"

    def area_ids(self):
        return list(
            self.area_assignments.values_list("preparation_area_id", flat=True)
        )


class StaffShiftArea(models.Model):
    """
    A preparation area covered by a staff shift.

    Normal staff usually have one area (Ramesh → Bar). Supervisors and
    managers may have several (Maya → Bar + Kitchen). Managers/admins get
    all-area access through permissions rather than an assignment per area.
    """
    shift = models.ForeignKey(
        StaffShift,
        on_delete=models.CASCADE,
        related_name="area_assignments",
    )
    preparation_area = models.ForeignKey(
        "orders.PreparationArea",
        on_delete=models.PROTECT,
        related_name="active_shift_assignments",
    )

    class Meta:
        db_table = "pos_staff_shift_areas"
        constraints = [
            models.UniqueConstraint(
                fields=["shift", "preparation_area"],
                name="unique_staff_shift_area",
            ),
        ]

    def __str__(self):
        return f"{self.shift.worker.display_name} → {self.preparation_area.name}"
