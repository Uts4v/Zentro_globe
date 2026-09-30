"""
inventory/urls.py — mounted at /api/inventory/
"""

from django.urls import path
from . import views, views_io

urlpatterns = [
    path("", views.inventory_root_view, name="inventory-root"),
    path("overview/", views.overview, name="inventory-overview"),

    # Staff mode (POS worker using the dashboard on a shared device)
    path("staff/workers/", views.staff_workers_view, name="inventory-staff-workers"),
    path("staff/session/", views.staff_session_start_view, name="inventory-staff-session"),
    path("staff/session/end/", views.staff_session_end_view, name="inventory-staff-session-end"),

    # Reference data
    path("categories/", views.categories_view, name="inventory-categories"),
    path("categories/reorder/", views.category_reorder_view, name="inventory-categories-reorder"),
    path("categories/<int:pk>/", views.category_detail_view, name="inventory-category-detail"),
    path("locations/", views.locations_view, name="inventory-locations"),
    path("locations/<int:pk>/", views.location_detail_view, name="inventory-location-detail"),
    path("units/", views.units_view, name="inventory-units"),
    path("schedules/", views.schedules_view, name="inventory-schedules"),
    path("schedules/<int:pk>/", views.schedule_detail_view, name="inventory-schedule-detail"),

    # Items & balances
    path("items/", views.items_view, name="inventory-items"),
    path("items/<int:pk>/", views.item_detail_view, name="inventory-item-detail"),
    path("items/<int:pk>/archive/", views.archive_item_view, name="inventory-item-archive"),
    path("items/<int:pk>/movements/", views.item_movements_view, name="inventory-item-movements"),
    path("movements/", views.movements_view, name="inventory-movements"),
    path("movements/<int:pk>/reversal/", views.reversal_view, name="inventory-movement-reversal"),

    # Waste / Adjustments
    path("waste/", views.waste_view, name="inventory-waste"),
    path("adjustments/", views.adjustments_view, name="inventory-adjustments"),
    path("adjustments/<int:pk>/<str:decision>/", views.adjustment_decision_view,
         name="inventory-adjustment-decision"),

    # Receiving
    path("receiving/", views.receiving_view, name="inventory-receiving"),
    path("receiving/<int:pk>/", views.receiving_detail_view, name="inventory-receiving-detail"),

    # Transfers
    path("transfers/", views.transfers_view, name="inventory-transfers"),
    path("transfers/<int:pk>/complete/", views.transfer_complete_view, name="inventory-transfer-complete"),
    path("transfers/<int:pk>/cancel/", views.transfer_cancel_view, name="inventory-transfer-cancel"),

    # Stock counts
    path("counts/", views.counts_view, name="inventory-counts"),
    path("counts/<int:pk>/", views.count_detail_view, name="inventory-count-detail"),
    path("counts/<int:pk>/lines/", views.count_line_upsert_view, name="inventory-count-lines"),
    path("counts/<int:pk>/submit/", views.count_submit_view, name="inventory-count-submit"),
    path("counts/<int:pk>/approve/", views.count_approve_view, name="inventory-count-approve"),
    path("counts/<int:pk>/cancel/", views.count_cancel_view, name="inventory-count-cancel"),

    # Suppliers & purchase orders
    path("suppliers/", views.suppliers_view, name="inventory-suppliers"),
    path("suppliers/<int:pk>/", views.supplier_detail_view, name="inventory-supplier-detail"),
    path("suppliers/<int:pk>/mappings/", views.supplier_mapping_view, name="inventory-supplier-mapping"),
    path("purchase-orders/", views.purchase_orders_view, name="inventory-purchase-orders"),
    path("purchase-orders/<int:pk>/", views.purchase_order_detail_view, name="inventory-purchase-order-detail"),
    path("purchase-orders/<int:pk>/receive/", views.purchase_order_receive_view, name="inventory-purchase-order-receive"),

    # Reports & audit
    path("reports/", views.reports_view, name="inventory-reports"),
    path("audit/", views.audit_log_view, name="inventory-audit"),

    # Settings
    path("settings/", views.settings_view, name="inventory-settings"),

    # Import / export
    path("import/template/", views_io.import_template_view, name="inventory-import-template"),
    path("import/", views_io.import_sessions_view, name="inventory-import"),
    path("import/<int:pk>/", views_io.import_session_detail_view, name="inventory-import-detail"),
    path("import/<int:pk>/review/", views_io.import_review_view, name="inventory-import-review"),
    path("import/<int:pk>/commit/", views_io.import_commit_view, name="inventory-import-commit"),
    path("import/<int:pk>/report.csv", views_io.import_report_view, name="inventory-import-report"),
    path("exports/<str:report>.<str:fmt>", views_io.export_view, name="inventory-export"),
]