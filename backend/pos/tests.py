from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from merchants.models import MerchantProfile
from pos.models import ShiftWorker, StaffPreparationArea, StaffShift
from orders.models import PreparationArea, Order, OrderItem


class StaffShiftAndKdsAccessTests(TestCase):
    """
    Staff shifts are per-worker clock-in/out records for the preparation
    screens (KDS). Multiple staff hold active shifts simultaneously; KDS area
    access is enforced so kitchen staff only see the kitchen, etc.
    """

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="ss-m", email="ss-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="Staff Cafe", slug="staff-cafe",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            preparation_routing_enabled=True,
        )
        self.bar = PreparationArea.objects.create(
            merchant=self.merchant_profile, name="Bar", display_order=1
        )
        self.kitchen = PreparationArea.objects.create(
            merchant=self.merchant_profile, name="Kitchen", display_order=2
        )
        self.barista = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Ramesh", role="cashier"
        )
        self.chef = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Sita", role="waiter"
        )
        self.manager = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Maya", role="manager"
        )
        StaffPreparationArea.objects.create(worker=self.barista, preparation_area=self.bar)
        StaffPreparationArea.objects.create(worker=self.chef, preparation_area=self.kitchen)

    def _auth(self):
        self.client.force_authenticate(user=self.merchant_user)

    # ── KDS area access ────────────────────────────────────────────────────────

    def test_barista_can_only_access_bar(self):
        self._auth()
        resp = self.client.get(
            f"/api/orders/preparation-areas/{self.bar.id}/orders/?worker_id={self.barista.id}"
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        resp = self.client.get(
            f"/api/orders/preparation-areas/{self.kitchen.id}/orders/?worker_id={self.barista.id}"
        )
        self.assertEqual(resp.status_code, 403, resp.data)

    def test_kds_requires_worker_id(self):
        self._auth()
        resp = self.client.get(f"/api/orders/preparation-areas/{self.bar.id}/orders/")
        self.assertEqual(resp.status_code, 400, resp.data)

    def test_manager_can_access_all_areas(self):
        self._auth()
        for area in (self.bar, self.kitchen):
            resp = self.client.get(
                f"/api/orders/preparation-areas/{area.id}/orders/?worker_id={self.manager.id}"
            )
            self.assertEqual(resp.status_code, 200, resp.data)

    # ── Staff shift lifecycle ──────────────────────────────────────────────────

    def test_two_staff_can_hold_active_shifts_simultaneously(self):
        self._auth()
        r1 = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        )
        self.assertEqual(r1.status_code, 201, r1.data)
        r2 = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.chef.id), "area_ids": [self.kitchen.id]},
            format="json",
        )
        self.assertEqual(r2.status_code, 201, r2.data)
        self.assertEqual(
            StaffShift.objects.filter(status=StaffShift.STATUS_ACTIVE).count(), 2
        )
        # The board lists both
        board = self.client.get("/api/pos/staff-shifts/").data
        self.assertEqual(len(board), 2)

    def test_worker_has_a_single_active_shift(self):
        self._auth()
        r1 = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        )
        self.assertEqual(r1.status_code, 201, r1.data)
        r2 = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        )
        self.assertEqual(r2.status_code, 200, r2.data)
        self.assertEqual(r1.data["id"], r2.data["id"])
        self.assertEqual(
            StaffShift.objects.filter(worker=self.barista, status=StaffShift.STATUS_ACTIVE).count(),
            1,
        )

    def test_shift_areas_limited_to_worker_assignments(self):
        self._auth()
        resp = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id, self.kitchen.id]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIn(self.bar.id, resp.data["area_ids"])
        self.assertNotIn(self.kitchen.id, resp.data["area_ids"])

    def test_cashier_cannot_close_another_workers_shift(self):
        self._auth()
        opened = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.chef.id), "area_ids": [self.kitchen.id]},
            format="json",
        ).data
        resp = self.client.post(
            "/api/pos/staff-shift/close/",
            {"shift_id": opened["id"], "worker_id": str(self.barista.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.data)
        # A manager may force-close
        resp = self.client.post(
            "/api/pos/staff-shift/close/",
            {"shift_id": opened["id"], "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], "closed")

    def test_closing_staff_shift_does_not_touch_cash_shift(self):
        self._auth()
        opened = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        ).data
        resp = self.client.post(
            "/api/pos/staff-shift/close/",
            {"shift_id": opened["id"], "worker_id": str(self.barista.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        # No CashShift was created or affected
        from pos.models import CashShift
        self.assertFalse(CashShift.objects.filter(merchant=self.merchant_profile).exists())

    # ── Preparation action attribution ─────────────────────────────────────────

    def test_prep_action_records_worker_and_shift(self):
        order = Order.objects.create(
            merchant=self.merchant_profile,
            status=Order.STATUS_CONFIRMED,
            total_amount=150,
        )
        OrderItem.objects.create(
            order=order, name="Espresso", price=150, quantity=1, subtotal=150,
            preparation_area=self.bar, requires_preparation=True,
            preparation_status=OrderItem.PENDING,
        )
        self._auth()
        opened = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        ).data

        resp = self.client.post(
            f"/api/orders/preparation-areas/{self.bar.id}/action/start/",
            {
                "order_id": order.id,
                "worker_id": str(self.barista.id),
                "staff_shift_id": opened["id"],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        item = OrderItem.objects.get(order=order)
        self.assertEqual(item.preparation_status, OrderItem.PREPARING)
        self.assertEqual(item.preparation_started_by, self.barista)
        self.assertEqual(str(item.preparation_staff_shift_id), opened["id"])

    def test_prep_action_requires_worker_access(self):
        order = Order.objects.create(
            merchant=self.merchant_profile,
            status=Order.STATUS_CONFIRMED,
            total_amount=150,
        )
        OrderItem.objects.create(
            order=order, name="Burger", price=150, quantity=1, subtotal=150,
            preparation_area=self.kitchen, requires_preparation=True,
            preparation_status=OrderItem.PENDING,
        )
        self._auth()
        # Barista has no kitchen access → 403
        resp = self.client.post(
            f"/api/orders/preparation-areas/{self.kitchen.id}/action/start/",
            {"order_id": order.id, "worker_id": str(self.barista.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.data)


class PreparationActionConsistencyTests(TestCase):
    """
    KDS actions must be idempotent and work for every account type:
    waiters (shift + assignment required) and managers/admins (any area,
    shift optional). The default area is a consolidated view and must act
    on items from every area, matching what its screen shows.
    """

    def setUp(self):
        self.client = APIClient()
        self.user_model = get_user_model()
        self.merchant_user = self.user_model.objects.create_user(
            username="kds-m", email="kds-m@test.com", password="Pass123!", role="merchant"
        )
        self.merchant_profile = MerchantProfile.objects.create(
            user=self.merchant_user, business_name="KDS Cafe", slug="kds-cafe-2",
            is_open=True, onboarding_complete=True, pos_enabled=True,
            preparation_routing_enabled=True,
        )
        self.bar = PreparationArea.objects.create(
            merchant=self.merchant_profile, name="Bar", display_order=1
        )
        self.kitchen = PreparationArea.objects.create(
            merchant=self.merchant_profile, name="Kitchen", display_order=2
        )
        self.main = PreparationArea.objects.create(
            merchant=self.merchant_profile, name="Main Counter", display_order=3,
            is_default=True,
        )
        self.barista = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Ramesh", role="waiter"
        )
        self.manager = ShiftWorker.objects.create(
            merchant=self.merchant_profile, display_name="Maya", role="admin"
        )
        StaffPreparationArea.objects.create(worker=self.barista, preparation_area=self.bar)
        self.client.force_authenticate(user=self.merchant_user)

    def _order_with_bar_item(self, status=OrderItem.PENDING):
        order = Order.objects.create(
            merchant=self.merchant_profile,
            status=Order.STATUS_CONFIRMED,
            total_amount=150,
        )
        OrderItem.objects.create(
            order=order, name="Espresso", price=150, quantity=1, subtotal=150,
            preparation_area=self.bar, requires_preparation=True,
            preparation_status=status,
        )
        return order

    def test_same_status_start_is_idempotent(self):
        """Re-tapping Start on an already-preparing order succeeds (stale screen)."""
        order = self._order_with_bar_item(status=OrderItem.PREPARING)
        opened = self.client.post(
            "/api/pos/staff-shift/open/",
            {"worker_id": str(self.barista.id), "area_ids": [self.bar.id]},
            format="json",
        ).data
        for _ in range(2):
            resp = self.client.post(
                f"/api/orders/preparation-areas/{self.bar.id}/action/start/",
                {
                    "order_id": order.id,
                    "worker_id": str(self.barista.id),
                    "staff_shift_id": opened["id"],
                },
                format="json",
            )
            self.assertEqual(resp.status_code, 200, resp.data)

    def test_admin_can_act_without_staff_shift(self):
        """Managers/admins may start orders without opening a staff shift."""
        order = self._order_with_bar_item()
        resp = self.client.post(
            f"/api/orders/preparation-areas/{self.bar.id}/action/start/",
            {"order_id": order.id, "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(
            OrderItem.objects.get(order=order).preparation_status, OrderItem.PREPARING
        )

    def test_default_area_acts_on_all_areas(self):
        """The consolidated (default) area updates items from every area."""
        order = Order.objects.create(
            merchant=self.merchant_profile, status=Order.STATUS_CONFIRMED, total_amount=450,
        )
        OrderItem.objects.create(
            order=order, name="Espresso", price=150, quantity=1, subtotal=150,
            preparation_area=self.bar, requires_preparation=True,
            preparation_status=OrderItem.PENDING,
        )
        OrderItem.objects.create(
            order=order, name="Burger", price=300, quantity=1, subtotal=300,
            preparation_area=self.kitchen, requires_preparation=True,
            preparation_status=OrderItem.PENDING,
        )
        resp = self.client.post(
            f"/api/orders/preparation-areas/{self.main.id}/action/start/",
            {"order_id": order.id, "worker_id": str(self.manager.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        statuses = set(
            OrderItem.objects.filter(order=order).values_list("preparation_status", flat=True)
        )
        self.assertEqual(statuses, {OrderItem.PREPARING})
