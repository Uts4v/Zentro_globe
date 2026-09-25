from unfold.admin import ModelAdmin
from unfold.contrib.forms.widgets import UnfoldAdminTextInputWidget

from django.contrib import admin

from .models import (
    InventoryItem,
    InventoryCategory,
    InventoryLocation,
    InventoryMovement,
    InventoryBalance,
    InventoryWasteRecord,
    InventoryAdjustment,
    MenuItemStockLink,
    InventoryReceiving,
    InventoryTransfer,
    StockCount,
    StockCountLine,
    Supplier,
    PurchaseOrder,
    InventoryCountSchedule,
    InventorySettings,
    InventoryAuditLog,
    UnitOfMeasure,
)


@admin.register(InventoryItem)
class InventoryItemAdmin(ModelAdmin):
    list_display = ["name", "item_type", "category", "base_unit", "active", "archived", "par_level", "reorder_point"]
    list_filter = ["item_type", "active", "archived", "category"]
    search_fields = ["name", "sku", "barcode"]
    autocomplete_fields = ["category", "default_location", "primary_supplier", "base_unit"]


@admin.register(MenuItemStockLink)
class MenuItemStockLinkAdmin(ModelAdmin):
    list_display = ["menu_item", "inventory_item", "quantity_per_unit", "merchant"]
    search_fields = ["menu_item__name", "inventory_item__name"]
    raw_id_fields = ["merchant", "menu_item", "inventory_item"]


@admin.register(InventoryCategory)
class InventoryCategoryAdmin(ModelAdmin):
    list_display = ["name", "merchant", "display_order", "is_active"]
    search_fields = ["name"]
    autocomplete_fields = ["merchant"]


@admin.register(InventoryLocation)
class InventoryLocationAdmin(ModelAdmin):
    list_display = ["name", "merchant", "display_order", "is_active"]
    search_fields = ["name"]


@admin.register(UnitOfMeasure)
class UnitOfMeasureAdmin(ModelAdmin):
    list_display = ["code", "name", "kind", "factor_to_base", "is_base", "merchant"]
    search_fields = ["code", "name"]


@admin.register(InventoryBalance)
class InventoryBalanceAdmin(ModelAdmin):
    list_display = ["inventory_item", "location", "on_hand", "avg_cost", "updated_at"]
    search_fields = ["inventory_item__name"]


@admin.register(InventoryMovement)
class InventoryMovementAdmin(ModelAdmin):
    list_display = [
        "id", "inventory_item", "location", "quantity_change", "movement_type",
        "performed_by", "created_at", "balance_after",
    ]
    list_filter = ["movement_type", "location"]
    search_fields = ["inventory_item__name", "source_id"]
    date_hierarchy = "created_at"


@admin.register(InventoryWasteRecord)
class InventoryWasteRecordAdmin(ModelAdmin):
    list_display = ["inventory_item", "location", "quantity", "reason", "created_at"]


@admin.register(InventoryAdjustment)
class InventoryAdjustmentAdmin(ModelAdmin):
    list_display = ["inventory_item", "location", "quantity_delta", "reason", "created_at"]


@admin.register(InventoryReceiving)
class InventoryReceivingAdmin(ModelAdmin):
    list_display = ["id", "receipt_number", "supplier", "location", "total_value", "received_at"]


@admin.register(InventoryTransfer)
class InventoryTransferAdmin(ModelAdmin):
    list_display = ["from_location", "to_location", "status", "created_at"]


@admin.register(StockCount)
class StockCountAdmin(ModelAdmin):
    list_display = ["name", "status", "location", "started_by", "submitted_at", "approved_at"]
    list_filter = ["status"]
    search_fields = ["name"]


@admin.register(StockCountLine)
class StockCountLineAdmin(ModelAdmin):
    list_display = ["stock_count", "inventory_item", "location", "book_quantity", "physical_quantity", "difference"]


@admin.register(Supplier)
class SupplierAdmin(ModelAdmin):
    list_display = ["name", "merchant", "phone", "email", "is_active"]
    search_fields = ["name", "phone"]


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(ModelAdmin):
    list_display = ["po_number", "supplier", "status", "total_amount", "created_at"]
    list_filter = ["status"]


@admin.register(InventoryCountSchedule)
class InventoryCountScheduleAdmin(ModelAdmin):
    list_display = ["name", "scope_type", "frequency_type", "frequency_days", "next_due_at", "enabled"]


@admin.register(InventorySettings)
class InventorySettingsAdmin(ModelAdmin):
    list_display = ["merchant", "require_count_approval", "prevent_negative_stock"]


@admin.register(InventoryAuditLog)
class InventoryAuditLogAdmin(ModelAdmin):
    list_display = ["action", "merchant", "user", "entity_type", "entity_id", "created_at"]
    list_filter = ["action"]
    date_hierarchy = "created_at"