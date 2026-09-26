# orders/serializers.py
from rest_framework import serializers
from .models import Order, OrderItem, OrderItemOption


class OrderItemOptionSerializer(serializers.ModelSerializer):
    """
    One snapshotted variant/modifier selection on an order line.

    These rows are immutable history: they keep the name and price that were
    charged even after the merchant renames the group or reprices the option,
    so old receipts and KDS tickets must never resolve back to the live menu.
    """

    class Meta:
        model = OrderItemOption
        fields = [
            "id", "group_name", "option_name", "kind",
            "price_effect", "display_order",
        ]
        read_only_fields = fields


class OrderItemSerializer(serializers.ModelSerializer):
    """
    An order line plus its configuration snapshot.

    `special_instructions` and `options` are nullable/absent for historical rows
    created before those fields existed, which is why both are exposed with
    safe defaults rather than assumed present.
    """

    options = OrderItemOptionSerializer(many=True, read_only=True)
    variant_name = serializers.SerializerMethodField()
    modifier_summary = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id", "menu_item", "name", "price", "quantity", "subtotal",
            "special_instructions", "options",
            "variant_name", "modifier_summary",
        ]
        read_only_fields = ["id"]

    def _kind(self, opt):
        return getattr(opt, "kind", "modifier")

    def _snapshot_options(self, obj):
        """
        The line's snapshotted options as a list.

        `options` is a reverse manager, so it is only iterable via `.all()`.
        Views that serialise orders should prefetch `items__options`; this still
        works (with one query) when they do not.

        The result is memoised per instance because `variant_name` and
        `modifier_summary` both need it and would otherwise each trigger the
        same query.
        """
        cached = getattr(obj, "_serialized_options_cache", None)
        if cached is not None:
            return cached

        manager = getattr(obj, "options", None)
        if manager is None:
            resolved = []
        elif isinstance(manager, (list, tuple)):
            resolved = list(manager)
        else:
            resolved = list(manager.all())

        # Only cache when a real prefetch happened; a cached empty list on an
        # un-prefetched instance would be indistinguishable from "no options".
        if hasattr(manager, "_prefetched_objects_cache"):
            obj._serialized_options_cache = resolved
        return resolved

    def get_variant_name(self, obj):
        """Name of the chosen variant, or None for an unconfigured product."""
        for opt in self._snapshot_options(obj):
            if self._kind(opt) == "variant":
                return opt.option_name
        return None

    def get_modifier_summary(self, obj):
        """
        Flat list of chosen modifiers, for compact rendering in carts,
        receipts and KDS tiles without re-walking the nested structure.
        """
        return [
            {
                "group_name": opt.group_name,
                "option_name": opt.option_name,
                "price_effect": str(opt.price_effect),
            }
            for opt in self._snapshot_options(obj)
            if self._kind(opt) != "variant"
        ]


class OrderSerializer(serializers.ModelSerializer):
    items         = OrderItemSerializer(many=True, read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)
    customer_name = serializers.SerializerMethodField()
    merchant_id   = serializers.IntegerField(source="merchant.id",         read_only=True)

    def get_customer_name(self, obj):
        if obj.customer:
            return obj.customer.full_name
        if obj.guest_name_snapshot:
            return obj.guest_name_snapshot
        return None

    # Display helpers for redemption orders — null for regular orders
    reward_name = serializers.CharField(
        source="reward_redemption.reward.name", read_only=True, default=None
    )
    punch_card_name = serializers.CharField(
        source="punch_card_redemption.punch_card.name", read_only=True, default=None
    )

    table_id = serializers.PrimaryKeyRelatedField(
        source="table", read_only=True, default=None
    )

    # POS-related read-only fields
    worker_name = serializers.CharField(
        source="processed_by_worker.display_name", read_only=True, default=None
    )

    can_add_items = serializers.SerializerMethodField()

    def get_can_add_items(self, obj):
        if obj.status not in (Order.STATUS_PENDING, Order.STATUS_CONFIRMED, Order.STATUS_PREPARING):
            return False
        request = self.context.get("request")
        if not request or not request.user or not request.user.is_authenticated:
            return False
        user = request.user
        if hasattr(user, "customer_profile") and obj.customer == user.customer_profile:
            return True
        if hasattr(user, "merchant_profile") and obj.merchant == user.merchant_profile:
            return True
        return False

    class Meta:
        model = Order
        fields = [
            "id", "uuid",
            "customer", "customer_name",
            "merchant", "merchant_id", "merchant_name",
            "status", "order_type", "source", "fulfillment_type",
            "subtotal", "discount_type", "discount_value", "discount_amount",
            "tax_amount", "tax_breakdown", "service_charge",
            "total_amount", "points_earned",
            "payment_status", "payment_method",
            "notes", "items",
            "cancellation_reason", "cancelled_by",
            "reward_name", "punch_card_name",
            "table_id", "table_name_snapshot", "table_number_snapshot",
            "processed_by_worker", "worker_name",
            "pos_device", "cash_shift",
            "guest_session_id", "guest_name_snapshot",
            "kot_number",
            "version", "client_mutation_id", "client_created_at",
            "can_add_items",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uuid", "version", "created_at", "updated_at",
        ]


class CustomerOrderSerializer(serializers.ModelSerializer):
    """
    Customer-facing order view.

    Deliberately EXCLUDES POS-internal fields that a shopper should not see:
    processed_by_worker, worker_name, pos_device, cash_shift,
    client_mutation_id, and version. Used for the authenticated customer's
    my_orders and order responses (H-7).
    """

    items         = OrderItemSerializer(many=True, read_only=True)
    merchant_name = serializers.CharField(source="merchant.business_name", read_only=True)
    customer_name = serializers.SerializerMethodField()
    merchant_id   = serializers.IntegerField(source="merchant.id",         read_only=True)

    def get_customer_name(self, obj):
        if obj.customer:
            return obj.customer.full_name
        if obj.guest_name_snapshot:
            return obj.guest_name_snapshot
        return None

    reward_name = serializers.CharField(
        source="reward_redemption.reward.name", read_only=True, default=None
    )
    punch_card_name = serializers.CharField(
        source="punch_card_redemption.punch_card.name", read_only=True, default=None
    )

    table_id = serializers.PrimaryKeyRelatedField(
        source="table", read_only=True, default=None
    )

    class Meta:
        model = Order
        fields = [
            "id", "uuid",
            "customer", "customer_name",
            "merchant", "merchant_id", "merchant_name",
            "status", "order_type", "source", "fulfillment_type",
            "subtotal", "discount_type", "discount_value", "discount_amount",
            "tax_amount", "tax_breakdown", "service_charge",
            "total_amount", "points_earned",
            "payment_status", "payment_method",
            "notes", "items",
            "cancellation_reason", "cancelled_by",
            "reward_name", "punch_card_name",
            "table_id", "table_name_snapshot", "table_number_snapshot",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uuid", "created_at", "updated_at",
        ]


class CreateOrderItemSerializer(serializers.Serializer):
    menu_item_id = serializers.IntegerField()
    quantity     = serializers.IntegerField(min_value=1)
    selections = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        help_text='[{"group_id": <id>, "option_id": <id>}, ...] selected variants/extras.',
    )
    special_instructions = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=500,
        help_text="Per-line special requests (stored as an immutable snapshot).",
    )


class CreateOrderSerializer(serializers.Serializer):
    merchant_id = serializers.IntegerField()
    items       = CreateOrderItemSerializer(many=True)
    notes       = serializers.CharField(required=False, allow_blank=True, default="")
    client_mutation_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="Optional idempotency key; a resubmitted key returns the existing order.",
    )
    fulfillment_type = serializers.ChoiceField(
        choices=["dine_in", "pickup", "delivery"],
        default="pickup",
        required=False,
    )
    table_token = serializers.CharField(
        required=False, allow_blank=True, default="",
        help_text="Public token of the scanned table (required for dine-in)",
    )

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Order must contain at least one item.")
        return value


class CreateGuestOrderSerializer(serializers.Serializer):
    merchant_id = serializers.IntegerField()
    items       = CreateOrderItemSerializer(many=True)
    notes       = serializers.CharField(required=False, allow_blank=True, default="")
    table_token = serializers.CharField()
    guest_session_id = serializers.CharField(max_length=64)
    guest_name  = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Order must contain at least one item.")
        return value


class AddItemsToOrderSerializer(serializers.Serializer):
    items = CreateOrderItemSerializer(many=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    client_mutation_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        help_text="Optional idempotency key for the add-items mutation.",
    )

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("Must contain at least one item.")
        return value
