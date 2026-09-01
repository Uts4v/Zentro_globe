import logging
import uuid
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum, Count, Q, F
from django.db.models.functions import Coalesce
from django.db import IntegrityError
from django.utils import timezone

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from merchants.models import MerchantProfile, MenuItem
from orders.models import Order, OrderItem
from accounts.models import CustomerProfile, User
from notifications.services import send_notification
from notifications.models import Notification
from orders.views import _award_loyalty, _deduct_reward_redemption_points

from .models import (
    PosDevice, ShiftWorker, CashShift, PosPayment,
    PosDiscount, PosAuditLog, ProcessedClientMutation,
    CreditAccount, CreditTransaction,
    DebitAccount, DebitTransaction,
    StaffSchedule, PosCashMovement,
    StaffShift, StaffShiftArea, StaffPreparationArea,
)
from .serializers import (
    PosDeviceSerializer, RegisterDeviceSerializer,
    PosLoginSerializer, PosDeviceRegisterSerializer, PosBootstrapSerializer,
    ShiftWorkerSerializer, CreateWorkerSerializer, UpdateWorkerSerializer,
    WorkerLoginSerializer,
    CashShiftSerializer, OpenShiftSerializer, CloseShiftSerializer,
    StaffShiftSerializer, OpenStaffShiftSerializer, CloseStaffShiftSerializer,
    PosPaymentSerializer, CreatePaymentSerializer, CreateSplitPaymentSerializer,
    PosDiscountSerializer, ApplyDiscountSerializer,
    PosAuditLogSerializer,
    CreditAccountSerializer, CreditSaleSerializer,
    CreditRepaymentSerializer, CreditTransactionSerializer,
    DebitAccountSerializer, DebitTopupSerializer, DebitPurchaseSerializer,
    DebitAdjustmentSerializer, DebitTransactionSerializer,
    PosSettingsSerializer,
    PosCashMovementSerializer, CreateCashMovementSerializer,
)
from .permissions import (
    IsMerchantUser, IsPosEnabled, IsPosDevice,
)

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_merchant(request):
    try:
        return request.user.merchant_profile
    except (AttributeError, MerchantProfile.DoesNotExist):
        return None


def _require_pos(merchant):
    if not merchant or not merchant.pos_enabled:
        return False
    return True


def _audit(merchant, action, *, device=None, worker=None, user=None,
           entity_type="", entity_id="", metadata=None):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    if user is not None and not isinstance(user, User):
        user = None
    PosAuditLog.objects.create(
        merchant=merchant,
        device=device,
        worker=worker,
        user=user,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        metadata=metadata or {},
    )


def _notify_safe(**kwargs):
    try:
        send_notification(**kwargs)
    except Exception:
        logger.exception("Notification failed (POS flow continues)")


# ── Health Check ───────────────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def health_check(request):
    return Response({
        "status": "ok",
        "server_time": timezone.now().isoformat(),
        "user_role": request.user.role,
    })


# ══════════════════════════════════════════════════════════════════════════════
# POS LOGIN & BOOTSTRAP (Phase 4)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([AllowAny])
@transaction.atomic
def pos_login(request):
    """
    POS login: merchant authenticates with email/password.
    Returns JWT tokens and merchant info.
    Device must be registered separately after login.
    """
    from django.contrib.auth import authenticate
    from rest_framework_simplejwt.tokens import RefreshToken
    from accounts.models import User

    ser = PosLoginSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    user = authenticate(
        request,
        username=ser.validated_data["email"],
        password=ser.validated_data["password"],
    )

    if user is None:
        return Response(
            {"error": "Invalid credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not user.is_active:
        return Response(
            {"error": "This account is inactive."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not hasattr(user, "merchant_profile"):
        return Response(
            {"error": "This account does not have merchant access."},
            status=status.HTTP_403_FORBIDDEN,
        )

    merchant = user.merchant_profile
    if not merchant.pos_enabled:
        return Response(
            {"error": "POS is not enabled for this merchant."},
            status=status.HTTP_403_FORBIDDEN,
        )

    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    refresh["email"] = user.email

    _audit(merchant, PosAuditLog.ACTION_MERCHANT_LOGIN,
           user=user, entity_type="merchant", entity_id=merchant.id)

    return Response({
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "merchant": {
            "id": merchant.id,
            "business_name": merchant.business_name,
            "slug": merchant.slug,
            "logo_url": merchant.logo_url,
            "pos_enabled": merchant.pos_enabled,
            "offline_pos_enabled": merchant.offline_pos_enabled,
            "shift_management_enabled": merchant.shift_management_enabled,
            "discounts_enabled": merchant.discounts_enabled,
            "credit_accounts_enabled": merchant.credit_accounts_enabled,
            "debit_accounts_enabled": merchant.debit_accounts_enabled,
            "receipt_printing_enabled": merchant.receipt_printing_enabled,
            "currency_code": merchant.currency_code,
            "currency_symbol": merchant.currency_symbol,
        },
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def pos_device_authorize(request):
    """
    Authorize a POS device after merchant login.
    If device_token is provided, re-authorize existing device.
    Otherwise register a new device.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = PosDeviceRegisterSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    existing_token = ser.validated_data.get("device_token", "")

    if existing_token:
        # Re-authorize: find device by token hash
        from .models import _hash_token
        token_hash = _hash_token(existing_token)
        try:
            device = PosDevice.objects.get(
                device_token_hash=token_hash,
                merchant=merchant,
            )
        except PosDevice.DoesNotExist:
            return Response(
                {"error": "Invalid device token. Please register a new device."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not device.is_active:
            device.is_active = True
            device.last_seen_at = timezone.now()
            device.save(update_fields=["is_active", "last_seen_at", "updated_at"])
        else:
            device.last_seen_at = timezone.now()
            device.save(update_fields=["last_seen_at", "updated_at"])

        _audit(merchant, PosAuditLog.ACTION_DEVICE_REGISTER,
               device=device, user=request.user,
               entity_type="pos_device", entity_id=device.id,
               metadata={"action": "re_authorize"})

        return Response({
            "device": PosDeviceSerializer(device).data,
            "device_token": existing_token,
        })

    # Register new device
    device, token = PosDevice.register(
        merchant=merchant,
        name=ser.validated_data["name"],
        platform=ser.validated_data.get("platform", ""),
        user_agent=ser.validated_data.get("user_agent", ""),
    )

    _audit(merchant, PosAuditLog.ACTION_DEVICE_REGISTER,
           device=device, user=request.user,
           entity_type="pos_device", entity_id=device.id,
           metadata={"name": device.name, "platform": device.platform})

    return Response({
        "device": PosDeviceSerializer(device).data,
        "device_token": token,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def pos_bootstrap(request):
    """
    Bootstrap the POS terminal with all data needed for offline readiness.
    Returns: workers, menu, settings, active shift, recent orders.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    device_id = request.data.get("device_id")
    if not device_id:
        return Response({"error": "device_id is required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        device = PosDevice.objects.get(
            id=device_id, merchant=merchant, is_active=True,
        )
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found or deactivated."},
                        status=status.HTTP_404_NOT_FOUND)

    device.last_seen_at = timezone.now()
    device.save(update_fields=["last_seen_at", "updated_at"])

    # Workers
    workers = ShiftWorker.objects.filter(merchant=merchant, is_active=True)
    workers_data = []
    for w in workers:
        workers_data.append({
            "id": str(w.id),
            "display_name": w.display_name,
            "role": w.role,
            "can_apply_discount": w.can_apply_discount,
            "can_process_refund": w.can_process_refund,
            "can_close_shift": w.can_close_shift,
            "can_view_reports": w.can_view_reports,
        })

    # Menu items
    items = MenuItem.objects.filter(merchant=merchant).order_by("category", "name")
    categories = {}
    for item in items:
        cat = item.category or "Uncategorized"
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "price": str(item.price),
            "image_url": item.image_url,
            "category": item.category,
            "is_available": item.is_available,
            "is_featured": item.is_featured,
            "loyalty_reward": item.loyalty_reward,
            "points_per_item": item.points_per_item,
            "emoji": item.emoji,
        })

    # Active shift for this device
    active_shift = CashShift.objects.filter(
        merchant=merchant, device=device, status=CashShift.STATUS_OPEN,
    ).first()

    # POS settings
    pos_settings = {
        "pos_enabled": merchant.pos_enabled,
        "offline_pos_enabled": merchant.offline_pos_enabled,
        "shift_management_enabled": merchant.shift_management_enabled,
        "discounts_enabled": merchant.discounts_enabled,
        "credit_accounts_enabled": merchant.credit_accounts_enabled,
        "debit_accounts_enabled": merchant.debit_accounts_enabled,
        "receipt_printing_enabled": merchant.receipt_printing_enabled,
        "max_worker_discount_percent": str(merchant.max_worker_discount_percent),
        "manager_approval_threshold": str(merchant.manager_approval_threshold),
        "offline_discounts_allowed": merchant.offline_discounts_allowed,
        "offline_credit_allowed": merchant.offline_credit_allowed,
        "tax_rate_percent": str(merchant.tax_rate_percent or 0),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "tax_components": merchant.tax_components or [],
    }

    # Tables
    from merchants.models import MerchantTable
    tables = MerchantTable.objects.filter(merchant=merchant, is_active=True)
    tables_data = [
        {"id": t.id, "name": t.name, "table_number": t.table_number, "public_token": t.public_token}
        for t in tables
    ]

    # Recent orders for this device (last 20)
    recent_orders = Order.objects.filter(
        merchant=merchant,
    ).select_related("customer__user").prefetch_related("items")[:20]

    from orders.serializers import OrderSerializer
    recent_orders_data = OrderSerializer(recent_orders, many=True, context={"request": request}).data

    # Incoming orders (pending/confirmed from online sources)
    incoming_orders = Order.objects.filter(
        merchant=merchant,
        source__in=["customer_app", "table_qr"],
        status__in=["pending", "confirmed"],
    ).select_related("customer__user").prefetch_related("items")[:20]
    incoming_orders_data = OrderSerializer(incoming_orders, many=True, context={"request": request}).data

    # Update last sync time
    device.last_sync_at = timezone.now()
    device.save(update_fields=["last_sync_at", "updated_at"])

    return Response({
        "merchant": {
            "id": merchant.id,
            "business_name": merchant.business_name,
            "slug": merchant.slug,
            "logo_url": merchant.logo_url,
        },
        "device": PosDeviceSerializer(device).data,
        "workers": workers_data,
        "menu": {
            "snapshot_at": timezone.now().isoformat(),
            "total_items": items.count(),
            "categories": categories,
        },
        "tables": tables_data,
        "active_shift": CashShiftSerializer(active_shift).data if active_shift else None,
        "pos_settings": pos_settings,
        "recent_orders": recent_orders_data,
        "incoming_orders": incoming_orders_data,
    })


@api_view(["GET"])
@permission_classes([IsPosDevice])
@throttle_classes([])
def pos_bootstrap_device(request):
    """
    Bootstrap POS terminal using device token auth (no JWT required).
    Used for session persistence across page refreshes.

    Headers: X-Pos-Device-Id, X-Pos-Device-Token
    """
    device = request.pos_device
    merchant = request.pos_merchant

    # Workers
    workers = ShiftWorker.objects.filter(merchant=merchant, is_active=True)
    workers_data = []
    for w in workers:
        workers_data.append({
            "id": str(w.id),
            "display_name": w.display_name,
            "role": w.role,
            "can_apply_discount": w.can_apply_discount,
            "can_process_refund": w.can_process_refund,
            "can_close_shift": w.can_close_shift,
            "can_view_reports": w.can_view_reports,
        })

    # Menu items
    items = MenuItem.objects.filter(merchant=merchant).order_by("category", "name")
    categories = {}
    for item in items:
        cat = item.category or "Uncategorized"
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "price": str(item.price),
            "image_url": item.image_url,
            "category": item.category,
            "is_available": item.is_available,
            "is_featured": item.is_featured,
            "loyalty_reward": item.loyalty_reward,
            "points_per_item": item.points_per_item,
            "emoji": item.emoji,
        })

    # Active shift for this device
    active_shift = CashShift.objects.filter(
        merchant=merchant, device=device, status=CashShift.STATUS_OPEN,
    ).first()

    # POS settings
    pos_settings = {
        "pos_enabled": merchant.pos_enabled,
        "offline_pos_enabled": merchant.offline_pos_enabled,
        "shift_management_enabled": merchant.shift_management_enabled,
        "discounts_enabled": merchant.discounts_enabled,
        "credit_accounts_enabled": merchant.credit_accounts_enabled,
        "debit_accounts_enabled": merchant.debit_accounts_enabled,
        "receipt_printing_enabled": merchant.receipt_printing_enabled,
        "max_worker_discount_percent": str(merchant.max_worker_discount_percent),
        "manager_approval_threshold": str(merchant.manager_approval_threshold),
        "offline_discounts_allowed": merchant.offline_discounts_allowed,
        "offline_credit_allowed": merchant.offline_credit_allowed,
        "tax_rate_percent": str(merchant.tax_rate_percent or 0),
        "currency_code": merchant.currency_code,
        "currency_symbol": merchant.currency_symbol,
        "tax_components": merchant.tax_components or [],
    }

    # Tables
    from merchants.models import MerchantTable
    tables = MerchantTable.objects.filter(merchant=merchant, is_active=True)
    tables_data = [
        {"id": t.id, "name": t.name, "table_number": t.table_number, "public_token": t.public_token}
        for t in tables
    ]

    # Recent orders (last 20)
    recent_orders = Order.objects.filter(
        merchant=merchant,
    ).select_related("customer__user").prefetch_related("items")[:20]

    from orders.serializers import OrderSerializer
    recent_orders_data = OrderSerializer(recent_orders, many=True, context={"request": request}).data

    # Incoming orders (pending/confirmed from online sources)
    incoming_orders = Order.objects.filter(
        merchant=merchant,
        source__in=["customer_app", "table_qr"],
        status__in=["pending", "confirmed"],
    ).select_related("customer__user").prefetch_related("items")[:20]
    incoming_orders_data = OrderSerializer(incoming_orders, many=True, context={"request": request}).data

    device.last_sync_at = timezone.now()
    device.save(update_fields=["last_sync_at", "updated_at"])

    return Response({
        "merchant": {
            "id": merchant.id,
            "business_name": merchant.business_name,
            "slug": merchant.slug,
            "logo_url": merchant.logo_url,
        },
        "device": PosDeviceSerializer(device).data,
        "workers": workers_data,
        "menu": {
            "snapshot_at": timezone.now().isoformat(),
            "total_items": items.count(),
            "categories": categories,
        },
        "tables": tables_data,
        "active_shift": CashShiftSerializer(active_shift).data if active_shift else None,
        "pos_settings": pos_settings,
        "recent_orders": recent_orders_data,
        "incoming_orders": incoming_orders_data,
    })


# ══════════════════════════════════════════════════════════════════════════════
# DEVICE MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def register_device(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled for this merchant."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = RegisterDeviceSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    device, token = PosDevice.register(
        merchant=merchant,
        name=ser.validated_data["name"],
        platform=ser.validated_data.get("platform", ""),
        user_agent=ser.validated_data.get("user_agent", ""),
    )

    _audit(merchant, PosAuditLog.ACTION_DEVICE_REGISTER,
           device=device, user=request.user,
           entity_type="pos_device", entity_id=device.id,
           metadata={"name": device.name, "platform": device.platform})

    return Response({
        "device": PosDeviceSerializer(device).data,
        "device_token": token,
    }, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser])
def verify_device(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant profile not found."},
                        status=status.HTTP_404_NOT_FOUND)

    device_id = request.data.get("device_id")
    device_token = request.data.get("device_token")

    if not device_id or not device_token:
        return Response(
            {"error": "device_id and device_token are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        device = PosDevice.objects.get(id=device_id, merchant=merchant)
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if not device.is_active:
        return Response({"error": "This device has been deactivated."},
                        status=status.HTTP_403_FORBIDDEN)

    if not device.verify_token(device_token):
        return Response({"error": "Invalid device token."},
                        status=status.HTTP_403_FORBIDDEN)

    device.last_seen_at = timezone.now()
    device.save(update_fields=["last_seen_at", "updated_at"])

    return Response({"device": PosDeviceSerializer(device).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_devices(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )
    devices = PosDevice.objects.filter(merchant=merchant)
    return Response(PosDeviceSerializer(devices, many=True).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def deactivate_device(request, device_id):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        device = PosDevice.objects.get(id=device_id, merchant=merchant)
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    device.deactivate()

    _audit(merchant, PosAuditLog.ACTION_DEVICE_DEACTIVATE,
           device=device, user=request.user,
           entity_type="pos_device", entity_id=device.id)

    return Response({"status": "deactivated"})


# ══════════════════════════════════════════════════════════════════════════════
# WORKER MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_workers(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )
    workers = ShiftWorker.objects.filter(merchant=merchant, is_active=True)
    return Response(ShiftWorkerSerializer(workers, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def create_worker(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CreateWorkerSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    worker = ShiftWorker.objects.create(
        merchant=merchant,
        display_name=ser.validated_data["display_name"],
        role=ser.validated_data["role"],
        can_apply_discount=ser.validated_data["can_apply_discount"],
        can_process_refund=ser.validated_data["can_process_refund"],
        can_close_shift=ser.validated_data["can_close_shift"],
        can_view_reports=ser.validated_data["can_view_reports"],
    )
    worker.set_pin(ser.validated_data["pin"])
    worker.save(update_fields=["pin_hash"])

    _audit(merchant, PosAuditLog.ACTION_WORKER_CREATE,
           user=request.user, worker=worker,
           entity_type="shift_worker", entity_id=worker.id,
           metadata={"display_name": worker.display_name, "role": worker.role})

    return Response(ShiftWorkerSerializer(worker).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def update_worker(request, worker_id):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        worker = ShiftWorker.objects.get(id=worker_id, merchant=merchant)
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    ser = UpdateWorkerSerializer(data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    data = ser.validated_data
    pin = data.pop("pin", None)

    for attr, val in data.items():
        setattr(worker, attr, val)
    worker.save()

    if pin:
        worker.set_pin(pin)
        worker.save(update_fields=["pin_hash"])

    _audit(merchant, PosAuditLog.ACTION_WORKER_UPDATE,
           user=request.user, worker=worker,
           entity_type="shift_worker", entity_id=worker.id)

    return Response(ShiftWorkerSerializer(worker).data)


@api_view(["POST"])
@permission_classes([IsPosDevice])
@throttle_classes([ScopedRateThrottle])
def worker_login(request):
    merchant = request.pos_merchant
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = WorkerLoginSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"],
            merchant=merchant,
            is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if not worker.verify_pin(ser.validated_data["pin"]):
        remaining = 5 - worker.failed_pin_attempts
        return Response(
            {"error": f"Invalid PIN. {remaining} attempts remaining."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    _audit(merchant, PosAuditLog.ACTION_WORKER_LOGIN,
           worker=worker, user=request.user,
           entity_type="shift_worker", entity_id=worker.id)

    return Response({
        "worker": ShiftWorkerSerializer(worker).data,
        "message": "Login successful",
    })


worker_login.throttle_scope = "pin"


@api_view(["POST"])
@permission_classes([IsPosDevice])
@throttle_classes([])
def worker_logout(request):
    merchant = request.pos_merchant
    worker_id = request.data.get("worker_id")

    if not worker_id:
        return Response({"error": "worker_id is required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        worker = ShiftWorker.objects.get(id=worker_id, merchant=merchant)
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    _audit(merchant, PosAuditLog.ACTION_WORKER_LOGOUT,
           worker=worker, user=request.user,
           entity_type="shift_worker", entity_id=worker.id)

    return Response({"message": "Logged out"})


# ══════════════════════════════════════════════════════════════════════════════
# SHIFT MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def active_shift(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    device_id = request.query_params.get("device_id")
    if not device_id:
        return Response({"error": "device_id query param required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        device = PosDevice.objects.get(id=device_id, merchant=merchant, is_active=True)
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    shift = CashShift.objects.filter(
        merchant=merchant, device=device, status=CashShift.STATUS_OPEN
    ).first()

    if not shift:
        return Response({"shift": None})

    return Response({"shift": CashShiftSerializer(shift).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def last_closed_shift(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    device_id = request.query_params.get("device_id")
    if not device_id:
        return Response({"error": "device_id query param required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        device = PosDevice.objects.get(id=device_id, merchant=merchant, is_active=True)
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    shift = CashShift.objects.filter(
        merchant=merchant, device=device, status=CashShift.STATUS_CLOSED
    ).order_by("-closed_at").first()

    if not shift:
        return Response({"shift": None})

    return Response({"shift": CashShiftSerializer(shift).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def open_shift(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = OpenShiftSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        device = PosDevice.objects.get(
            id=ser.validated_data["device_id"],
            merchant=merchant, is_active=True,
        )
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"],
            merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    existing = CashShift.objects.filter(
        merchant=merchant, device=device, status=CashShift.STATUS_OPEN
    ).exists()
    if existing:
        return Response(
            {"error": "An open shift already exists for this device. Close it first."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    shift = CashShift.objects.create(
        merchant=merchant,
        device=device,
        opened_by=worker,
        opening_cash=ser.validated_data["opening_cash"],
        client_created_at=ser.validated_data.get("client_created_at"),
    )

    _audit(merchant, PosAuditLog.ACTION_SHIFT_OPEN,
           device=device, worker=worker, user=request.user,
           entity_type="cash_shift", entity_id=shift.id,
           metadata={"opening_cash": str(shift.opening_cash)})

    return Response(CashShiftSerializer(shift).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def close_shift(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CloseShiftSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    shift_id = request.data.get("shift_id")
    if not shift_id:
        return Response({"error": "shift_id is required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        shift = CashShift.objects.get(
            id=shift_id, merchant=merchant, status=CashShift.STATUS_OPEN,
        )
    except CashShift.DoesNotExist:
        return Response({"error": "Open shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"],
            merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Calculate totals from payments
    payments = PosPayment.objects.filter(
        shift=shift, status=PosPayment.STATUS_COMPLETED,
    )
    totals = payments.aggregate(
        total=Sum("amount"),
        total_cash=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CASH)),
        total_card=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CARD)),
        total_other=Sum("amount", exclude=Q(payment_method__in=[
            PosPayment.METHOD_CASH, PosPayment.METHOD_CARD,
        ])),
        order_count=Count("order", distinct=True),
    )

    shift.total_sales = totals["total"] or 0
    shift.total_cash_sales = totals["total_cash"] or 0
    shift.total_card_sales = totals["total_card"] or 0
    shift.total_other_sales = totals["total_other"] or 0
    shift.total_orders = totals["order_count"] or 0

    shift.closing_cash = ser.validated_data["closing_cash"]
    shift.expected_cash = shift.opening_cash + shift.total_cash_sales - shift.cash_payouts + shift.cash_payins
    shift.cash_difference = shift.closing_cash - shift.expected_cash

    shift.closed_by = worker
    shift.closed_at = timezone.now()
    shift.status = CashShift.STATUS_CLOSED
    shift.version += 1
    shift.save()

    _audit(merchant, PosAuditLog.ACTION_SHIFT_CLOSE,
           device=shift.device, worker=worker, user=request.user,
           entity_type="cash_shift", entity_id=shift.id,
           metadata={
               "closing_cash": str(shift.closing_cash),
               "expected_cash": str(shift.expected_cash),
               "difference": str(shift.cash_difference),
               "total_sales": str(shift.total_sales),
           })

    return Response(CashShiftSerializer(shift).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def shift_summary(request):
    """Return live payment totals for a shift (used by the close-screen)."""
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    shift_id = request.query_params.get("shift_id")
    if not shift_id:
        return Response({"error": "shift_id query param required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        shift = CashShift.objects.get(
            id=shift_id, merchant=merchant,
        )
    except CashShift.DoesNotExist:
        return Response({"error": "Shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    totals = PosPayment.objects.filter(
        shift=shift, status=PosPayment.STATUS_COMPLETED,
    ).aggregate(
        total=Sum("amount"),
        total_cash=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CASH)),
        total_card=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CARD)),
        total_other=Sum("amount", exclude=Q(payment_method__in=[
            PosPayment.METHOD_CASH, PosPayment.METHOD_CARD,
        ])),
        order_count=Count("order", distinct=True),
    )

    return Response({
        "total_sales": str(totals["total"] or 0),
        "total_cash_sales": str(totals["total_cash"] or 0),
        "total_card_sales": str(totals["total_card"] or 0),
        "total_other_sales": str(totals["total_other"] or 0),
        "total_orders": totals["order_count"] or 0,
        "opening_cash": str(shift.opening_cash),
        "cash_payouts": str(shift.cash_payouts),
        "cash_payins": str(shift.cash_payins),
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_shifts(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )
    shifts = CashShift.objects.filter(merchant=merchant)[:50]
    return Response(CashShiftSerializer(shifts, many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# STAFF SHIFTS (KDS clock-in/out)
# ══════════════════════════════════════════════════════════════════════════════

def _worker_area_ids(worker, area_ids):
    """
    Return only the preparation areas this worker may be assigned to a shift.

    Managers/admins may cover any area; everyone else is limited to their
    StaffPreparationArea assignments (kitchen staff → kitchen only, etc.).
    """
    if worker.role in (ShiftWorker.ROLE_MANAGER, ShiftWorker.ROLE_ADMIN):
        return list(area_ids)
    allowed = set(
        StaffPreparationArea.objects
        .filter(worker=worker)
        .values_list("preparation_area_id", flat=True)
    )
    return [aid for aid in area_ids if aid in allowed]


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def open_staff_shift(request):
    """
    POST /api/pos/staff-shift/open/
    { worker_id, area_ids: [1, 2], device_id? }

    Starts (or resumes) the worker's KDS shift. Multiple staff may hold
    active shifts simultaneously; each worker has at most one active shift.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = OpenStaffShiftSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    worker = ShiftWorker.objects.filter(
        id=ser.validated_data["worker_id"],
        merchant=merchant, is_active=True,
    ).first()
    if worker is None:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Resume an existing active shift instead of opening a duplicate
    existing = (
        StaffShift.objects
        .filter(worker=worker, status=StaffShift.STATUS_ACTIVE)
        .select_related("worker")
        .prefetch_related("area_assignments__preparation_area")
        .first()
    )
    if existing:
        return Response(StaffShiftSerializer(existing).data)

    area_ids = ser.validated_data.get("area_ids") or []
    allowed_ids = _worker_area_ids(worker, area_ids)

    device = None
    device_id = ser.validated_data.get("device_id")
    if device_id:
        device = PosDevice.objects.filter(
            id=device_id, merchant=merchant, is_active=True,
        ).first()

    shift = StaffShift.objects.create(
        merchant=merchant,
        worker=worker,
        opened_from_device_id=str(device.id) if device else "",
    )
    for area_id in allowed_ids:
        StaffShiftArea.objects.create(shift=shift, preparation_area_id=area_id)

    _audit(merchant, PosAuditLog.ACTION_STAFF_SHIFT_OPEN,
           device=device, worker=worker, user=request.user,
           entity_type="staff_shift", entity_id=shift.id,
           metadata={"area_ids": allowed_ids})

    return Response(StaffShiftSerializer(shift).data,
                    status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def close_staff_shift(request):
    """
    POST /api/pos/staff-shift/close/
    { shift_id, worker_id }

    Only the shift owner, or a manager/admin, may close a shift.
    Closing one staff shift never closes anyone else's shift or a cash drawer.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CloseStaffShiftSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    shift = StaffShift.objects.filter(
        id=ser.validated_data["shift_id"],
        merchant=merchant,
        status=StaffShift.STATUS_ACTIVE,
    ).first()
    if shift is None:
        return Response({"error": "Active staff shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    worker = ShiftWorker.objects.filter(
        id=ser.validated_data["worker_id"],
        merchant=merchant, is_active=True,
    ).first()
    if worker is None:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    is_owner = shift.worker_id == worker.id
    is_authorized = worker.role in (
        ShiftWorker.ROLE_MANAGER, ShiftWorker.ROLE_ADMIN,
    )
    if not (is_owner or is_authorized):
        return Response(
            {"error": "Only the shift owner or a manager can close this shift."},
            status=status.HTTP_403_FORBIDDEN,
        )

    shift.status = StaffShift.STATUS_CLOSED
    shift.closed_at = timezone.now()
    shift.closed_by = worker
    shift.save()

    _audit(merchant, PosAuditLog.ACTION_STAFF_SHIFT_CLOSE,
           worker=worker, user=request.user,
           entity_type="staff_shift", entity_id=shift.id,
           metadata={"closed_by": worker.display_name})

    return Response(StaffShiftSerializer(shift).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def active_staff_shift(request):
    """GET /api/pos/staff-shift/active/?worker_id= — worker's active shift."""
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    worker_id = request.query_params.get("worker_id")
    if not worker_id:
        return Response({"error": "worker_id query param required."},
                        status=status.HTTP_400_BAD_REQUEST)

    shift = (
        StaffShift.objects
        .filter(merchant=merchant, worker_id=worker_id,
                status=StaffShift.STATUS_ACTIVE)
        .select_related("worker")
        .prefetch_related("area_assignments__preparation_area")
        .first()
    )
    if not shift:
        return Response({"shift": None})

    return Response({"shift": StaffShiftSerializer(shift).data})


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_staff_shifts(request):
    """
    GET /api/pos/staff-shifts/?status=active
    All staff shifts for the merchant (who is working where right now).
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    status_param = request.query_params.get("status", "active")
    qs = StaffShift.objects.filter(merchant=merchant)
    if status_param == "active":
        qs = qs.filter(status=StaffShift.STATUS_ACTIVE)

    shifts = (
        qs.select_related("worker")
        .prefetch_related("area_assignments__preparation_area")[:50]
    )
    return Response(StaffShiftSerializer(shifts, many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# POS ORDERS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def create_pos_order(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    data = request.data
    items_data = data.get("items", [])
    if not items_data:
        return Response({"error": "Order must contain at least one item."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Validate shift if shift management is enabled
    shift = None
    if merchant.shift_management_enabled:
        shift_id = data.get("shift_id")
        if not shift_id:
            return Response({"error": "shift_id is required when shift management is enabled."},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            shift = CashShift.objects.get(
                id=shift_id, merchant=merchant, status=CashShift.STATUS_OPEN,
            )
        except CashShift.DoesNotExist:
            return Response({"error": "Open shift not found."},
                            status=status.HTTP_404_NOT_FOUND)

    # Validate worker
    worker = None
    worker_id = data.get("worker_id")
    if worker_id:
        try:
            worker = ShiftWorker.objects.get(
                id=worker_id, merchant=merchant, is_active=True,
            )
        except ShiftWorker.DoesNotExist:
            return Response({"error": "Worker not found."},
                            status=status.HTTP_404_NOT_FOUND)

    # Validate device
    device = None
    device_id = data.get("device_id")
    if device_id:
        try:
            device = PosDevice.objects.get(
                id=device_id, merchant=merchant, is_active=True,
            )
        except PosDevice.DoesNotExist:
            return Response({"error": "Device not found."},
                            status=status.HTTP_404_NOT_FOUND)

    # Resolve table if provided
    table_instance = None
    table_name_snap = ""
    table_number_snap = None
    table_id = data.get("table_id")
    if table_id:
        from merchants.models import MerchantTable
        try:
            table_instance = MerchantTable.objects.get(
                id=table_id, merchant=merchant, is_active=True,
            )
            table_name_snap = table_instance.name
            table_number_snap = table_instance.table_number
        except MerchantTable.DoesNotExist:
            return Response({"error": "Table not found."},
                            status=status.HTTP_404_NOT_FOUND)

    # Calculate totals server-side (never trust frontend totals).
    # Batch-fetch menu items in a single query instead of one per line item.
    item_ids = [item_data.get("menu_item_id") for item_data in items_data]
    menu_items_by_id = {
        mi.id: mi
        for mi in MenuItem.objects.filter(
            id__in=item_ids, merchant=merchant, is_available=True,
        )
    }

    total_amount = 0
    points_earned = 0
    order_items_data = []

    # Determine order type early so staff_comp orders can zero prices
    order_type = data.get("order_type", Order.ORDER_TYPE_REGULAR)
    if order_type not in dict(Order.ORDER_TYPE_CHOICES):
        order_type = Order.ORDER_TYPE_REGULAR
    is_staff_comp = order_type == Order.ORDER_TYPE_STAFF_COMP

    for item_data in items_data:
        menu_item_id = item_data.get("menu_item_id")
        quantity = item_data.get("quantity", 1)

        menu_item = menu_items_by_id.get(menu_item_id)
        if menu_item is None:
            return Response(
                {"error": f"Menu item {menu_item_id} not found or unavailable."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Staff comp orders are free — override price to 0
        item_price = Decimal("0") if is_staff_comp else menu_item.price
        subtotal = item_price * quantity
        total_amount += subtotal

        if menu_item.loyalty_reward and not is_staff_comp:
            points_earned += menu_item.points_per_item * quantity

        order_items_data.append({
            "menu_item": menu_item,
            "name": menu_item.name,
            "price": item_price,
            "quantity": quantity,
            "subtotal": subtotal,
        })

    # Apply spend-based points from LoyaltyRules (points_per_npr)
    try:
        rules = merchant.loyalty_rules
        if rules.points_per_npr > 0:
            points_earned += int(float(total_amount) * rules.points_per_npr)
    except Exception:
        pass

    # Determine order type and source
    customer = None
    fulfillment = data.get("fulfillment_type", Order.FULFILLMENT_PICKUP)
    if fulfillment not in dict(Order.FULFILLMENT_CHOICES):
        fulfillment = Order.FULFILLMENT_PICKUP

    # Walk-in orders can have customer=null
    customer_id = data.get("customer_id")
    if customer_id:
        from accounts.models import CustomerProfile
        try:
            customer = CustomerProfile.objects.get(id=customer_id)
        except CustomerProfile.DoesNotExist:
            return Response({"error": "Customer not found."},
                            status=status.HTTP_404_NOT_FOUND)
        # Ensure customer has a wallet/membership for this merchant
        from loyalty.services import join_merchant
        join_merchant(customer, merchant)

    source = data.get("source", "pos_online")
    if source not in ("pos_online", "pos_offline"):
        source = "pos_online"

    client_mutation_id = data.get("client_mutation_id")
    if client_mutation_id:
        existing = ProcessedClientMutation.objects.filter(
            merchant=merchant,
            client_mutation_id=client_mutation_id,
        ).first()
        if existing:
            # Idempotent — return existing order
            try:
                existing_order = Order.objects.get(id=existing.server_object_id)
                from orders.serializers import OrderSerializer
                return Response(OrderSerializer(existing_order, context={"request": request}).data)
            except Order.DoesNotExist:
                pass

    # Generate sequential KOT number per merchant per day (resets at midnight).
    # Lock the merchant row so two devices can't compute the same count+1.
    from django.utils import timezone as tz
    from merchants.models import MerchantProfile as _MP
    merchant = _MP.objects.select_for_update().get(pk=merchant.pk)
    today_start = tz.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = Order.objects.filter(
        merchant=merchant, created_at__gte=today_start, kot_number__isnull=False,
    ).count()
    kot_number = today_count + 1

    try:
        with transaction.atomic():
            # Apply merchant tax components server-side (never trust frontend totals).
            from config.tax_utils import calculate_tax
            tax_amount, tax_breakdown = calculate_tax(total_amount, merchant)

            order = Order.objects.create(
                customer=customer,
                merchant=merchant,
                subtotal=total_amount,
                tax_amount=tax_amount,
                tax_breakdown=tax_breakdown,
                total_amount=total_amount + tax_amount,
                points_earned=points_earned,
                notes=data.get("notes", ""),
                status=Order.STATUS_CONFIRMED,  # POS orders go directly to confirmed
                order_type=order_type,
                source=source,
                fulfillment_type=fulfillment,
                table=table_instance,
                table_name_snapshot=table_name_snap,
                table_number_snapshot=table_number_snap,
                cash_shift=shift,
                kot_number=kot_number,
            )

            # Apply preparation routing
            from orders.services.preparation import prepare_order_items_for_routing
            order_items_data = prepare_order_items_for_routing(order, order_items_data)

            OrderItem.objects.bulk_create(
                [OrderItem(order=order, **item) for item in order_items_data],
                batch_size=200,
            )

            # Record client mutation for idempotency
            if client_mutation_id:
                ProcessedClientMutation.objects.create(
                    merchant=merchant,
                    device=device or PosDevice.objects.filter(merchant=merchant).first(),
                    client_mutation_id=client_mutation_id,
                    entity_type="order",
                    operation="create",
                    server_object_id=order.id,
                )
    except IntegrityError:
        # Concurrent duplicate submission won the race and the unique
        # (merchant, device, client_mutation_id) constraint fired.
        # Roll back this request and return the order created by the winner.
        from orders.serializers import OrderSerializer
        existing_mutation = ProcessedClientMutation.objects.filter(
            merchant=merchant,
            client_mutation_id=client_mutation_id,
        ).first()
        if existing_mutation and existing_mutation.server_object_id:
            try:
                existing_order = Order.objects.get(id=existing_mutation.server_object_id)
                return Response(OrderSerializer(existing_order, context={"request": request}).data)
            except Order.DoesNotExist:
                pass
        raise

    _audit(merchant, PosAuditLog.ACTION_ORDER_CREATE,
           device=device, worker=worker, user=request.user,
           entity_type="order", entity_id=order.id,
           metadata={
               "source": source,
               "total": str(total_amount),
               "items_count": len(order_items_data),
           })

    from orders.serializers import OrderSerializer
    return Response(OrderSerializer(order, context={"request": request}).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def update_order_status_uuid(request):
    """Update order status by UUID — validates transitions server-side.

    The order row is locked (select_for_update) so two devices can never
    complete the same order twice, which would double-award loyalty points.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    order_id = request.data.get("order_id")
    new_status = request.data.get("status")
    worker_id = request.data.get("worker_id")

    if not order_id or not new_status:
        return Response({"error": "order_id and status are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    if new_status not in dict(Order.STATUS_CHOICES):
        return Response({"error": f"Invalid status: {new_status}."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.select_for_update().get(uuid=order_id, merchant=merchant)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Validate transition
    allowed = Order.VALID_TRANSITIONS.get(order.status, set())
    if new_status not in allowed:
        return Response(
            {"error": f"Cannot transition from '{order.status}' to '{new_status}'."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    worker = None
    if worker_id:
        try:
            worker = ShiftWorker.objects.get(
                id=worker_id, merchant=merchant, is_active=True)
        except ShiftWorker.DoesNotExist:
            pass

    device = None
    device_id = request.data.get("device_id")
    if device_id:
        try:
            device = PosDevice.objects.get(
                id=device_id, merchant=merchant, is_active=True)
        except PosDevice.DoesNotExist:
            pass

    if (
        new_status == Order.STATUS_COMPLETED
        and not order.loyalty_awarded
        and order.customer is not None
        and order.order_type != Order.ORDER_TYPE_REWARD_REDEMPTION
    ):
        _award_loyalty(order)
        order.loyalty_awarded = True

    order.status = new_status
    order.version += 1
    order.save(update_fields=["status", "loyalty_awarded", "version", "updated_at"])

    _audit(merchant, PosAuditLog.ACTION_ORDER_UPDATE,
           device=device, worker=worker, user=request.user,
           entity_type="order", entity_id=order.id,
           metadata={"previous_status": list(allowed), "new_status": new_status})

    from orders.serializers import OrderSerializer
    return Response(OrderSerializer(order, context={"request": request}).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def pos_orders(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    qs = Order.objects.filter(merchant=merchant)

    shift_id = request.query_params.get("shift_id")
    if shift_id:
        # Filter orders by shift — we'll need a shift FK on Order in later phases
        pass

    status_filter = request.query_params.get("status")
    if status_filter:
        qs = qs.filter(status=status_filter)

    qs = qs.select_related(
        "customer__user",
        "merchant",
        "reward_redemption__reward",
        "punch_card_redemption__punch_card",
        "table",
        "processed_by_worker",
        "pos_device",
        "cash_shift",
    ).prefetch_related("items")[:50]

    from orders.serializers import OrderSerializer
    return Response(OrderSerializer(qs, many=True, context={"request": request}).data)


# ══════════════════════════════════════════════════════════════════════════════
# PAYMENTS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def create_payment(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CreatePaymentSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.select_for_update().get(
            uuid=ser.validated_data["order_id"], merchant=merchant,
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        shift = CashShift.objects.get(
            id=ser.validated_data["shift_id"], merchant=merchant,
        )
    except CashShift.DoesNotExist:
        return Response({"error": "Shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        device = PosDevice.objects.get(
            id=ser.validated_data["device_id"], merchant=merchant, is_active=True,
        )
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Block digital payments for offline-synced payments without external reference
    method = ser.validated_data["payment_method"]
    if method in (PosPayment.METHOD_CARD, PosPayment.METHOD_BANK_QR, PosPayment.METHOD_MOBILE_WALLET):
        if not ser.validated_data.get("external_reference"):
            return Response(
                {"error": "Digital payments require an external reference from the payment gateway."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # Idempotency check
    client_mutation_id = ser.validated_data["client_mutation_id"]
    existing = ProcessedClientMutation.objects.filter(
        merchant=merchant, client_mutation_id=client_mutation_id,
    ).first()
    if existing:
        try:
            existing_payment = PosPayment.objects.get(client_mutation_id=client_mutation_id)
            return Response(PosPaymentSerializer(existing_payment).data)
        except PosPayment.DoesNotExist:
            pass

    # Validate debit account BEFORE creating the payment so a failed
    # debit check can never leave an orphan payment row behind.
    debit_account = None
    if method == PosPayment.METHOD_DEBIT:
        debit_account_id = ser.validated_data.get("debit_account_id")
        if not debit_account_id:
            return Response(
                {"error": "debit_account_id is required for debit payments."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            debit_account = DebitAccount.objects.select_for_update().get(
                id=debit_account_id, merchant=merchant, is_active=True,
            )
        except DebitAccount.DoesNotExist:
            return Response(
                {"error": "Debit account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        pay_amount = ser.validated_data["amount"]
        if debit_account.balance < pay_amount:
            return Response(
                {"error": f"Insufficient balance. Available: Rs {debit_account.balance}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    try:
        with transaction.atomic():
            payment = PosPayment.objects.create(
                merchant=merchant,
                order=order,
                shift=shift,
                worker=worker,
                device=device,
                payment_method=method,
                amount=ser.validated_data["amount"],
                status=PosPayment.STATUS_COMPLETED,
                external_reference=ser.validated_data.get("external_reference", ""),
                change_amount=ser.validated_data.get("change_amount", 0),
                client_mutation_id=client_mutation_id,
                client_created_at=ser.validated_data.get("client_created_at", timezone.now()),
            )

            # Deduct from debit account when paying with debit wallet
            if method == PosPayment.METHOD_DEBIT:
                balance_before = debit_account.balance
                debit_account.balance -= pay_amount
                debit_account.save(update_fields=["balance"])
                DebitTransaction.objects.create(
                    account=debit_account,
                    order=order,
                    worker=worker,
                    transaction_type=DebitTransaction.TYPE_PURCHASE,
                    amount=pay_amount,
                    balance_before=balance_before,
                    balance_after=debit_account.balance,
                    note=f"POS payment {payment.id}",
                    client_mutation_id=client_mutation_id,
                )

            # Mark order as paid when total payments >= total amount
            total_paid = PosPayment.objects.filter(
                order=order, status=PosPayment.STATUS_COMPLETED
            ).aggregate(total=Sum("amount"))["total"] or 0
            if total_paid >= order.total_amount:
                order.payment_status = "paid"
                order.payment_method = method
                # Auto-complete and award loyalty
                if order.status not in (Order.STATUS_COMPLETED, Order.STATUS_CANCELLED):
                    order.status = Order.STATUS_COMPLETED
                    if not order.loyalty_awarded and order.customer is not None:
                        _award_loyalty(order)
                        order.loyalty_awarded = True
                order.version += 1
                order.save(update_fields=["payment_status", "payment_method", "status", "loyalty_awarded", "version", "updated_at"])
            elif total_paid > 0:
                order.payment_status = "partially_paid"
                order.version += 1
                order.save(update_fields=["payment_status", "version", "updated_at"])

            # Record idempotency
            ProcessedClientMutation.objects.create(
                merchant=merchant,
                device=device,
                client_mutation_id=client_mutation_id,
                entity_type="payment",
                operation="create",
                server_object_id=payment.id,
            )
    except IntegrityError:
        # A concurrent duplicate (double-tap / retried offline sync) already
        # created this payment. Roll back this attempt and return the winner's
        # payment instead of raising a 500.
        existing_payment = PosPayment.objects.filter(
            client_mutation_id=client_mutation_id,
        ).first()
        if existing_payment:
            return Response(PosPaymentSerializer(existing_payment).data)
        raise

    _audit(merchant, PosAuditLog.ACTION_PAYMENT,
           device=device, worker=worker, user=request.user,
           entity_type="pos_payment", entity_id=payment.id,
           metadata={"method": method, "amount": str(payment.amount)})

    return Response(PosPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_payments(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    shift_id = request.query_params.get("shift_id")
    qs = PosPayment.objects.filter(merchant=merchant)
    if shift_id:
        qs = qs.filter(shift_id=shift_id)

    return Response(PosPaymentSerializer(qs[:50], many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# SPLIT PAYMENTS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def create_split_payment(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CreateSplitPaymentSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.select_for_update().get(
            uuid=ser.validated_data["order_id"], merchant=merchant,
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        shift = CashShift.objects.get(
            id=ser.validated_data["shift_id"], merchant=merchant,
        )
    except CashShift.DoesNotExist:
        return Response({"error": "Shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        device = PosDevice.objects.get(
            id=ser.validated_data["device_id"], merchant=merchant, is_active=True,
        )
    except PosDevice.DoesNotExist:
        return Response({"error": "Device not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Validate total payments match order total
    payments_data = ser.validated_data["payments"]
    total_payments = sum(p["amount"] for p in payments_data)

    # Get total already paid for this order
    already_paid = PosPayment.objects.filter(
        order=order, status=PosPayment.STATUS_COMPLETED,
    ).aggregate(total=Sum("amount"))["total"] or 0

    order_payable = order.total_amount - already_paid
    change = ser.validated_data.get("change_amount", 0)
    net_payment = total_payments - change

    if net_payment != order_payable:
        return Response(
            {
                "error": f"Split total ({total_payments}) minus change ({change}) = {net_payment}, "
                         f"but order payable is {order_payable}.",
                "order_payable": str(order_payable),
                "already_paid": str(already_paid),
                "total_payments": str(total_payments),
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Block digital payments without external reference
    for p in payments_data:
        if p["payment_method"] in (PosPayment.METHOD_CARD, PosPayment.METHOD_BANK_QR, PosPayment.METHOD_MOBILE_WALLET):
            if not p.get("external_reference"):
                return Response(
                    {"error": f"Digital payment ({p['payment_method']}) requires an external reference."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

    created_payments = []
    for p in payments_data:
        payment = PosPayment.objects.create(
            merchant=merchant,
            order=order,
            shift=shift,
            worker=worker,
            device=device,
            payment_method=p["payment_method"],
            amount=p["amount"],
            status=PosPayment.STATUS_COMPLETED,
            external_reference=p.get("external_reference", ""),
            change_amount=0,
            client_mutation_id=uuid.uuid4(),
            client_created_at=ser.validated_data.get("client_created_at", timezone.now()),
        )
        created_payments.append(payment)

        _audit(merchant, PosAuditLog.ACTION_PAYMENT,
               device=device, worker=worker, user=request.user,
               entity_type="pos_payment", entity_id=payment.id,
               metadata={"method": p["payment_method"], "amount": str(payment.amount), "split": True})

    # Update order payment status
    total_all_paid = already_paid + total_payments
    if total_all_paid >= order.total_amount:
        order.payment_status = "paid"
        order.payment_method = "split"
        # Auto-complete and award loyalty
        if order.status not in (Order.STATUS_COMPLETED, Order.STATUS_CANCELLED):
            order.status = Order.STATUS_COMPLETED
            if not order.loyalty_awarded and order.customer is not None:
                _award_loyalty(order)
                order.loyalty_awarded = True
        order.version += 1
        order.save(update_fields=["payment_status", "payment_method", "status", "loyalty_awarded", "version", "updated_at"])

    return Response({
        "payments": PosPaymentSerializer(created_payments, many=True).data,
        "total_paid": str(total_all_paid),
        "remaining": str(max(0, order.total_amount - total_all_paid)),
        "order_payment_status": order.payment_status,
    }, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# DISCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def apply_discount(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if not merchant.discounts_enabled:
        return Response(
            {"error": "Discounts are not enabled for this merchant."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = ApplyDiscountSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.get(
            uuid=ser.validated_data["order_id"], merchant=merchant,
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if not worker.can_apply_discount:
        return Response(
            {"error": "This worker does not have permission to apply discounts."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Block discounts on completed or cancelled orders
    if order.status in (Order.STATUS_COMPLETED, Order.STATUS_CANCELLED):
        return Response(
            {"error": "Cannot apply discount to a completed or cancelled order."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Block discounts on already-paid orders
    if order.payment_status == "paid":
        return Response(
            {"error": "Cannot apply discount to an already paid order."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Block offline discounts when merchant disallows it
    source = request.data.get("source", "")
    if source == "pos_offline" and not merchant.offline_discounts_allowed:
        return Response(
            {"error": "Offline discounts are not allowed for this merchant."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Calculate discount amount server-side
    discount_type = ser.validated_data["discount_type"]
    discount_value = ser.validated_data["discount_value"]
    effective_subtotal = order.subtotal or order.total_amount

    if discount_type == PosDiscount.TYPE_PERCENTAGE:
        if discount_value > 100:
            return Response({"error": "Percentage cannot exceed 100%."},
                            status=status.HTTP_400_BAD_REQUEST)
        if merchant.max_worker_discount_percent and discount_value > merchant.max_worker_discount_percent:
            authorized_by_id = ser.validated_data.get("authorized_by_worker_id")
            if not authorized_by_id:
                return Response(
                    {"error": f"Discount exceeds max ({merchant.max_worker_discount_percent}%). Manager approval required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        discount_amount = effective_subtotal * discount_value / 100
    else:
        discount_amount = discount_value
        if discount_amount > effective_subtotal:
            return Response(
                {"error": f"Fixed discount ({discount_amount}) cannot exceed order subtotal ({effective_subtotal})."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    authorized_by = None
    authorized_by_id = ser.validated_data.get("authorized_by_worker_id")
    if authorized_by_id:
        try:
            authorized_by = ShiftWorker.objects.get(
                id=authorized_by_id, merchant=merchant, is_active=True,
            )
        except ShiftWorker.DoesNotExist:
            return Response({"error": "Authorizing worker not found."},
                            status=status.HTTP_404_NOT_FOUND)

    discount = PosDiscount.objects.create(
        merchant=merchant,
        order=order,
        worker=worker,
        discount_type=discount_type,
        discount_value=discount_value,
        discount_amount=discount_amount,
        reason=ser.validated_data.get("reason", ""),
        authorized_by=authorized_by,
    )

    # Update order discount fields and recalculate total
    order.subtotal = effective_subtotal
    order.discount_type = discount_type
    order.discount_value = discount_value
    order.discount_amount = discount_amount
    order.total_amount = effective_subtotal - discount_amount + order.tax_amount + order.service_charge
    order.version += 1
    order.save(update_fields=[
        "subtotal", "discount_type", "discount_value", "discount_amount",
        "total_amount", "version", "updated_at",
    ])

    _audit(merchant, PosAuditLog.ACTION_DISCOUNT_APPLY,
           worker=worker, user=request.user,
           entity_type="pos_discount", entity_id=discount.id,
           metadata={
               "order_id": str(order.id),
               "type": discount_type,
               "value": str(discount_value),
               "amount": str(discount_amount),
           })

    return Response(PosDiscountSerializer(discount).data, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# CASH MOVEMENTS (Pay-in / Pay-out / Cash Drop)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def create_cash_movement(request):
    """
    Record a cash movement (pay-in, pay-out, or cash drop) during an active shift.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    ser = CreateCashMovementSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        shift = CashShift.objects.get(
            id=ser.validated_data["shift_id"],
            merchant=merchant,
            status=CashShift.STATUS_OPEN,
        )
    except CashShift.DoesNotExist:
        return Response({"error": "Open shift not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"],
            merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    movement = PosCashMovement.objects.create(
        shift=shift,
        worker=worker,
        movement_type=ser.validated_data["movement_type"],
        amount=ser.validated_data["amount"],
        reason=ser.validated_data.get("reason", ""),
    )

    # Update shift totals
    mt = ser.validated_data["movement_type"]
    amt = ser.validated_data["amount"]
    if mt == PosCashMovement.TYPE_PAYOUT:
        shift.cash_payouts = shift.cash_payouts + amt
    elif mt in (PosCashMovement.TYPE_PAYIN, PosCashMovement.TYPE_CASHDROP):
        shift.cash_payins = shift.cash_payins + amt
    shift.save(update_fields=["cash_payouts", "cash_payins"])

    _audit(merchant, PosAuditLog.ACTION_PAYMENT,
           device=shift.device, worker=worker, user=request.user,
           entity_type="cash_movement", entity_id=movement.id,
           metadata={"type": mt, "amount": str(amt), "reason": movement.reason})

    return Response(PosCashMovementSerializer(movement).data,
                    status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_cash_movements(request):
    """
    List cash movements for a shift.
    ?shift_id=<uuid> — filter by shift
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    shift_id = request.query_params.get("shift_id")
    qs = PosCashMovement.objects.filter(shift__merchant=merchant)
    if shift_id:
        qs = qs.filter(shift_id=shift_id)

    return Response(PosCashMovementSerializer(qs[:50], many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# CREDIT ACCOUNTS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_credit_accounts(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.credit_accounts_enabled:
        return Response(
            {"error": "Credit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if request.method == "POST":
        ser = CreditAccountSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        account = ser.save(merchant=merchant)
        return Response(
            CreditAccountSerializer(account).data,
            status=status.HTTP_201_CREATED,
        )
    accounts = CreditAccount.objects.filter(merchant=merchant, is_active=True)
    return Response(CreditAccountSerializer(accounts, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def credit_sale(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.credit_accounts_enabled:
        return Response(
            {"error": "Credit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CreditSaleSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        account = CreditAccount.objects.get(
            id=ser.validated_data["account_id"], merchant=merchant, is_active=True,
        )
    except CreditAccount.DoesNotExist:
        return Response({"error": "Credit account not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if account.available_credit < ser.validated_data["amount"]:
        return Response(
            {"error": f"Insufficient credit. Available: {account.available_credit}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        order = Order.objects.get(
            uuid=ser.validated_data["order_id"], merchant=merchant,
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    amount = ser.validated_data["amount"]
    balance_before = account.current_balance
    account.current_balance += amount
    account.save(update_fields=["current_balance", "updated_at"])

    transaction_obj = CreditTransaction.objects.create(
        account=account,
        order=order,
        worker=worker,
        transaction_type=CreditTransaction.TYPE_SALE,
        amount=amount,
        balance_before=balance_before,
        balance_after=account.current_balance,
        note=ser.validated_data.get("note", ""),
        client_mutation_id=ser.validated_data.get("client_mutation_id"),
    )

    _audit(merchant, PosAuditLog.ACTION_CREDIT_SALE,
           worker=worker, user=request.user,
           entity_type="credit_transaction", entity_id=transaction_obj.id,
           metadata={"account_id": str(account.id), "amount": str(amount)})

    return Response(CreditTransactionSerializer(transaction_obj).data,
                    status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def credit_repayment(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.credit_accounts_enabled:
        return Response(
            {"error": "Credit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = CreditRepaymentSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        account = CreditAccount.objects.get(
            id=ser.validated_data["account_id"], merchant=merchant, is_active=True,
        )
    except CreditAccount.DoesNotExist:
        return Response({"error": "Credit account not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    amount = ser.validated_data["amount"]
    balance_before = account.current_balance
    account.current_balance = max(0, account.current_balance - amount)
    account.save(update_fields=["current_balance", "updated_at"])

    transaction_obj = CreditTransaction.objects.create(
        account=account,
        worker=worker,
        transaction_type=CreditTransaction.TYPE_REPAYMENT,
        amount=amount,
        balance_before=balance_before,
        balance_after=account.current_balance,
        note=ser.validated_data.get("note", ""),
        client_mutation_id=ser.validated_data.get("client_mutation_id"),
    )

    _audit(merchant, PosAuditLog.ACTION_CREDIT_REPAY,
           worker=worker, user=request.user,
           entity_type="credit_transaction", entity_id=transaction_obj.id,
           metadata={"account_id": str(account.id), "amount": str(amount)})

    return Response(CreditTransactionSerializer(transaction_obj).data,
                    status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# DEBIT ACCOUNTS (Prepaid / Wallet)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_debit_accounts(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.debit_accounts_enabled:
        return Response(
            {"error": "Debit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if request.method == "POST":
        ser = DebitAccountSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        initial_balance = ser.validated_data.pop("initial_balance", 0)
        account = ser.save(merchant=merchant, balance=initial_balance)
        return Response(
            DebitAccountSerializer(account).data,
            status=status.HTTP_201_CREATED,
        )
    accounts = DebitAccount.objects.filter(merchant=merchant, is_active=True)
    return Response(DebitAccountSerializer(accounts, many=True).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def debit_topup(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.debit_accounts_enabled:
        return Response(
            {"error": "Debit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = DebitTopupSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        account = DebitAccount.objects.get(
            id=ser.validated_data["account_id"], merchant=merchant, is_active=True,
        )
    except DebitAccount.DoesNotExist:
        return Response({"error": "Debit account not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    amount = ser.validated_data["amount"]
    balance_before = account.balance
    account.balance += amount
    account.save(update_fields=["balance", "updated_at"])

    transaction_obj = DebitTransaction.objects.create(
        account=account,
        worker=worker,
        transaction_type=DebitTransaction.TYPE_TOPUP,
        amount=amount,
        balance_before=balance_before,
        balance_after=account.balance,
        note=ser.validated_data.get("note", ""),
        client_mutation_id=ser.validated_data.get("client_mutation_id"),
    )

    _audit(merchant, PosAuditLog.ACTION_DEBIT_TOPUP,
           worker=worker, user=request.user,
           entity_type="debit_transaction", entity_id=transaction_obj.id,
           metadata={"account_id": str(account.id), "amount": str(amount)})

    return Response(DebitTransactionSerializer(transaction_obj).data,
                    status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def debit_purchase(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.debit_accounts_enabled:
        return Response(
            {"error": "Debit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = DebitPurchaseSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        account = DebitAccount.objects.get(
            id=ser.validated_data["account_id"], merchant=merchant, is_active=True,
        )
    except DebitAccount.DoesNotExist:
        return Response({"error": "Debit account not found."},
                        status=status.HTTP_404_NOT_FOUND)

    if account.balance < ser.validated_data["amount"]:
        return Response(
            {"error": f"Insufficient balance. Available: {account.balance}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        order = Order.objects.get(
            uuid=ser.validated_data["order_id"], merchant=merchant,
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    amount = ser.validated_data["amount"]
    balance_before = account.balance
    account.balance -= amount
    account.save(update_fields=["balance", "updated_at"])

    transaction_obj = DebitTransaction.objects.create(
        account=account,
        order=order,
        worker=worker,
        transaction_type=DebitTransaction.TYPE_PURCHASE,
        amount=amount,
        balance_before=balance_before,
        balance_after=account.balance,
        note=ser.validated_data.get("note", ""),
        client_mutation_id=ser.validated_data.get("client_mutation_id"),
    )

    _audit(merchant, PosAuditLog.ACTION_DEBIT_PURCHASE,
           worker=worker, user=request.user,
           entity_type="debit_transaction", entity_id=transaction_obj.id,
           metadata={"account_id": str(account.id), "amount": str(amount)})

    return Response(DebitTransactionSerializer(transaction_obj).data,
                    status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def debit_adjustment(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant) or not merchant.debit_accounts_enabled:
        return Response(
            {"error": "Debit accounts not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    ser = DebitAdjustmentSerializer(data=request.data)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    try:
        account = DebitAccount.objects.get(
            id=ser.validated_data["account_id"], merchant=merchant, is_active=True,
        )
    except DebitAccount.DoesNotExist:
        return Response({"error": "Debit account not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=ser.validated_data["worker_id"], merchant=merchant, is_active=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    amount = ser.validated_data["amount"]
    balance_before = account.balance
    new_balance = account.balance + amount

    if new_balance < 0:
        return Response(
            {"error": f"Adjustment would result in negative balance ({new_balance})"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    account.balance = new_balance
    account.save(update_fields=["balance", "updated_at"])

    transaction_obj = DebitTransaction.objects.create(
        account=account,
        worker=worker,
        transaction_type=DebitTransaction.TYPE_ADJUSTMENT,
        amount=amount,
        balance_before=balance_before,
        balance_after=account.balance,
        note=ser.validated_data.get("note", ""),
        client_mutation_id=ser.validated_data.get("client_mutation_id"),
    )

    _audit(merchant, PosAuditLog.ACTION_DEBIT_ADJUSTMENT,
           worker=worker, user=request.user,
           entity_type="debit_transaction", entity_id=transaction_obj.id,
           metadata={"account_id": str(account.id), "amount": str(amount)})

    return Response(DebitTransactionSerializer(transaction_obj).data,
                    status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# POS SETTINGS
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def pos_settings(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."},
                        status=status.HTTP_404_NOT_FOUND)

    return Response(PosSettingsSerializer(merchant).data)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def update_pos_settings(request):
    merchant = _get_merchant(request)
    if not merchant:
        return Response({"error": "Merchant not found."},
                        status=status.HTTP_404_NOT_FOUND)

    ser = PosSettingsSerializer(data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

    data = ser.validated_data

    # Validate tax_components format
    tax_components = data.pop("tax_components", None)
    if tax_components is not None:
        validated_components = []
        for comp in tax_components:
            name = str(comp.get("name", "Tax")).strip()[:50]
            rate = comp.get("rate", 0)
            try:
                rate = float(rate)
            except (TypeError, ValueError):
                continue
            if rate < 0 or rate > 100:
                continue
            validated_components.append({"name": name, "rate": rate})
        merchant.tax_components = validated_components

    for attr, val in data.items():
        setattr(merchant, attr, val)
    merchant.save()

    return Response(PosSettingsSerializer(merchant).data)


# ══════════════════════════════════════════════════════════════════════════════
# MENU SNAPSHOT (for offline bootstrap)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def menu_snapshot(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    items = MenuItem.objects.filter(merchant=merchant).order_by("category", "name")

    # Group by category
    categories = {}
    for item in items:
        cat = item.category or "Uncategorized"
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "price": str(item.price),
            "image_url": item.image_url,
            "category": item.category,
            "is_available": item.is_available,
            "is_featured": item.is_featured,
            "loyalty_reward": item.loyalty_reward,
            "points_per_item": item.points_per_item,
            "emoji": item.emoji,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        })

    return Response({
        "merchant_id": merchant.id,
        "merchant_name": merchant.business_name,
        "snapshot_at": timezone.now().isoformat(),
        "total_items": items.count(),
        "categories": categories,
    })


# ══════════════════════════════════════════════════════════════════════════════
# AUDIT LOG
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def audit_logs(request):
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    qs = PosAuditLog.objects.filter(merchant=merchant)

    action_filter = request.query_params.get("action")
    if action_filter:
        qs = qs.filter(action=action_filter)

    return Response(PosAuditLogSerializer(qs[:100], many=True).data)


# ══════════════════════════════════════════════════════════════════════════════
# RECEIPTS & BILLS (Phase 12)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def receipt_data(request, order_id):
    """
    Returns all data needed to render a bill (pre-payment) or receipt (post-payment).
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        order = (
            Order.objects
            .select_related("customer__user", "merchant", "table",
                            "processed_by_worker", "pos_device", "cash_shift")
            .prefetch_related("items", "pos_payments", "pos_discounts")
            .get(uuid=order_id, merchant=merchant)
        )
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    # Items
    items = [
        {
            "name": item.name,
            "price": str(item.price),
            "quantity": item.quantity,
            "subtotal": str(item.subtotal),
        }
        for item in order.items.all()
    ]

    # Discounts
    discounts = [
        {
            "type": d.discount_type,
            "value": str(d.discount_value),
            "amount": str(d.discount_amount),
            "reason": d.reason,
            "authorized_by": d.authorized_by.display_name if d.authorized_by else None,
        }
        for d in order.pos_discounts.all()
    ]

    # Payments
    payments = [
        {
            "method": p.payment_method,
            "amount": str(p.amount),
            "status": p.status,
            "external_reference": p.external_reference,
            "change_amount": str(p.change_amount),
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in order.pos_payments.filter(status=PosPayment.STATUS_COMPLETED)
    ]

    total_paid = sum(p.amount for p in order.pos_payments.filter(status=PosPayment.STATUS_COMPLETED))
    change = sum(p.change_amount for p in order.pos_payments.filter(status=PosPayment.STATUS_COMPLETED))

    # Is this a pre-payment bill or post-payment receipt?
    is_paid = order.payment_status == "paid"

    receipt_type = "receipt" if is_paid else "bill"

    return Response({
        "type": receipt_type,
        "order_id": order.id,
        "order_uuid": str(order.uuid),
        "order_number": f"#{order.id}",
        "kot_number": order.kot_number,
        "status": order.status,
        "source": order.source,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "client_created_at": order.client_created_at.isoformat() if order.client_created_at else None,

        "merchant": {
            "id": merchant.id,
            "name": merchant.business_name,
            "address": merchant.address,
            "phone": merchant.phone,
            "logo_url": merchant.logo_url,
        },

        "table": {
            "name": order.table_name_snapshot,
            "number": order.table_number_snapshot,
        } if order.table else None,

        "fulfillment_type": order.fulfillment_type,
        "customer_name": order.customer.full_name if order.customer else None,
        "worker_name": order.processed_by_worker.display_name if order.processed_by_worker else None,

        "items": items,
        "subtotal": str(order.subtotal or order.total_amount),
        "discounts": discounts,
        "discount_amount": str(order.discount_amount),
        "tax_amount": str(order.tax_amount),
        "tax_breakdown": order.tax_breakdown or [],
        "service_charge": str(order.service_charge),
        "total_amount": str(order.total_amount),

        "payments": payments,
        "total_paid": str(total_paid),
        "change": str(change),
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,

        "is_offline_receipt": order.source == "pos_offline",
        "sync_status": "synced" if order.source != "pos_offline" else "pending",
    })


# ══════════════════════════════════════════════════════════════════════════════
# Z-REPORT — End of Day / Shift Summary (Phase 29)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def z_report(request):
    """
    Returns comprehensive end-of-day Z-report for a shift or today's full day.
    ?shift_id=<uuid> — report for a specific shift
    ?date=YYYY-MM-DD  — report for a specific date (all shifts that day)
    No params — today's Z-report (all shifts today, current or last closed)
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response(
            {"error": "POS is not enabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    shift_id = request.query_params.get("shift_id")
    date_str = request.query_params.get("date")

    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timezone.timedelta(days=1)

    shifts = CashShift.objects.filter(merchant=merchant)

    if shift_id:
        try:
            shift_obj = shifts.get(id=shift_id)
        except CashShift.DoesNotExist:
            return Response({"error": "Shift not found."},
                            status=status.HTTP_404_NOT_FOUND)
        shift_start = shift_obj.opened_at
        shift_end = shift_obj.closed_at or now
        shifts = shifts.filter(id=shift_id)
        report_label = f"Shift {str(shift_id)[:8]}"
    elif date_str:
        try:
            target_date = timezone.datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({"error": "Invalid date format. Use YYYY-MM-DD."},
                            status=status.HTTP_400_BAD_REQUEST)
        day_start = timezone.make_aware(
            timezone.datetime.combine(target_date, timezone.datetime.min.time())
        )
        day_end = day_start + timezone.timedelta(days=1)
        shifts = shifts.filter(opened_at__gte=day_start, opened_at__lt=day_end)
        shift_start = day_start
        shift_end = day_end
        report_label = target_date.strftime("%d %b %Y")
    else:
        # Today: find the current open shift or last closed shift
        current_shift = shifts.filter(
            status=CashShift.STATUS_OPEN
        ).order_by("-opened_at").first()
        if current_shift:
            shifts = shifts.filter(id=current_shift.id)
            shift_start = current_shift.opened_at
            shift_end = now
            report_label = "Today (Open Shift)"
        else:
            last_shift = shifts.filter(
                status=CashShift.STATUS_CLOSED
            ).order_by("-closed_at").first()
            if last_shift:
                shifts = shifts.filter(id=last_shift.id)
                shift_start = last_shift.opened_at
                shift_end = last_shift.closed_at or now
                report_label = last_shift.closed_at.strftime("%d %b %Y") if last_shift.closed_at else "Today"
            else:
                shifts = shifts.none()
                shift_start = today_start
                shift_end = today_end
                report_label = "Today"

    # Collect all payments across the shift(s)
    payments = PosPayment.objects.filter(
        shift__in=shifts,
        status=PosPayment.STATUS_COMPLETED,
    )

    orders = Order.objects.filter(
        pos_payments__in=payments,
    ).distinct()

    # ── Aggregate totals ──
    payment_totals = payments.aggregate(
        total=Sum("amount"),
        total_cash=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CASH)),
        total_card=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CARD)),
        total_bank_qr=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_BANK_QR)),
        total_mobile_wallet=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_MOBILE_WALLET)),
        total_credit=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CREDIT)),
        total_split=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_SPLIT)),
        total_change=Sum("change_amount"),
        count=Count("id", distinct=True),
    )

    # ── Order stats ──
    order_stats = orders.aggregate(
        total_revenue=Sum("total_amount"),
        total_discount=Sum("discount_amount"),
        total_tax=Sum("tax_amount"),
        total_service_charge=Sum("service_charge"),
        order_count=Count("id", distinct=True),
    )

    # ── Payment method breakdown (per method: count + amount) ──
    method_breakdown = (
        payments
        .values("payment_method")
        .annotate(
            count=Count("id", distinct=True),
            amount=Sum("amount"),
            change=Sum("change_amount"),
        )
        .order_by("-amount")
    )

    # ── Status breakdown ──
    order_status_breakdown = (
        orders
        .values("status")
        .annotate(count=Count("id", distinct=True))
        .order_by("-count")
    )

    # ── Fulfillment breakdown ──
    fulfillment_breakdown = (
        orders
        .values("fulfillment_type")
        .annotate(count=Count("id", distinct=True))
        .order_by("-count")
    )

    # ── Top selling items ──
    top_items = (
        OrderItem.objects
        .filter(order__in=orders)
        .values("name")
        .annotate(
            total_qty=Sum("quantity"),
            total_revenue=Sum("subtotal"),
        )
        .order_by("-total_qty")[:15]
    )

    # ── Cash movement ──
    shift_data = []
    for s in shifts:
        shift_data.append({
            "id": str(s.id),
            "opened_by": s.opened_by.display_name,
            "closed_by": s.closed_by.display_name if s.closed_by else None,
            "opening_cash": str(s.opening_cash),
            "closing_cash": str(s.closing_cash) if s.closing_cash is not None else None,
            "expected_cash": str(s.expected_cash),
            "cash_difference": str(s.cash_difference) if s.cash_difference is not None else None,
            "total_cash_sales": str(s.total_cash_sales),
            "total_card_sales": str(s.total_card_sales),
            "total_other_sales": str(s.total_other_sales),
            "total_sales": str(s.total_sales),
            "total_orders": s.total_orders,
            "status": s.status,
            "opened_at": s.opened_at.isoformat() if s.opened_at else None,
            "closed_at": s.closed_at.isoformat() if s.closed_at else None,
        })

    # ── Discounts ──
    discounts = PosDiscount.objects.filter(order__in=orders)
    discount_stats = discounts.aggregate(
        count=Count("id", distinct=True),
        total=Sum("discount_amount"),
    )

    # ── Credit transactions this period ──
    credit_accounts = CreditAccount.objects.filter(merchant=merchant)
    credit_sales = CreditTransaction.objects.filter(
        account__in=credit_accounts,
        order__in=orders,
        transaction_type=CreditTransaction.TYPE_SALE,
    )
    credit_repayments = CreditTransaction.objects.filter(
        account__in=credit_accounts,
        created_at__gte=shift_start,
        created_at__lt=shift_end,
        transaction_type=CreditTransaction.TYPE_REPAYMENT,
    )
    credit_sale_total = credit_sales.aggregate(t=Sum("amount"))["t"] or 0
    credit_repay_total = credit_repayments.aggregate(t=Sum("amount"))["t"] or 0

    # ── Debit transactions this period ──
    debit_accounts = DebitAccount.objects.filter(merchant=merchant)
    debit_purchases = DebitTransaction.objects.filter(
        account__in=debit_accounts,
        order__in=orders,
        transaction_type=DebitTransaction.TYPE_PURCHASE,
    )
    debit_topups = DebitTransaction.objects.filter(
        account__in=debit_accounts,
        created_at__gte=shift_start,
        created_at__lt=shift_end,
        transaction_type=DebitTransaction.TYPE_TOPUP,
    )
    debit_purchase_total = debit_purchases.aggregate(t=Sum("amount"))["t"] or 0
    debit_topup_total = debit_topups.aggregate(t=Sum("amount"))["t"] or 0

    # ── Refund stats ──
    refund_payments = PosPayment.objects.filter(
        shift__in=shifts,
        status=PosPayment.STATUS_REFUNDED,
    )
    refund_total = refund_payments.aggregate(t=Sum("amount"))["t"] or 0

    _audit(merchant, PosAuditLog.ACTION_REPORT_GENERATE,
           metadata={"report_label": report_label, "shifts": [str(s.id) for s in shifts]})

    # ── Per-staff breakdown ──
    staff_breakdown_data = (
        payments
        .filter(worker__isnull=False)
        .values("worker__id", "worker__display_name")
        .annotate(
            total_payments=Count("id", distinct=True),
            total_revenue=Sum("amount"),
            total_change=Sum("change_amount"),
            cash_amount=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CASH)),
            card_amount=Sum("amount", filter=Q(payment_method=PosPayment.METHOD_CARD)),
            other_amount=Sum("amount", filter=~Q(payment_method__in=[PosPayment.METHOD_CASH, PosPayment.METHOD_CARD])),
        )
        .order_by("-total_revenue")
    )

    # Per-staff order counts
    staff_order_counts = {}
    for worker_id, count in (
        orders
        .filter(processed_by_worker__isnull=False)
        .values("processed_by_worker")
        .annotate(cnt=Count("id", distinct=True))
    ):
        staff_order_counts[worker_id] = count

    staff_breakdown = []
    for sb in staff_breakdown_data:
        wid = sb["worker__id"]
        staff_breakdown.append({
            "worker_id": wid,
            "worker_name": sb["worker__display_name"],
            "order_count": staff_order_counts.get(wid, 0),
            "payment_count": sb["total_payments"],
            "total_revenue": str(sb["total_revenue"] or 0),
            "total_change": str(sb["total_change"] or 0),
            "cash_amount": str(sb["cash_amount"] or 0),
            "card_amount": str(sb["card_amount"] or 0),
            "other_amount": str(sb["other_amount"] or 0),
        })

    # ── Cash movements summary ──
    cash_movements = PosCashMovement.objects.filter(shift__in=shifts)
    payout_total = cash_movements.filter(
        movement_type=PosCashMovement.TYPE_PAYOUT
    ).aggregate(t=Sum("amount"))["t"] or 0
    payin_total = cash_movements.filter(
        movement_type__in=[PosCashMovement.TYPE_PAYIN, PosCashMovement.TYPE_CASHDROP]
    ).aggregate(t=Sum("amount"))["t"] or 0

    return Response({
        "report_label": report_label,
        "generated_at": now.isoformat(),
        "merchant": {
            "name": merchant.business_name,
            "address": merchant.address,
            "phone": merchant.phone,
            "logo_url": merchant.logo_url,
        },

        # Shift(s) summary
        "shifts": shift_data,

        # Order totals
        "total_orders": order_stats["order_count"] or 0,
        "total_revenue": str(order_stats["total_revenue"] or 0),
        "total_discount_amount": str(order_stats["total_discount"] or 0),
        "total_tax": str(order_stats["total_tax"] or 0),
        "total_service_charge": str(order_stats["total_service_charge"] or 0),

        # Payment breakdown
        "total_payments": str(payment_totals["total"] or 0),
        "total_change_given": str(payment_totals["total_change"] or 0),
        "payment_methods": [
            {
                "method": m["payment_method"],
                "count": m["count"],
                "amount": str(m["amount"] or 0),
                "change": str(m["change"] or 0),
            }
            for m in method_breakdown
        ],

        # Status & fulfillment
        "order_status_breakdown": [
            {"status": s["status"], "count": s["count"]}
            for s in order_status_breakdown
        ],
        "fulfillment_breakdown": [
            {"type": f["fulfillment_type"], "count": f["count"]}
            for f in fulfillment_breakdown
        ],

        # Top items
        "top_selling_items": [
            {
                "name": i["name"],
                "quantity_sold": i["total_qty"],
                "revenue": str(i["total_revenue"] or 0),
            }
            for i in top_items
        ],

        # Discounts
        "discounts_applied": discount_stats["count"] or 0,
        "total_discounts_value": str(discount_stats["total"] or 0),

        # Cash movement
        "cash_summary": {
            "total_cash_in": str(sum(float(s["opening_cash"] or 0) + float(s["total_cash_sales"] or 0) for s in shift_data)),
            "total_cash_out_change": str(payment_totals["total_change"] or 0),
            "total_expected_cash": str(sum(float(s["expected_cash"] or 0) for s in shift_data)),
            "total_actual_cash": str(sum(float(s["closing_cash"] or 0) for s in shift_data if s["closing_cash"] is not None)),
            "total_difference": str(sum(float(s["cash_difference"] or 0) for s in shift_data if s["cash_difference"] is not None)),
            "total_payouts": str(payout_total),
            "total_payins": str(payin_total),
        },

        # Credit / Debit
        "credit_summary": {
            "sales": str(credit_sale_total),
            "repayments": str(credit_repay_total),
        },
        "debit_summary": {
            "purchases": str(debit_purchase_total),
            "topups": str(debit_topup_total),
        },

        # Refunds
        "refund_total": str(refund_total),
        "refund_count": refund_payments.count(),

        # Per-staff breakdown
        "staff_breakdown": staff_breakdown,
    })


# ══════════════════════════════════════════════════════════════════════════════
# CUSTOMER IDENTIFICATION (Phase 26)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def search_customers(request):
    """
    Search registered customers by name, email, phone, transfer_code, or membership_number.
    Used at POS to link a customer to an order for loyalty points.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    q = request.query_params.get("q", "").strip()
    if len(q) < 2:
        return Response([])

    from loyalty.models import CustomerMerchantProfile

    profiles = (
        CustomerProfile.objects
        .select_related("user")
        .filter(
            Q(full_name__icontains=q) |
            Q(user__email__icontains=q) |
            Q(user__phone__icontains=q) |
            Q(transfer_code__icontains=q) |
            Q(merchant_profiles__membership_number__icontains=q,
              merchant_profiles__merchant=merchant)
        )
        .distinct()[:20]
    )

    results = []
    for p in profiles:
        membership_number = ""
        try:
            cmp = CustomerMerchantProfile.objects.get(
                customer=p, merchant=merchant
            )
            membership_number = cmp.membership_number or ""
        except CustomerMerchantProfile.DoesNotExist:
            pass

        results.append({
            "id": p.id,
            "full_name": p.full_name,
            "email": p.user.email,
            "phone": p.user.phone,
            "transfer_code": p.transfer_code,
            "membership_number": membership_number,
            "loyalty_points": p.loyalty_points,
            "tier": p.tier,
            "total_orders": p.total_orders,
        })

    return Response(results)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def create_customer(request):
    """
    Create (or match) a walk-in customer at the POS and link them to this merchant.

    Body: { full_name, phone?, email? }

    - If an existing customer account matches the email or phone, it is linked
      to the merchant instead of creating a duplicate.
    - Returns the same shape as search_customers for direct use at the POS.
    """
    import re
    from loyalty.services import join_merchant
    from loyalty.models import CustomerMerchantProfile

    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    full_name = (request.data.get("full_name") or "").strip()
    phone = (request.data.get("phone") or "").strip()
    email = (request.data.get("email") or "").strip().lower()

    if not full_name:
        return Response({"error": "full_name is required."},
                        status=status.HTTP_400_BAD_REQUEST)
    if not phone and not email:
        return Response({"error": "Provide a phone number or email."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Match an existing customer account by email, then by phone.
    user = None
    if email:
        user = User.objects.filter(email__iexact=email, role=User.ROLE_CUSTOMER).first()
    if user is None and phone:
        user = User.objects.filter(phone=phone, role=User.ROLE_CUSTOMER).first()
    if user is None and email:
        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"error": "This email belongs to an existing account. Search and link it instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    if user is None:
        # Create a new customer account with an unusable password. The account
        # can be claimed later via the password-reset flow.
        base_username = re.sub(r"[^a-z0-9_.@-]", "", (email or phone or full_name).lower())
        if not base_username:
            base_username = "customer"
        username = base_username
        counter = 1
        while User.objects.filter(username=username).exists():
            username = f"{base_username}{counter}"
            counter += 1

        name_parts = full_name.split(" ", 1)
        user = User.objects.create_user(
            username=username,
            email=email or f"{username}@pos.local",
            password=None,
            first_name=name_parts[0],
            last_name=name_parts[1] if len(name_parts) > 1 else "",
            role=User.ROLE_CUSTOMER,
            phone=phone,
        )

    profile, _created = CustomerProfile.objects.get_or_create(
        user=user,
        defaults={"full_name": full_name or user.email},
    )
    if not profile.full_name and full_name:
        profile.full_name = full_name
        profile.save(update_fields=["full_name", "updated_at"])

    join_merchant(profile, merchant)

    _audit(merchant, "customer_created", user=request.user,
           entity_type="customer", entity_id=str(profile.id),
           metadata={"full_name": full_name, "phone": phone, "email": email})

    return Response({
        "id": profile.id,
        "full_name": profile.full_name,
        "email": user.email,
        "phone": user.phone,
        "transfer_code": profile.transfer_code or "",
        "membership_number": CustomerMerchantProfile.objects.filter(
            customer=profile, merchant=merchant
        ).values_list("membership_number", flat=True).first() or "",
        "loyalty_points": profile.loyalty_points,
        "tier": profile.tier,
        "total_orders": profile.total_orders,
    }, status=status.HTTP_201_CREATED)


# ══════════════════════════════════════════════════════════════════════════════
# REFUND PROCESSING (Phase 27)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def process_refund(request):
    """
    Process a full or partial refund for a completed order.
    - Creates a refund payment record (negative amount)
    - Updates order status to 'refunded'
    - Reverses credit/debit transactions if applicable
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    order_id = request.data.get("order_id")
    worker_id = request.data.get("worker_id")
    reason = request.data.get("reason", "")
    refund_amount = request.data.get("amount")  # None = full refund
    refund_method = request.data.get("refund_method", "cash")  # cash, card, credit, debit

    if not order_id or not worker_id:
        return Response({"error": "order_id and worker_id are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.get(uuid=order_id, merchant=merchant)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        worker = ShiftWorker.objects.get(
            id=worker_id, merchant=merchant, is_active=True,
            can_process_refund=True,
        )
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found or not authorized for refunds."},
                        status=status.HTTP_403_FORBIDDEN)

    if order.payment_status != "paid":
        return Response({"error": "Order is not paid. Only paid orders can be refunded."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Calculate refund amount
    if refund_amount is None:
        refund_amount = float(order.total_amount)
    else:
        refund_amount = float(refund_amount)

    if refund_amount <= 0:
        return Response({"error": "Refund amount must be positive."},
                        status=status.HTTP_400_BAD_REQUEST)

    if refund_amount > float(order.total_amount):
        return Response({"error": "Refund amount exceeds order total."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Create refund payment record
    refund_payment = PosPayment.objects.create(
        merchant=merchant,
        order=order,
        shift=order.cash_shift,
        worker=worker,
        device=order.pos_device,
        payment_method=refund_method,
        amount=-refund_amount,
        status=PosPayment.STATUS_REFUNDED,
        external_reference=f"REFUND-{order.id}",
        client_mutation_id=uuid.uuid4(),
    )

    # Update order status
    order.status = "refunded"
    order.payment_status = "refunded"
    order.version += 1
    order.save(update_fields=["status", "payment_status", "version", "updated_at"])

    # Reverse credit transaction if original payment was credit
    if order.payment_method == "credit":
        CreditTransaction.objects.create(
            account=CreditAccount.objects.filter(
                merchant=merchant, customer=order.customer
            ).first(),
            order=order,
            worker=worker,
            transaction_type="adjustment",
            amount=-refund_amount,
            balance_before=0,
            balance_after=0,
            note=f"Refund for order #{order.id}: {reason}",
        )

    # Reverse debit transaction if original payment was debit
    if order.payment_method == "debit":
        debit_acct = DebitAccount.objects.filter(
            merchant=merchant, customer=order.customer
        ).first()
        if debit_acct:
            debit_acct.balance += refund_amount
            debit_acct.save(update_fields=["balance", "updated_at"])
            DebitTransaction.objects.create(
                account=debit_acct,
                order=order,
                worker=worker,
                transaction_type="refund",
                amount=refund_amount,
                balance_before=debit_acct.balance - refund_amount,
                balance_after=debit_acct.balance,
                note=f"Refund for order #{order.id}: {reason}",
            )

    # Update POS audit log
    _audit(merchant, PosAuditLog.ACTION_REFUND,
           device=order.pos_device, worker=worker, user=request.user,
           entity_type="order", entity_id=order.id,
           metadata={
               "order_id": order.id,
               "refund_amount": str(refund_amount),
               "refund_method": refund_method,
               "reason": reason,
           })

    return Response({
        "message": "Refund processed successfully",
        "refund_payment_id": str(refund_payment.id),
        "refund_amount": str(refund_amount),
        "order_status": order.status,
    })


# ══════════════════════════════════════════════════════════════════════════════
# CONFLICT RESOLUTION (Phase 30)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_conflicts(request):
    """
    List all sync conflicts for this merchant.
    Returns orders/payments with version conflicts or sync failures.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    # Auto-clean processed mutations older than 1 hour (idempotency window passed)
    ProcessedClientMutation.objects.filter(
        merchant=merchant,
        processed_at__lt=timezone.now() - timezone.timedelta(hours=1),
    ).delete()

    # Orders with conflict status
    conflict_orders = (
        Order.objects
        .filter(merchant=merchant, source="pos_offline")
        .exclude(status__in=["completed", "cancelled"])
        .order_by("-created_at")[:50]
    )

    # Payments with conflict status
    conflict_payments = (
        PosPayment.objects
        .filter(merchant=merchant, sync_status="conflict")
        .order_by("-created_at")[:50]
    )

    # Recent processed mutations (informational only, not conflicts)
    recent_mutations = (
        ProcessedClientMutation.objects
        .filter(merchant=merchant)
        .order_by("-processed_at")[:20]
    )

    return Response({
        "orders": [
            {
                "id": o.id,
                "uuid": str(o.uuid),
                "status": o.status,
                "total_amount": str(o.total_amount),
                "version": o.version,
                "sync_status": o.source,
                "created_at": o.created_at.isoformat() if o.created_at else None,
            }
            for o in conflict_orders
        ],
        "payments": [
            {
                "id": str(p.id),
                "order": str(p.order_id),
                "payment_method": p.payment_method,
                "amount": str(p.amount),
                "status": p.status,
                "sync_status": p.sync_status,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in conflict_payments
        ],
        "mutations": [
            {
                "id": m.id,
                "client_mutation_id": str(m.client_mutation_id),
                "entity_type": m.entity_type,
                "operation": m.operation,
                "server_object_id": str(m.server_object_id) if m.server_object_id else None,
                "processed_at": m.processed_at.isoformat() if m.processed_at else None,
            }
            for m in recent_mutations
        ],
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
@transaction.atomic
def resolve_conflict(request):
    """
    Resolve a sync conflict by choosing server or client version.
    - entity_type: 'order' | 'payment'
    - entity_id: ID of the conflicting entity
    - resolution: 'keep_server' | 'keep_client' | 'merge'
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    entity_type = request.data.get("entity_type")
    entity_id = request.data.get("entity_id")
    resolution = request.data.get("resolution", "keep_server")
    client_data = request.data.get("client_data", {})

    if not entity_type or not entity_id:
        return Response({"error": "entity_type and entity_id are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    if entity_type == "order":
        try:
            order = Order.objects.get(id=entity_id, merchant=merchant)
        except Order.DoesNotExist:
            return Response({"error": "Order not found."},
                            status=status.HTTP_404_NOT_FOUND)

        if resolution == "keep_client" and client_data:
            # Update order with client data
            for field in ["status", "total_amount", "notes", "fulfillment_type"]:
                if field in client_data:
                    setattr(order, field, client_data[field])
            order.source = "pos_offline_resolved"
            order.version += 1
            order.save()

        elif resolution == "keep_server":
            # Mark as resolved, keep server version
            order.source = "pos_offline_resolved"
            order.save(update_fields=["source", "updated_at"])

        _audit(merchant, PosAuditLog.ACTION_SYNC_RESOLVE,
               entity_type="order", entity_id=order.id,
               metadata={"resolution": resolution})

        return Response({"message": "Conflict resolved", "order_id": order.id})

    elif entity_type == "payment":
        try:
            payment = PosPayment.objects.get(id=entity_id, merchant=merchant)
        except PosPayment.DoesNotExist:
            return Response({"error": "Payment not found."},
                            status=status.HTTP_404_NOT_FOUND)

        if resolution == "keep_client" and client_data:
            for field in ["payment_method", "amount", "status"]:
                if field in client_data:
                    setattr(payment, field, client_data[field])
            payment.sync_status = "resolved"
            payment.save()

        elif resolution == "keep_server":
            payment.sync_status = "resolved"
            payment.save(update_fields=["sync_status", "updated_at"])

        _audit(merchant, PosAuditLog.ACTION_SYNC_RESOLVE,
               entity_type="payment", entity_id=payment.id,
               metadata={"resolution": resolution})

        return Response({"message": "Conflict resolved", "payment_id": str(payment.id)})

    return Response({"error": "Invalid entity_type."},
                    status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def clear_processed_mutations(request):
    """
    Clear processed client mutations for this merchant.
    Optionally pass mutation_ids: [int] to clear specific ones.
    If omitted, clears ALL processed mutations for the merchant.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    mutation_ids = request.data.get("mutation_ids")
    qs = ProcessedClientMutation.objects.filter(merchant=merchant)

    if mutation_ids:
        qs = qs.filter(id__in=mutation_ids)

    count = qs.count()
    qs.delete()

    return Response({"message": f"Cleared {count} mutation(s)", "count": count})


# ══════════════════════════════════════════════════════════════════════════════
# TABLE QR ORDERING (Phase 28)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([AllowAny])
def table_menu(request, token):
    """
    Public endpoint: customer scans QR code at table, gets menu + table info.
    No auth required — the token in the URL is the table's public_token.
    """
    from merchants.models import MerchantTable
    try:
        table = MerchantTable.objects.select_related("merchant").get(
            public_token=token, is_active=True,
        )
    except MerchantTable.DoesNotExist:
        return Response({"error": "Invalid QR code."},
                        status=status.HTTP_404_NOT_FOUND)

    merchant = table.merchant
    menu_items = MenuItem.objects.filter(
        merchant=merchant, is_available=True,
    ).order_by("category", "name")

    categories: dict = {}
    for item in menu_items:
        cat = item.category or "Menu"
        if cat not in categories:
            categories[cat] = []
        categories[cat].append({
            "id": item.id,
            "name": item.name,
            "description": item.description,
            "price": str(item.price),
            "image_url": item.image_url,
            "category": item.category,
            "emoji": item.emoji,
            "is_featured": item.is_featured,
        })

    return Response({
        "table": {
            "id": table.id,
            "name": table.name,
            "table_number": table.table_number,
        },
        "merchant": {
            "name": merchant.business_name,
            "logo_url": merchant.logo_url,
        },
        "categories": categories,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([ScopedRateThrottle])
@transaction.atomic
def table_order(request, token):
    """
    Public endpoint: customer places an order from their table via QR.
    Creates a pending order linked to the table. POS receives it as a new order.
    """
    from merchants.models import MerchantTable
    try:
        table = MerchantTable.objects.select_related("merchant").get(
            public_token=token, is_active=True,
        )
    except MerchantTable.DoesNotExist:
        return Response({"error": "Invalid QR code."},
                        status=status.HTTP_404_NOT_FOUND)

    merchant = table.merchant
    items_data = request.data.get("items", [])
    notes = request.data.get("notes", "")
    customer_name = request.data.get("customer_name", "")
    customer_id = request.data.get("customer_id")

    if not items_data:
        return Response({"error": "At least one item is required."},
                        status=status.HTTP_400_BAD_REQUEST)

    # Optionally link a customer if provided
    customer = None
    if customer_id:
        from accounts.models import CustomerProfile
        try:
            customer = CustomerProfile.objects.get(id=customer_id)
            from loyalty.services import join_merchant
            join_merchant(customer, merchant)
        except CustomerProfile.DoesNotExist:
            pass

    # Validate all menu items exist before creating anything
    menu_items_by_id = {
        mi.id: mi
        for mi in MenuItem.objects.filter(
            id__in=[item_data["menu_item_id"] for item_data in items_data],
            merchant=merchant,
            is_available=True,
        )
    }
    for item_data in items_data:
        if item_data["menu_item_id"] not in menu_items_by_id:
            return Response({"error": f"Menu item {item_data['menu_item_id']} not found."},
                            status=status.HTTP_400_BAD_REQUEST)

    # Build order
    order = Order(
        customer=customer,
        merchant=merchant,
        status="pending",
        order_type="dine_in",
        source="customer_qr",
        fulfillment_type="dine_in",
        table=table,
        table_name_snapshot=table.name,
        table_number_snapshot=table.table_number,
        notes=notes,
    )
    order.save()

    # Create order items and calculate points
    subtotal = 0
    points_earned = 0
    for item_data in items_data:
        menu_item = menu_items_by_id[item_data["menu_item_id"]]

        qty = item_data.get("quantity", 1)
        item_subtotal = float(menu_item.price) * qty
        subtotal += item_subtotal

        if menu_item.loyalty_reward:
            points_earned += menu_item.points_per_item * qty

        OrderItem.objects.create(
            order=order,
            menu_item=menu_item,
            name=menu_item.name,
            price=menu_item.price,
            quantity=qty,
            subtotal=item_subtotal,
        )

    # Apply spend-based points from LoyaltyRules
    try:
        rules = merchant.loyalty_rules
        if rules.points_per_npr > 0:
            points_earned += int(float(subtotal) * rules.points_per_npr)
    except Exception:
        pass

    order.subtotal = subtotal
    order.total_amount = subtotal
    order.points_earned = points_earned
    order.customer_name_snapshot = customer_name

    # Apply tax
    from config.tax_utils import calculate_tax
    tax_amount, tax_breakdown = calculate_tax(subtotal, merchant)
    order.tax_amount = tax_amount
    order.tax_breakdown = tax_breakdown
    order.total_amount = subtotal + tax_amount

    order.save(update_fields=["subtotal", "total_amount", "tax_amount", "tax_breakdown", "points_earned", "customer_name_snapshot", "updated_at"])

    _audit(merchant, PosAuditLog.ACTION_ORDER_CREATE,
           entity_type="order", entity_id=order.id,
           metadata={"source": "customer_qr", "table": table.name, "customer_name": customer_name})

    _notify_safe(
        merchant=merchant,
        title=f"New Table Order — {table.name}",
        message=f"Table {table.table_number}: {len(items_data)} items, {merchant.currency_symbol} {subtotal:.2f}",
        notification_type="pos_new_order",
    )

    return Response({
        "message": "Order placed successfully",
        "order_id": order.id,
        "table": table.name,
        "total": str(subtotal),
    }, status=status.HTTP_201_CREATED)


table_order.throttle_scope = "guest"


# ══════════════════════════════════════════════════════════════════════════════
# ASSIGN CUSTOMER TO ORDER
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def assign_customer_to_order(request):
    """Link a customer to an existing order and recalculate points_earned."""
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    order_id = request.data.get("order_id")
    customer_id = request.data.get("customer_id")

    if not order_id or not customer_id:
        return Response({"error": "order_id and customer_id are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        order = Order.objects.get(uuid=order_id, merchant=merchant)
    except Order.DoesNotExist:
        return Response({"error": "Order not found."},
                        status=status.HTTP_404_NOT_FOUND)

    from accounts.models import CustomerProfile
    try:
        customer = CustomerProfile.objects.get(id=customer_id)
    except CustomerProfile.DoesNotExist:
        return Response({"error": "Customer not found."},
                        status=status.HTTP_404_NOT_FOUND)

    from loyalty.services import join_merchant
    join_merchant(customer, merchant)

    # Recalculate points_earned from order items if not yet awarded
    if not order.loyalty_awarded and order.customer is None:
        points_earned = 0
        for oi in order.items.select_related("menu_item").all():
            if oi.menu_item and oi.menu_item.loyalty_reward:
                points_earned += oi.menu_item.points_per_item * oi.quantity
        order.points_earned = points_earned

    order.customer = customer
    order.save(update_fields=["customer", "points_earned", "updated_at"])

    # If the order is already completed and loyalty hasn't been awarded yet,
    # award loyalty (points, punch cards, mission progress) retroactively.
    if (
        order.status == Order.STATUS_COMPLETED
        and not order.loyalty_awarded
    ):
        if order.order_type == Order.ORDER_TYPE_REWARD_REDEMPTION and order.reward_redemption:
            _deduct_reward_redemption_points(order)
        else:
            _award_loyalty(order)
        order.loyalty_awarded = True
        order.save(update_fields=["loyalty_awarded", "updated_at"])

    return Response({
        "message": "Customer assigned to order.",
        "order_id": str(order.uuid),
        "customer_id": customer.id,
        "points_earned": order.points_earned,
    })


# ══════════════════════════════════════════════════════════════════════════════
# POS NOTIFICATIONS (Phase 31)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def pos_notifications(request):
    """
    Get recent POS-related notifications for this merchant.
    New orders, payment confirmations, low stock alerts, etc.
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    notifications = (
        Notification.objects
        .filter(merchant_id=merchant.id)
        .order_by("-created_at")[:30]
    )

    return Response([
        {
            "id": n.id,
            "title": n.title,
            "message": n.message,
            "notification_type": n.notification_type,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notifications
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def mark_notification_read(request, notification_id):
    """Mark a notification as read."""
    merchant = _get_merchant(request)
    try:
        n = Notification.objects.get(id=notification_id, merchant_id=merchant.id)
        n.is_read = True
        n.save(update_fields=["is_read", "updated_at"])
        return Response({"message": "Marked as read"})
    except Notification.DoesNotExist:
        return Response({"error": "Notification not found."},
                        status=status.HTTP_404_NOT_FOUND)


# ══════════════════════════════════════════════════════════════════════════════
# STAFF SCHEDULING (Phase 31+)
# ══════════════════════════════════════════════════════════════════════════════

from .models import StaffSchedule

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def list_schedules(request):
    """
    List staff schedules for this merchant.
    ?week=YYYY-MM-DD for a specific week (Monday date)
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    week_str = request.query_params.get("week")
    if week_str:
        try:
            week_start = timezone.datetime.strptime(week_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({"error": "Invalid date format. Use YYYY-MM-DD."},
                            status=status.HTTP_400_BAD_REQUEST)
    else:
        today = timezone.now().date()
        week_start = today - timezone.timedelta(days=today.weekday())

    week_end = week_start + timezone.timedelta(days=7)

    schedules = (
        StaffSchedule.objects
        .filter(
            merchant=merchant,
            shift_date__gte=week_start,
            shift_date__lt=week_end,
        )
        .select_related("worker")
        .order_by("shift_date", "start_time")
    )

    return Response([
        {
            "id": s.id,
            "worker_id": str(s.worker_id),
            "worker_name": s.worker.display_name,
            "shift_date": s.shift_date.isoformat(),
            "start_time": s.start_time.strftime("%H:%M") if s.start_time else None,
            "end_time": s.end_time.strftime("%H:%M") if s.end_time else None,
            "role": s.role,
            "status": s.status,
            "notes": s.notes,
        }
        for s in schedules
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def create_schedule(request):
    """Create a staff schedule entry."""
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    worker_id = request.data.get("worker_id")
    shift_date = request.data.get("shift_date")
    start_time = request.data.get("start_time")
    end_time = request.data.get("end_time")
    role = request.data.get("role", "cashier")
    notes = request.data.get("notes", "")

    if not worker_id or not shift_date or not start_time or not end_time:
        return Response({"error": "worker_id, shift_date, start_time, end_time are required."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        shift_date = StaffSchedule._meta.get_field("shift_date").to_python(shift_date)
        start_time = StaffSchedule._meta.get_field("start_time").to_python(start_time)
        end_time = StaffSchedule._meta.get_field("end_time").to_python(end_time)
    except (ValueError, TypeError):
        return Response({"error": "Invalid shift_date, start_time or end_time format."},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        worker = ShiftWorker.objects.get(id=worker_id, merchant=merchant, is_active=True)
    except ShiftWorker.DoesNotExist:
        return Response({"error": "Worker not found."},
                        status=status.HTTP_404_NOT_FOUND)

    try:
        schedule = StaffSchedule.objects.create(
            merchant=merchant,
            worker=worker,
            shift_date=shift_date,
            start_time=start_time,
            end_time=end_time,
            role=role,
            notes=notes,
        )
    except Exception as e:
        return Response({"error": f"Failed to create schedule: {str(e)}"},
                        status=status.HTTP_400_BAD_REQUEST)

    return Response({
        "id": schedule.id,
        "worker_name": worker.display_name,
        "shift_date": schedule.shift_date.isoformat(),
        "start_time": schedule.start_time.strftime("%H:%M") if schedule.start_time else None,
        "end_time": schedule.end_time.strftime("%H:%M") if schedule.end_time else None,
        "role": schedule.role,
        "status": schedule.status,
        "notes": schedule.notes,
    }, status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def delete_schedule(request, schedule_id):
    """Delete a staff schedule entry."""
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    try:
        schedule = StaffSchedule.objects.get(id=schedule_id, merchant=merchant)
        schedule.delete()
        return Response({"message": "Schedule deleted"})
    except StaffSchedule.DoesNotExist:
        return Response({"error": "Schedule not found."},
                        status=status.HTTP_404_NOT_FOUND)


# ══════════════════════════════════════════════════════════════════════════════
# STAFF DAILY REPORT (Phase 32)
# ══════════════════════════════════════════════════════════════════════════════

@api_view(["GET"])
@permission_classes([IsAuthenticated, IsMerchantUser, IsPosEnabled])
def staff_daily_report(request):
    """
    Per-staff daily performance report.
    ?date=YYYY-MM-DD  — report for a specific date (defaults to today)
    ?worker_id=<uuid> — filter to a single worker
    """
    merchant = _get_merchant(request)
    if not _require_pos(merchant):
        return Response({"error": "POS is not enabled."},
                        status=status.HTTP_403_FORBIDDEN)

    date_str = request.query_params.get("date")
    worker_id = request.query_params.get("worker_id")

    now = timezone.now()
    if date_str:
        try:
            target_date = timezone.datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return Response({"error": "Invalid date format. Use YYYY-MM-DD."},
                            status=status.HTTP_400_BAD_REQUEST)
    else:
        target_date = now.date()

    day_start = timezone.make_aware(
        timezone.datetime.combine(target_date, timezone.datetime.min.time())
    )
    day_end = day_start + timezone.timedelta(days=1)

    all_workers = ShiftWorker.objects.filter(merchant=merchant, is_active=True)
    if worker_id:
        all_workers = all_workers.filter(id=worker_id)

    # Payments made by workers on this day
    payments = PosPayment.objects.filter(
        worker__merchant=merchant,
        created_at__gte=day_start,
        created_at__lt=day_end,
        status=PosPayment.STATUS_COMPLETED,
    )
    if worker_id:
        payments = payments.filter(worker_id=worker_id)

    # Orders processed by workers on this day
    orders = Order.objects.filter(
        processed_by_worker__merchant=merchant,
        created_at__gte=day_start,
        created_at__lt=day_end,
    )
    if worker_id:
        orders = orders.filter(processed_by_worker_id=worker_id)

    # ── Per-staff breakdown (single grouped pass per table) ──
    # Aggregates are computed with GROUP BY worker, so the number of queries
    # stays constant regardless of how many workers the merchant has.
    cash = PosPayment.METHOD_CASH
    card = PosPayment.METHOD_CARD
    credit = PosPayment.METHOD_CREDIT

    payments_by_worker = {
        row["worker_id"]: row
        for row in payments.values("worker_id").annotate(
            total_revenue=Coalesce(Sum("amount"), Decimal("0")),
            cash_amount=Coalesce(Sum("amount", filter=Q(payment_method=cash)), Decimal("0")),
            card_amount=Coalesce(Sum("amount", filter=Q(payment_method=card)), Decimal("0")),
            credit_amount=Coalesce(Sum("amount", filter=Q(payment_method=credit)), Decimal("0")),
            other_amount=Coalesce(
                Sum("amount", filter=~Q(payment_method__in=[cash, card, credit])), Decimal("0")
            ),
            payment_count=Count("id"),
        )
    }

    orders_by_worker = {
        row["processed_by_worker_id"]: row
        for row in orders.values("processed_by_worker_id").annotate(
            order_count=Count("id"),
            total_discount=Coalesce(Sum("discount_amount"), Decimal("0")),
        )
    }

    from orders.models import OrderItem
    items_by_worker = {
        row["processed_by_worker_id"]: row
        for row in (
            OrderItem.objects.filter(order__in=orders)
            .values("order__processed_by_worker_id")
            .annotate(items_sold=Coalesce(Sum("quantity"), 0))
        )
    }

    staff_data = []
    for worker in all_workers:
        p = payments_by_worker.get(worker.id, {})
        o = orders_by_worker.get(worker.id, {})
        it = items_by_worker.get(worker.id, {})

        staff_data.append({
            "worker_id": str(worker.id),
            "worker_name": worker.display_name,
            "order_count": o.get("order_count", 0),
            "payment_count": p.get("payment_count", 0),
            "total_revenue": str(p.get("total_revenue", 0)),
            "cash_amount": str(p.get("cash_amount", 0)),
            "card_amount": str(p.get("card_amount", 0)),
            "credit_amount": str(p.get("credit_amount", 0)),
            "other_amount": str(p.get("other_amount", 0)),
            "total_discount": str(o.get("total_discount", 0)),
            "items_sold": it.get("items_sold", 0),
        })

    # Sort by revenue descending
    staff_data.sort(key=lambda x: float(x["total_revenue"]), reverse=True)

    return Response({
        "date": target_date.isoformat(),
        "staff": staff_data,
        "totals": {
            "total_revenue": str(
                sum(float(s["total_revenue"]) for s in staff_data)
            ),
            "total_orders": sum(s["order_count"] for s in staff_data),
            "total_payments": sum(s["payment_count"] for s in staff_data),
            "total_items_sold": sum(s["items_sold"] for s in staff_data),
            "total_discount": str(
                sum(float(s["total_discount"]) for s in staff_data)
            ),
        },
    })
