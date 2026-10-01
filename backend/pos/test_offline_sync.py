"""
Tests for what the POS relies on when it sends offline work to the server.

Run with: python manage.py test pos.test_offline_sync

1. An order the server already has is returned again, never duplicated or
   refused — even if the shift has closed or the mutation log was cleared.
2. A status change queued against an order taken offline reaches it by the
   device's own id for that order.
3. A receipt for an order that started offline says it is synced.
"""

import uuid

from django.test import TestCase

from orders.models import Order
from pos.models import CashShift, ProcessedClientMutation

from .test_pos_order_fixes import PosFixtureMixin


class OfflineOrderResendTests(PosFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.merchant.shift_management_enabled = True
        self.merchant.save(update_fields=["shift_management_enabled"])

    def send_offline_order(self, mutation_id):
        return self.client.post("/api/pos/order/create/", {
            "items": [{"menu_item_id": self.coke.id, "quantity": 2}],
            "fulfillment_type": "takeaway",
            "shift_id": str(self.shift.id),
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": mutation_id,
            "source": "pos_offline",
        }, format="json")

    def test_resend_returns_the_same_order(self):
        mutation_id = str(uuid.uuid4())
        first = self.send_offline_order(mutation_id)
        self.assertEqual(first.status_code, 201, first.data)

        second = self.send_offline_order(mutation_id)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["uuid"], first.data["uuid"])
        self.assertEqual(Order.objects.filter(merchant=self.merchant).count(), 1)

    def test_resend_after_the_shift_closed_still_returns_the_order(self):
        mutation_id = str(uuid.uuid4())
        first = self.send_offline_order(mutation_id)
        self.assertEqual(first.status_code, 201, first.data)

        self.shift.status = CashShift.STATUS_CLOSED
        self.shift.save(update_fields=["status"])

        second = self.send_offline_order(mutation_id)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["uuid"], first.data["uuid"])
        self.assertEqual(Order.objects.filter(merchant=self.merchant).count(), 1)

    def test_resend_after_the_mutation_log_was_cleared_does_not_duplicate(self):
        mutation_id = str(uuid.uuid4())
        first = self.send_offline_order(mutation_id)
        self.assertEqual(first.status_code, 201, first.data)

        ProcessedClientMutation.objects.filter(merchant=self.merchant).delete()

        second = self.send_offline_order(mutation_id)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["uuid"], first.data["uuid"])
        self.assertEqual(Order.objects.filter(merchant=self.merchant).count(), 1)


class OfflineOrderFollowUpTests(PosFixtureMixin, TestCase):
    def test_status_change_finds_the_order_by_its_client_mutation_id(self):
        mutation_id = str(uuid.uuid4())
        created = self.create_pos_order([(self.coke, 1)], mutation_id=mutation_id)
        self.assertEqual(created.status_code, 201, created.data)

        res = self.client.post("/api/pos/order/status/", {
            "order_id": mutation_id,
            "status": "preparing",
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
        }, format="json")

        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["uuid"], created.data["uuid"])
        self.assertEqual(Order.objects.get(uuid=created.data["uuid"]).status, "preparing")

    def test_status_change_for_an_unknown_order_is_not_found(self):
        res = self.client.post("/api/pos/order/status/", {
            "order_id": str(uuid.uuid4()),
            "status": "preparing",
        }, format="json")
        self.assertEqual(res.status_code, 404, res.data)

    def test_payment_and_status_replay_in_the_order_they_were_taken(self):
        """Dine-in taken offline: order, kitchen progress, then payment."""
        mutation_id = str(uuid.uuid4())
        created = self.create_pos_order([(self.coke, 1)], mutation_id=mutation_id)
        self.assertEqual(created.status_code, 201, created.data)

        for step in ("preparing", "ready"):
            res = self.client.post("/api/pos/order/status/", {
                "order_id": mutation_id, "status": step,
            }, format="json")
            self.assertEqual(res.status_code, 200, res.data)

        paid = self.pay(mutation_id, created.data["total_amount"])
        self.assertEqual(paid.status_code, 201, paid.data)

        order = Order.objects.get(uuid=created.data["uuid"])
        self.assertEqual(order.payment_status, "paid")
        self.assertEqual(order.status, "completed")

    def test_receipt_of_a_synced_offline_order_is_marked_synced(self):
        res = self.client.post("/api/pos/order/create/", {
            "items": [{"menu_item_id": self.coke.id, "quantity": 1}],
            "fulfillment_type": "takeaway",
            "worker_id": str(self.worker.id),
            "device_id": str(self.device.id),
            "client_mutation_id": str(uuid.uuid4()),
            "source": "pos_offline",
        }, format="json")
        self.assertEqual(res.status_code, 201, res.data)

        receipt = self.client.get(f"/api/pos/receipt/{res.data['uuid']}/")
        self.assertEqual(receipt.status_code, 200, receipt.data)
        self.assertTrue(receipt.data["is_offline_receipt"])
        self.assertEqual(receipt.data["sync_status"], "synced")
