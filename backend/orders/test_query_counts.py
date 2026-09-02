"""
Perf regression guards — order list serialization must not do per-row queries.

Mirrors the exact queryset + serializer path the my-orders / store-orders views
use (see `_order_qs()` in orders/views.py) and compares the query count between
a 1-order and a 25-order workload. If a refactor reintroduces N+1 access (e.g.
drops select_related/prefetch_related), the delta jumps by ~N and the assertion
fails.

HTTP-level query capture is unreliable in this stack (the request pipeline
clears the connection query log), so the guard measures the ORM + serializer
stage directly, which is where N+1 regressions live.
"""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from accounts.models import CustomerProfile
from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem
from orders.serializers import CustomerOrderSerializer, OrderSerializer


def _order_qs():
    return Order.objects.select_related(
        "merchant",
        "customer__user",
        "reward_redemption__reward",
        "punch_card_redemption__punch_card",
        "table",
        "processed_by_worker",
        "pos_device",
        "cash_shift",
    ).prefetch_related("items__menu_item")


class OrderListQueryCountTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.customer_user = user_model.objects.create_user(
            username="cust", email="cust@example.com", password="Pass123!",
            role="customer",
        )
        self.customer = CustomerProfile.objects.create(
            user=self.customer_user, full_name="Test Customer",
        )
        self.merchant_user = user_model.objects.create_user(
            username="merch", email="m@example.com", password="Pass123!",
            role="merchant",
        )
        self.merchant = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Cafe",
            slug="cafe", is_approved=True, is_open=True,
        )
        self.item = MenuItem.objects.create(
            merchant=self.merchant, name="Latte", price=250,
            is_available=True, loyalty_reward=True, points_per_item=1,
        )

    def _create_orders(self, count):
        for _ in range(count):
            order = Order.objects.create(
                customer=self.customer, merchant=self.merchant,
                total_amount=250, subtotal=250,
                status=Order.STATUS_COMPLETED,
                order_type=Order.ORDER_TYPE_REGULAR,
            )
            OrderItem.objects.create(
                order=order, menu_item=self.item, quantity=1, price=250, subtotal=250,
            )

    def _render(self, serializer_class, qs):
        with CaptureQueriesContext(connection) as captured:
            serializer_class(qs, many=True, context={}).data
        return len(captured)

    def _delta(self, serializer_class):
        self._create_orders(25)
        all_orders = _order_qs().order_by("-created_at")
        large = self._render(serializer_class, all_orders[:25])
        small = self._render(serializer_class, all_orders[:1])
        return large - small

    def test_store_orders_serialization_queries_do_not_grow_per_row(self):
        delta = self._delta(OrderSerializer)
        self.assertLessEqual(delta, 5, f"query delta {delta} suggests N+1 access")

    def test_my_orders_serialization_queries_do_not_grow_per_row(self):
        delta = self._delta(CustomerOrderSerializer)
        self.assertLessEqual(delta, 5, f"query delta {delta} suggests N+1 access")