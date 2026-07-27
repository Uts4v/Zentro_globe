"""
pos/urls.py — mounted at /api/pos/
"""

from django.urls import path
from . import views

urlpatterns = [
    # Health
    path("health/", views.health_check, name="pos-health"),

    # POS Login & Bootstrap (Phase 4)
    path("auth/login/", views.pos_login, name="pos-login"),
    path("auth/device/authorize/", views.pos_device_authorize, name="pos-device-authorize"),
    path("auth/bootstrap/", views.pos_bootstrap, name="pos-bootstrap"),
    path("auth/device-bootstrap/", views.pos_bootstrap_device, name="pos-device-bootstrap"),

    # Device management
    path("device/register/", views.register_device, name="pos-device-register"),
    path("device/verify/", views.verify_device, name="pos-device-verify"),
    path("device/<uuid:device_id>/deactivate/", views.deactivate_device, name="pos-device-deactivate"),
    path("devices/", views.list_devices, name="pos-devices"),

    # Worker management
    path("workers/", views.list_workers, name="pos-workers"),
    path("workers/create/", views.create_worker, name="pos-worker-create"),
    path("workers/<uuid:worker_id>/update/", views.update_worker, name="pos-worker-update"),
    path("worker/login/", views.worker_login, name="pos-worker-login"),
    path("worker/logout/", views.worker_logout, name="pos-worker-logout"),

    # Shift management
    path("shift/active/", views.active_shift, name="pos-shift-active"),
    path("shift/last-closed/", views.last_closed_shift, name="pos-shift-last-closed"),
    path("shift/open/", views.open_shift, name="pos-shift-open"),
    path("shift/close/", views.close_shift, name="pos-shift-close"),
    path("shift/summary/", views.shift_summary, name="pos-shift-summary"),
    path("shifts/", views.list_shifts, name="pos-shifts"),

    # POS orders
    path("order/create/", views.create_pos_order, name="pos-order-create"),
    path("order/status/", views.update_order_status_uuid, name="pos-order-status"),
    path("orders/", views.pos_orders, name="pos-orders"),

    # Receipts & Bills
    path("receipt/<uuid:order_id>/", views.receipt_data, name="pos-receipt-data"),

    # Payments
    path("payment/create/", views.create_payment, name="pos-payment-create"),
    path("payment/split/", views.create_split_payment, name="pos-split-payment"),
    path("payments/", views.list_payments, name="pos-payments"),

    # Discounts
    path("discount/apply/", views.apply_discount, name="pos-discount-apply"),

    # Cash movements (pay-in / pay-out / cash drop)
    path("cash/movement/", views.create_cash_movement, name="pos-cash-movement"),
    path("cash/movements/", views.list_cash_movements, name="pos-cash-movements"),

    # Customer identification (Phase 26)
    path("customers/search/", views.search_customers, name="pos-customer-search"),

    # Refund processing (Phase 27)
    path("refund/", views.process_refund, name="pos-refund"),

    # Credit accounts
    path("credit/accounts/", views.list_credit_accounts, name="pos-credit-accounts"),
    path("credit/sale/", views.credit_sale, name="pos-credit-sale"),
    path("credit/repayment/", views.credit_repayment, name="pos-credit-repayment"),

    # Debit accounts (prepaid / wallet)
    path("debit/accounts/", views.list_debit_accounts, name="pos-debit-accounts"),
    path("debit/topup/", views.debit_topup, name="pos-debit-topup"),
    path("debit/purchase/", views.debit_purchase, name="pos-debit-purchase"),
    path("debit/adjustment/", views.debit_adjustment, name="pos-debit-adjustment"),

    # POS settings
    path("settings/", views.pos_settings, name="pos-settings"),
    path("settings/update/", views.update_pos_settings, name="pos-settings-update"),

    # Menu snapshot for offline bootstrap
    path("menu/snapshot/", views.menu_snapshot, name="pos-menu-snapshot"),

    # Audit logs
    path("audit/", views.audit_logs, name="pos-audit-logs"),

    # Z-report (end-of-day)
    path("z-report/", views.z_report, name="pos-z-report"),

    # Staff daily report
    path("staff-report/", views.staff_daily_report, name="pos-staff-report"),

    # Conflict resolution (Phase 30)
    path("conflicts/", views.list_conflicts, name="pos-conflicts"),
    path("conflicts/resolve/", views.resolve_conflict, name="pos-conflict-resolve"),
    path("conflicts/clear-mutations/", views.clear_processed_mutations, name="pos-clear-mutations"),

    # Table QR ordering (Phase 28) — public endpoints
    path("table/<str:token>/menu/", views.table_menu, name="pos-table-menu"),
    path("table/<str:token>/order/", views.table_order, name="pos-table-order"),

    # Assign customer to existing order
    path("order/assign-customer/", views.assign_customer_to_order, name="pos-assign-customer"),

    # Notifications (Phase 31)
    path("notifications/", views.pos_notifications, name="pos-notifications"),
    path("notifications/<int:notification_id>/read/", views.mark_notification_read, name="pos-notification-read"),

    # Staff scheduling (Phase 31+)
    path("schedules/", views.list_schedules, name="pos-schedules"),
    path("schedules/create/", views.create_schedule, name="pos-schedule-create"),
    path("schedules/<int:schedule_id>/delete/", views.delete_schedule, name="pos-schedule-delete"),
]
