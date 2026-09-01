# orders/serializers.py
from rest_framework import serializers
from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["id", "menu_item", "name", "price", "quantity", "subtotal"]
        read_only_fields = ["id"]


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
