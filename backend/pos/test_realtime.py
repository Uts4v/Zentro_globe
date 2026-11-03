from unittest.mock import AsyncMock, Mock, patch

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from merchants.models import MenuItem, MerchantProfile
from notifications.middleware import JWTAuthMiddleware
from notifications.routing import websocket_urlpatterns
from orders.models import Order

from . import rbac
from .models import ShiftWorker
from .realtime import broadcast_pos_order_changed, pos_group_name


class Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        User = get_user_model()
        cls.owner = User.objects.create_user(
            username="realtime-owner",
            email="realtime-owner@test.com",
            password="Owner123!",
            role="merchant",
        )
        cls.merchant = MerchantProfile.objects.create(
            user=cls.owner,
            business_name="Realtime Cafe",
            slug="realtime-cafe",
            is_approved=True,
            is_open=True,
            pos_enabled=True,
        )
        cls.roles = rbac.ensure_default_roles(cls.merchant)
        cls.coffee = MenuItem.objects.create(
            merchant=cls.merchant,
            name="Coffee",
            price="100.00",
            is_available=True,
        )

        cls.other_owner = User.objects.create_user(
            username="realtime-other",
            email="realtime-other@test.com",
            password="Other123!",
            role="merchant",
        )
        cls.other_merchant = MerchantProfile.objects.create(
            user=cls.other_owner,
            business_name="Other Realtime Cafe",
            slug="other-realtime-cafe",
            is_approved=True,
            is_open=True,
            pos_enabled=True,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def employee(self, name, role_key, pin="1234"):
        resp = self.client.post(
            "/api/pos/workers/team/",
            {
                "display_name": name,
                "pin": pin,
                "staff_role": self.roles[role_key].id,
                "area_ids": [],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return ShiftWorker.objects.get(id=resp.data["id"])

    def as_staff(self, worker, pin="1234"):
        resp = self.client.post(
            "/api/pos/staff/session/",
            {"worker_id": str(worker.id), "pin": pin},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        client = APIClient()
        client.force_authenticate(self.owner)
        client.credentials(HTTP_X_ZENTRO_STAFF=resp.data["token"])
        return client

    def create_order(self):
        resp = self.client.post(
            "/api/pos/order/create/",
            {
                "merchant_id": self.merchant.id,
                "items": [{"menu_item_id": self.coffee.id, "quantity": 1}],
                "fulfillment_type": "pickup",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return Order.objects.get(id=resp.data["id"])

    def ws_token(self, user=None):
        token = AccessToken.for_user(user or self.owner)
        token["ws_auth"] = True
        token["pos_merchant_id"] = self.merchant.id
        return str(token)


class PosWsTokenTests(Base):
    def test_owner_gets_short_lived_pos_token(self):
        resp = self.client.get("/api/pos/ws-token/")

        self.assertEqual(resp.status_code, 200, resp.data)
        token = AccessToken(resp.data["token"])
        self.assertTrue(token["ws_auth"])
        self.assertEqual(token["pos_merchant_id"], self.merchant.id)
        self.assertFalse(token.get("pos_worker_id"))
        self.assertEqual(resp.data["expires_in"], 60)

    def test_staff_token_names_the_worker(self):
        worker = self.employee("Sita", "cashier")
        staff = self.as_staff(worker)

        resp = staff.get("/api/pos/ws-token/")

        self.assertEqual(resp.status_code, 200, resp.data)
        token = AccessToken(resp.data["token"])
        self.assertEqual(token["pos_merchant_id"], self.merchant.id)
        self.assertEqual(token["pos_worker_id"], str(worker.id))

    def test_worker_without_orders_view_is_denied(self):
        worker = self.employee("Hari", "kitchen")
        staff = self.as_staff(worker)

        resp = staff.get("/api/pos/ws-token/")

        self.assertEqual(resp.status_code, 403, resp.data)
        self.assertEqual(resp.data["required_permission"], "orders.view")


class OrderSignalTests(Base):
    @patch("pos.signals.broadcast_pos_order_changed")
    def test_created_order_broadcasts_after_commit(self, broadcast):
        with self.captureOnCommitCallbacks(execute=True):
            order = self.create_order()

        calls = [call.kwargs for call in broadcast.call_args_list]
        self.assertTrue(
            any(
                call["merchant_id"] == self.merchant.id
                and call["order_id"] == order.id
                and call["order_uuid"] == str(order.uuid)
                and call["action"] == "created"
                for call in calls
            ),
            calls,
        )

    @patch("pos.signals.broadcast_pos_order_changed")
    def test_updated_order_broadcasts_after_commit(self, broadcast):
        order = self.create_order()
        broadcast.reset_mock()
        order.status = Order.STATUS_CONFIRMED

        with self.captureOnCommitCallbacks(execute=True):
            order.save(update_fields=["status"])

        calls = [call.kwargs for call in broadcast.call_args_list]
        self.assertTrue(
            any(
                call["order_id"] == order.id
                and call["status"] == Order.STATUS_CONFIRMED
                and call["action"] == "updated"
                for call in calls
            ),
            calls,
        )

    @patch("pos.signals.broadcast_pos_order_changed")
    def test_deleted_order_broadcasts_after_commit(self, broadcast):
        order = self.create_order()
        order_id = order.id
        broadcast.reset_mock()

        with self.captureOnCommitCallbacks(execute=True):
            order.delete()

        calls = [call.kwargs for call in broadcast.call_args_list]
        self.assertTrue(
            any(
                call["order_id"] == order_id
                and call["action"] == "deleted"
                for call in calls
            ),
            calls,
        )


@override_settings(
    CHANNEL_LAYERS={
        "default": {"BACKEND": "channels.layers.InMemoryChannelLayer"},
    }
)
class PosConsumerTests(Base):
    async def connect(self, token, merchant_id):
        communicator = WebsocketCommunicator(
            JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
            f"/ws/pos/{merchant_id}/?token={token}",
        )
        connected, _ = await communicator.connect()
        return communicator, connected

    def test_owner_connects_and_receives_order_event(self):
        async def scenario():
            communicator, connected = await self.connect(
                self.ws_token(), self.merchant.id
            )
            self.assertTrue(connected)
            try:
                await get_channel_layer().group_send(
                    pos_group_name(self.merchant.id),
                    {
                        "type": "pos.event",
                        "event": "order.changed",
                        "data": {
                            "merchant_id": self.merchant.id,
                            "action": "updated",
                        },
                    },
                )
                return await communicator.receive_json_from(timeout=1)
            finally:
                await communicator.disconnect()

        message = async_to_sync(scenario)()

        self.assertEqual(message["event"], "order.changed")
        self.assertEqual(message["data"]["merchant_id"], self.merchant.id)

    def test_other_merchant_is_rejected(self):
        async def scenario():
            communicator, connected = await self.connect(
                self.ws_token(), self.other_merchant.id
            )
            if connected:
                await communicator.disconnect()
            return connected

        self.assertFalse(async_to_sync(scenario)())

    def test_long_lived_access_token_is_rejected(self):
        token = str(AccessToken.for_user(self.owner))

        async def scenario():
            communicator, connected = await self.connect(token, self.merchant.id)
            if connected:
                await communicator.disconnect()
            return connected

        self.assertFalse(async_to_sync(scenario)())

    def test_disabled_pos_merchant_is_rejected(self):
        MerchantProfile.objects.filter(pk=self.other_merchant.pk).update(
            pos_enabled=False
        )

        async def scenario():
            communicator, connected = await self.connect(
                self.ws_token(self.other_owner), self.other_merchant.id
            )
            if connected:
                await communicator.disconnect()
            return connected

        self.assertFalse(async_to_sync(scenario)())


class BroadcastHelperTests(TestCase):
    @patch("pos.realtime.get_channel_layer")
    def test_sends_expected_group_event(self, get_channel_layer):
        layer = Mock()
        layer.group_send = AsyncMock()
        get_channel_layer.return_value = layer

        broadcast_pos_order_changed(
            merchant_id=12,
            order_id=7,
            order_uuid="00000000-0000-0000-0000-000000000007",
            status=Order.STATUS_READY,
            table_id=3,
            version=2,
            action="updated",
        )

        layer.group_send.assert_called_once_with(
            "merchant_12_pos",
            {
                "type": "pos.event",
                "event": "order.changed",
                "data": {
                    "merchant_id": 12,
                    "order_id": 7,
                    "order_uuid": "00000000-0000-0000-0000-000000000007",
                    "status": Order.STATUS_READY,
                    "table_id": 3,
                    "version": 2,
                    "action": "updated",
                },
            },
        )
