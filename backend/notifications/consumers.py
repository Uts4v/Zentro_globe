# notifications/consumers.py
# Rename your existing consumer.py to consumers.py (note the 's')
# routing.py already imports from 'consumers' so this fixes the import error.

import json
from channels.generic.websocket import AsyncWebsocketConsumer


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return

        self.group_name = f"user_{user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(
                self.group_name, self.channel_name
            )

    async def notification_message(self, event):
        await self.send(text_data=json.dumps(event["data"]))


class PreparationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for preparation-area events.

    Clients connect to: ws://host/ws/preparation/{merchant_id}/{area_id}/
    or for merchant-level (all areas): ws://host/ws/preparation/{merchant_id}/all/
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return

        self.merchant_id = self.scope["url_route"]["kwargs"]["merchant_id"]
        self.area_id = self.scope["url_route"]["kwargs"].get("area_id", "all")

        # Subscribe to area-specific group
        self.area_group = f"merchant_{self.merchant_id}_preparation_{self.area_id}"
        await self.channel_layer.group_add(self.area_group, self.channel_name)

        # Also subscribe to merchant-wide group
        self.merchant_group = f"merchant_{self.merchant_id}_preparation_all"
        await self.channel_layer.group_add(self.merchant_group, self.channel_name)

        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "area_group"):
            await self.channel_layer.group_discard(
                self.area_group, self.channel_name
            )
        if hasattr(self, "merchant_group"):
            await self.channel_layer.group_discard(
                self.merchant_group, self.channel_name
            )

    async def preparation_event(self, event):
        """Handle preparation.event messages from the channel layer."""
        await self.send(text_data=json.dumps({
            "event": event.get("event", ""),
            "data": event.get("data", {}),
        }))