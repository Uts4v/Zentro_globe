from rest_framework import serializers
from .models import (
    PosDevice, ShiftWorker, CashShift, PosPayment,
    PosDiscount, PosAuditLog, CreditAccount, CreditTransaction,
    DebitAccount, DebitTransaction, PosCashMovement,
    StaffShift, StaffShiftArea,
)


# ── Device ─────────────────────────────────────────────────────────────────────

class PosDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PosDevice
        fields = [
            "id", "name", "platform", "user_agent",
            "last_seen_at", "last_sync_at", "is_active",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "last_seen_at", "last_sync_at",
            "created_at", "updated_at",
        ]


class RegisterDeviceSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    platform = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    user_agent = serializers.CharField(required=False, allow_blank=True, default="")


# ── Worker ─────────────────────────────────────────────────────────────────────

class ShiftWorkerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShiftWorker
        fields = [
            "id", "display_name", "role", "is_active",
            "can_apply_discount", "can_process_refund",
            "can_close_shift", "can_view_reports",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
        extra_kwargs = {
            "pin_hash": {"write_only": True},
        }


class CreateWorkerSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=120)
    pin = serializers.CharField(min_length=4, max_length=8)
    role = serializers.ChoiceField(
        choices=ShiftWorker.ROLE_CHOICES,
        default=ShiftWorker.ROLE_CASHIER,
    )
    can_apply_discount = serializers.BooleanField(default=False)
    can_process_refund = serializers.BooleanField(default=False)
    can_close_shift = serializers.BooleanField(default=False)
    can_view_reports = serializers.BooleanField(default=False)


class UpdateWorkerSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=120, required=False)
    pin = serializers.CharField(min_length=4, max_length=8, required=False)
    role = serializers.ChoiceField(choices=ShiftWorker.ROLE_CHOICES, required=False)
    is_active = serializers.BooleanField(required=False)
    can_apply_discount = serializers.BooleanField(required=False)
    can_process_refund = serializers.BooleanField(required=False)
    can_close_shift = serializers.BooleanField(required=False)
    can_view_reports = serializers.BooleanField(required=False)


class WorkerLoginSerializer(serializers.Serializer):
    worker_id = serializers.UUIDField()
    pin = serializers.CharField(min_length=4, max_length=8)


# ── Shift ──────────────────────────────────────────────────────────────────────

class CashShiftSerializer(serializers.ModelSerializer):
    opened_by_name = serializers.CharField(
        source="opened_by.display_name", read_only=True
    )
    closed_by_name = serializers.CharField(
        source="closed_by.display_name", read_only=True, default=None
    )

    class Meta:
        model = CashShift
        fields = [
            "id", "device", "opened_by", "opened_by_name",
            "closed_by", "closed_by_name",
            "opening_cash", "expected_cash", "closing_cash", "cash_difference",
            "total_sales", "total_cash_sales", "total_card_sales",
            "total_other_sales", "total_orders",
            "cash_payouts", "cash_payins",
            "status", "opened_at", "closed_at",
            "sync_status", "version",
        ]
        read_only_fields = [
            "id", "expected_cash", "total_sales", "total_cash_sales",
            "total_card_sales", "total_other_sales", "total_orders",
            "cash_difference", "closed_at", "version",
        ]


class OpenShiftSerializer(serializers.Serializer):
    device_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    opening_cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    client_created_at = serializers.DateTimeField(required=False)


class CloseShiftSerializer(serializers.Serializer):
    closing_cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    worker_id = serializers.UUIDField()


# ── Staff Shift (KDS clock-in/out) ────────────────────────────────────────────

class StaffShiftAreaSerializer(serializers.ModelSerializer):
    area_name = serializers.CharField(
        source="preparation_area.name", read_only=True
    )

    class Meta:
        model = StaffShiftArea
        fields = ["preparation_area_id", "area_name"]


class StaffShiftSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(
        source="worker.display_name", read_only=True
    )
    worker_role = serializers.CharField(source="worker.role", read_only=True)
    areas = StaffShiftAreaSerializer(source="area_assignments", many=True, read_only=True)
    area_ids = serializers.ListField(
        child=serializers.IntegerField(), read_only=True
    )

    class Meta:
        model = StaffShift
        fields = [
            "id", "worker", "worker_name", "worker_role",
            "status", "areas", "area_ids",
            "opened_at", "closed_at", "closed_by", "opened_from_device_id",
        ]
        read_only_fields = [
            "id", "worker", "status", "opened_at", "closed_at",
            "closed_by", "opened_from_device_id",
        ]


class OpenStaffShiftSerializer(serializers.Serializer):
    worker_id = serializers.UUIDField()
    area_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    device_id = serializers.UUIDField(required=False, allow_null=True)


class CloseStaffShiftSerializer(serializers.Serializer):
    shift_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()


# ── Payment ────────────────────────────────────────────────────────────────────

class PosPaymentSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(
        source="worker.display_name", read_only=True, default=None
    )

    class Meta:
        model = PosPayment
        fields = [
            "id", "order", "shift", "worker", "worker_name",
            "device", "payment_method", "amount", "status",
            "external_reference", "change_amount",
            "client_mutation_id", "client_created_at",
            "created_at", "sync_status",
        ]
        read_only_fields = ["id", "created_at"]


class CreatePaymentSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    shift_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    payment_method = serializers.ChoiceField(choices=PosPayment.METHOD_CHOICES)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    external_reference = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )
    change_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False, default=0
    )
    debit_account_id = serializers.UUIDField(required=False, allow_null=True)
    client_mutation_id = serializers.UUIDField()
    client_created_at = serializers.DateTimeField(required=False)


class SplitPaymentItemSerializer(serializers.Serializer):
    payment_method = serializers.ChoiceField(choices=PosPayment.METHOD_CHOICES)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    external_reference = serializers.CharField(
        max_length=255, required=False, allow_blank=True, default=""
    )


class CreateSplitPaymentSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    shift_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    payments = SplitPaymentItemSerializer(many=True, min_length=2)
    change_amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0, required=False, default=0
    )
    client_created_at = serializers.DateTimeField(required=False)


# ── Discount ───────────────────────────────────────────────────────────────────

class PosDiscountSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(
        source="worker.display_name", read_only=True, default=None
    )
    authorized_by_name = serializers.CharField(
        source="authorized_by.display_name", read_only=True, default=None
    )

    class Meta:
        model = PosDiscount
        fields = [
            "id", "order", "worker", "worker_name",
            "discount_type", "discount_value", "discount_amount",
            "reason", "authorized_by", "authorized_by_name",
            "created_at",
        ]
        read_only_fields = ["id", "discount_amount", "created_at"]


class ApplyDiscountSerializer(serializers.Serializer):
    order_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    discount_type = serializers.ChoiceField(choices=PosDiscount.TYPE_CHOICES)
    discount_value = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    authorized_by_worker_id = serializers.UUIDField(required=False, allow_null=True)


# ── Audit Log ──────────────────────────────────────────────────────────────────

class PosAuditLogSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(
        source="worker.display_name", read_only=True, default=None
    )

    class Meta:
        model = PosAuditLog
        fields = [
            "id", "action", "entity_type", "entity_id",
            "worker", "worker_name", "metadata", "created_at",
        ]
        read_only_fields = fields


# ── Credit ─────────────────────────────────────────────────────────────────────

class CreditAccountSerializer(serializers.ModelSerializer):
    available_credit = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = CreditAccount
        fields = [
            "id", "customer", "contact_name", "contact_phone",
            "credit_limit", "current_balance", "available_credit",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "current_balance", "created_at", "updated_at"]


class CreditSaleSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    order_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    shift_id = serializers.UUIDField(required=False, allow_null=True)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    client_mutation_id = serializers.UUIDField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class CreditRepaymentSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    client_mutation_id = serializers.UUIDField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class CreditTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditTransaction
        fields = [
            "id", "account", "order", "worker",
            "transaction_type", "amount",
            "balance_before", "balance_after",
            "note", "created_at", "sync_status",
        ]
        read_only_fields = fields


# ── Debit (Prepaid / Wallet) ──────────────────────────────────────────────────

class DebitAccountSerializer(serializers.ModelSerializer):
    initial_balance = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=0,
        required=False, write_only=True, default=0,
    )

    class Meta:
        model = DebitAccount
        fields = [
            "id", "customer", "contact_name", "contact_phone",
            "balance", "is_active", "created_at", "updated_at",
            "initial_balance",
        ]
        read_only_fields = ["id", "balance", "created_at", "updated_at"]


class DebitTopupSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0.01)
    client_mutation_id = serializers.UUIDField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class DebitPurchaseSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    order_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    device_id = serializers.UUIDField()
    shift_id = serializers.UUIDField(required=False, allow_null=True)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0.01)
    client_mutation_id = serializers.UUIDField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class DebitAdjustmentSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2,
        help_text="Positive = credit, negative = debit",
    )
    client_mutation_id = serializers.UUIDField()
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class DebitTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DebitTransaction
        fields = [
            "id", "account", "order", "worker",
            "transaction_type", "amount",
            "balance_before", "balance_after",
            "note", "created_at", "sync_status",
        ]
        read_only_fields = fields


# ── POS Login ──────────────────────────────────────────────────────────────────

class PosLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class PosDeviceRegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    platform = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    user_agent = serializers.CharField(required=False, allow_blank=True, default="")
    device_token = serializers.CharField(
        required=False, allow_blank=True, default="",
        help_text="Existing device token for re-authorization",
    )


# ── POS Bootstrap ──────────────────────────────────────────────────────────────

class PosBootstrapSerializer(serializers.Serializer):
    device_id = serializers.UUIDField()


# ── POS Settings ───────────────────────────────────────────────────────────────

class PosSettingsSerializer(serializers.Serializer):
    pos_enabled = serializers.BooleanField()
    offline_pos_enabled = serializers.BooleanField()
    credit_accounts_enabled = serializers.BooleanField()
    debit_accounts_enabled = serializers.BooleanField()
    discounts_enabled = serializers.BooleanField()
    shift_management_enabled = serializers.BooleanField()
    receipt_printing_enabled = serializers.BooleanField()
    max_worker_discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2)
    manager_approval_threshold = serializers.DecimalField(max_digits=10, decimal_places=2)
    offline_discounts_allowed = serializers.BooleanField()
    offline_credit_allowed = serializers.BooleanField()


# ── Cash Movements ────────────────────────────────────────────────────────────

class PosCashMovementSerializer(serializers.ModelSerializer):
    worker_name = serializers.CharField(
        source="worker.display_name", read_only=True, default=None
    )

    class Meta:
        model = PosCashMovement
        fields = [
            "id", "shift", "worker", "worker_name",
            "movement_type", "amount", "reason", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class CreateCashMovementSerializer(serializers.Serializer):
    shift_id = serializers.UUIDField()
    worker_id = serializers.UUIDField()
    movement_type = serializers.ChoiceField(choices=PosCashMovement.TYPE_CHOICES)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0.01)
    reason = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
