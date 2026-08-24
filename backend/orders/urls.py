"""
orders/urls.py — mounted at /api/orders/
"""

from django.urls import path
from . import views
from . import preparation_views

urlpatterns = [
    path("my-orders/", views.my_orders, name="my-orders"),
    path("store-orders/", views.store_orders, name="store-orders"),
    path("create/", views.create_order, name="create-order"),
    path("guest-create/", views.guest_create_order, name="guest-create-order"),
    path("merchant-history/", views.merchant_order_history, name="merchant-order-history"),
    path("<int:pk>/", views.order_detail, name="order-detail"),
    path("<int:pk>/update-status/", views.update_order_status, name="update-order-status"),
    path("<int:pk>/cancel/", views.cancel_order, name="cancel-order"),
    path("<int:pk>/add-items/", views.add_items_to_order, name="add-items-to-order"),

    # ── Preparation routing ────────────────────────────────────────────────────
    path(
        "preparation-settings/",
        preparation_views.preparation_settings,
        name="preparation-settings",
    ),
    path(
        "preparation-areas/",
        preparation_views.preparation_area_list_create,
        name="preparation-area-list-create",
    ),
    path(
        "preparation-areas/setup-cafe/",
        preparation_views.setup_cafe_preset,
        name="preparation-area-setup-cafe",
    ),
    path(
        "preparation-areas/bulk-assign/",
        preparation_views.bulk_assign_menu_items,
        name="preparation-area-bulk-assign",
    ),
    path(
        "preparation-areas/<int:area_id>/orders/",
        preparation_views.preparation_area_orders,
        name="preparation-area-orders",
    ),
    path(
        "preparation-areas/<int:area_id>/action/<str:action>/",
        preparation_views.preparation_area_action,
        name="preparation-area-action",
    ),
    path(
        "preparation-areas/<int:pk>/",
        preparation_views.preparation_area_detail,
        name="preparation-area-detail",
    ),
    path(
        "staff/<uuid:worker_id>/preparation-areas/",
        preparation_views.staff_preparation_areas,
        name="staff-preparation-areas",
    ),
]
