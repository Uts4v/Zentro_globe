from django.contrib import admin
from unfold.admin import ModelAdmin as UnfoldModelAdmin
from .models import (
    PosDevice, ShiftWorker, CashShift, PosPayment,
    PosDiscount, PosAuditLog, ProcessedClientMutation,
    CreditAccount, CreditTransaction,
    DebitAccount, DebitTransaction,
    StaffSchedule,
    PosCashMovement,
)
from config.admin import FastAdminMixin


@admin.register(PosDevice)
class PosDeviceAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "name", "merchant", "platform", "is_active", "last_seen_at", "created_at"]
    list_filter = ["is_active", "platform"]
    search_fields = ["name", "merchant__business_name"]
    readonly_fields = ["device_token_hash", "last_seen_at", "last_sync_at", "created_at", "updated_at"]


@admin.register(ShiftWorker)
class ShiftWorkerAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "display_name", "merchant", "role", "is_active",
                    "can_apply_discount", "can_process_refund", "can_close_shift",
                    "failed_pin_attempts", "created_at"]
    list_filter = ["role", "is_active", "can_apply_discount", "can_close_shift"]
    search_fields = ["display_name", "merchant__business_name"]
    readonly_fields = ["pin_hash", "failed_pin_attempts", "locked_until", "created_at", "updated_at"]


@admin.register(CashShift)
class CashShiftAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "device", "opened_by", "closed_by",
                    "opening_cash", "closing_cash", "total_sales",
                    "status", "opened_at", "closed_at"]
    list_filter = ["status"]
    search_fields = ["merchant__business_name"]
    readonly_fields = ["expected_cash", "cash_difference", "total_sales",
                       "total_cash_sales", "total_card_sales", "total_other_sales",
                       "total_orders", "opened_at", "closed_at", "version"]


@admin.register(PosPayment)
class PosPaymentAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "order", "payment_method", "amount", "status",
                    "shift", "worker", "created_at"]
    list_filter = ["payment_method", "status"]
    search_fields = ["order__id", "external_reference"]
    readonly_fields = ["client_mutation_id", "created_at"]


@admin.register(PosDiscount)
class PosDiscountAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "order", "discount_type", "discount_value",
                    "discount_amount", "worker", "authorized_by", "created_at"]
    list_filter = ["discount_type"]
    readonly_fields = ["created_at"]


@admin.register(PosAuditLog)
class PosAuditLogAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "action", "entity_type", "entity_id",
                    "merchant", "worker", "created_at"]
    list_filter = ["action"]
    search_fields = ["entity_id", "merchant__business_name"]
    readonly_fields = ["created_at"]


@admin.register(ProcessedClientMutation)
class ProcessedClientMutationAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "client_mutation_id", "entity_type", "operation",
                    "server_object_id", "merchant", "device", "processed_at"]
    list_filter = ["entity_type", "operation"]
    readonly_fields = ["processed_at"]


@admin.register(CreditAccount)
class CreditAccountAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "customer", "contact_name",
                    "credit_limit", "current_balance", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["contact_name", "merchant__business_name"]
    readonly_fields = ["current_balance", "created_at", "updated_at"]


@admin.register(CreditTransaction)
class CreditTransactionAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "account", "transaction_type", "amount",
                    "balance_before", "balance_after", "worker", "created_at"]
    list_filter = ["transaction_type"]
    search_fields = ["account__contact_name"]
    readonly_fields = ["balance_before", "balance_after", "created_at"]


@admin.register(DebitAccount)
class DebitAccountAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "customer", "contact_name",
                    "balance", "is_active", "created_at"]
    list_filter = ["is_active"]
    search_fields = ["contact_name", "contact_phone", "merchant__business_name"]
    readonly_fields = ["balance", "created_at", "updated_at"]


@admin.register(DebitTransaction)
class DebitTransactionAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "account", "transaction_type", "amount",
                    "balance_before", "balance_after", "worker", "created_at"]
    list_filter = ["transaction_type"]
    search_fields = ["account__contact_name"]
    readonly_fields = ["balance_before", "balance_after", "created_at"]


@admin.register(StaffSchedule)
class StaffScheduleAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "merchant", "worker", "shift_date", "start_time",
                    "end_time", "role", "status", "created_at"]
    list_filter = ["status", "shift_date", "role"]
    search_fields = ["worker__display_name", "merchant__business_name"]
    readonly_fields = ["created_at", "updated_at"]


@admin.register(PosCashMovement)
class PosCashMovementAdmin(FastAdminMixin, UnfoldModelAdmin):
    list_display = ["id", "shift", "worker", "movement_type", "amount",
                    "reason", "created_at"]
    list_filter = ["movement_type"]
    search_fields = ["worker__display_name", "reason"]
    readonly_fields = ["created_at"]
