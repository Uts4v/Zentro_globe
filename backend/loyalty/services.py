"""
loyalty/services.py

Merchant-scoped loyalty helpers — wallets, onboarding, point operations.
"""

import uuid
from django.db import transaction
from django.utils import timezone

from .models import CustomerMerchantProfile, CustomerMerchantWallet, PointTransaction


def get_or_create_wallet(customer, merchant, membership=None) -> CustomerMerchantWallet:
    wallet, _ = CustomerMerchantWallet.objects.get_or_create(
        customer=customer,
        merchant=merchant,
        defaults={
            "tier_level": CustomerMerchantWallet.TIER_BRONZE,
            "membership": membership,
        },
    )
    if not wallet.membership and membership:
        wallet.membership = membership
        wallet.save(update_fields=["membership", "updated_at"])
    return wallet


def _lock_wallet(wallet: CustomerMerchantWallet) -> CustomerMerchantWallet:
    """Re-fetch a wallet with a row lock (PostgreSQL) inside the active txn."""
    return CustomerMerchantWallet.objects.select_for_update().get(pk=wallet.pk)


def join_merchant(customer, merchant):
    """
    Link a customer to a merchant. Creates profile + wallet if missing.
    Returns (profile, wallet, profile_created).
    """
    profile, profile_created = CustomerMerchantProfile.objects.get_or_create(
        customer=customer,
        merchant=merchant,
        defaults={"status": CustomerMerchantProfile.STATUS_ACTIVE},
    )
    if profile.status != CustomerMerchantProfile.STATUS_ACTIVE:
        profile.status = CustomerMerchantProfile.STATUS_ACTIVE
        profile.save(update_fields=["status", "updated_at"])

    wallet = get_or_create_wallet(customer, merchant, membership=profile)
    return profile, wallet, profile_created


def recalculate_tier(wallet: CustomerMerchantWallet):
    pts = wallet.lifetime_points
    if pts >= 5000:
        tier = CustomerMerchantWallet.TIER_PLATINUM
    elif pts >= 2000:
        tier = CustomerMerchantWallet.TIER_GOLD
    elif pts >= 500:
        tier = CustomerMerchantWallet.TIER_SILVER
    else:
        tier = CustomerMerchantWallet.TIER_BRONZE

    if wallet.tier_level != tier:
        wallet.tier_level = tier
        wallet.save(update_fields=["tier_level", "updated_at"])


def award_wallet_points(wallet: CustomerMerchantWallet, pts: int, transaction_type="EARNED", description="", order=None, reward=None, mission=None, punch_card=None):
    if pts <= 0:
        return

    with transaction.atomic():
        wallet = _lock_wallet(wallet)

        balance_before = wallet.points_balance
        wallet.points_balance = max(0, wallet.points_balance + pts)
        wallet.lifetime_points += pts
        wallet.last_point_earned_at = timezone.now()
        wallet.save(
            update_fields=[
                "points_balance",
                "lifetime_points",
                "last_point_earned_at",
                "updated_at",
            ]
        )
        recalculate_tier(wallet)

        PointTransaction.objects.create(
            merchant=wallet.merchant,
            customer=wallet.customer,
            membership=wallet.membership,
            wallet=wallet,
            transaction_type=transaction_type,
            points=pts,
            balance_before=balance_before,
            balance_after=wallet.points_balance,
            description=description,
            order=order,
            reward=reward,
            mission=mission,
            punch_card=punch_card
        )


def deduct_wallet_points(wallet: CustomerMerchantWallet, pts: int, transaction_type="REDEEMED", description="", order=None, reward=None, mission=None, punch_card=None):
    if pts <= 0:
        return

    with transaction.atomic():
        wallet = _lock_wallet(wallet)

        if wallet.points_balance < pts:
            raise ValueError(
                f"Insufficient points: have {wallet.points_balance}, need {pts}"
            )

        balance_before = wallet.points_balance
        wallet.points_balance -= pts
        wallet.save(update_fields=["points_balance", "updated_at"])

        PointTransaction.objects.create(
            merchant=wallet.merchant,
            customer=wallet.customer,
            membership=wallet.membership,
            wallet=wallet,
            transaction_type=transaction_type,
            points=-pts,
            balance_before=balance_before,
            balance_after=wallet.points_balance,
            description=description,
            order=order,
            reward=reward,
            mission=mission,
            punch_card=punch_card
        )


def update_wallet_streak(wallet: CustomerMerchantWallet, now=None) -> bool:
    """
    Update merchant-scoped streak based on order datetime.
    Requires a 12-hour gap between orders to increment the streak.
    Returns True if the streak was successfully incremented, False otherwise.
    """
    now = now or timezone.now()

    with transaction.atomic():
        wallet = _lock_wallet(wallet)

        last = wallet.last_order_datetime
        incremented = False

        if last is None:
            wallet.streak_days = 1
            incremented = True
        else:
            time_diff = now - last
            hours_diff = time_diff.total_seconds() / 3600.0

            if hours_diff >= 12 and hours_diff <= 36:
                # Between 12 and 36 hours is considered the next "day/streak period"
                wallet.streak_days += 1
                incremented = True
            elif hours_diff > 36:
                # Streak broken
                wallet.streak_days = 1
                incremented = True
            else:
                # Too soon (under 12 hours) - don't increment, don't update last_order_datetime for streak purposes
                return False

        wallet.last_order_datetime = now
        wallet.save(update_fields=["streak_days", "last_order_datetime", "updated_at"])
        return incremented


def transfer_points(sender_wallet: CustomerMerchantWallet, receiver_wallet: CustomerMerchantWallet, points: int, description: str = "") -> dict:
    """
    Transfer points between two wallets.
    Both wallets must belong to the same merchant.
    
    Returns dict with:
      - transfer_group: UUID used to link both transactions
      - sent_transaction: PointTransaction for sender
      - received_transaction: PointTransaction for receiver
    
    Raises ValueError on validation failure.
    """
    if sender_wallet.merchant_id != receiver_wallet.merchant_id:
        raise ValueError(
            "Cross-merchant transfers are not allowed. "
            "Sender and receiver must belong to the same merchant."
        )

    if points <= 0:
        raise ValueError("Transfer amount must be positive.")

    if sender_wallet.customer_id == receiver_wallet.customer_id:
        raise ValueError("Cannot transfer points to yourself.")

    with transaction.atomic():
        # Lock both wallets in ascending pk order to avoid deadlocks
        locked = list(
            CustomerMerchantWallet.objects.select_for_update()
            .filter(pk__in=[sender_wallet.pk, receiver_wallet.pk])
            .order_by("pk")
        )
        locked_by_pk = {w.pk: w for w in locked}
        sender_wallet = locked_by_pk.get(sender_wallet.pk)
        receiver_wallet = locked_by_pk.get(receiver_wallet.pk)

        if sender_wallet.points_balance < points:
            raise ValueError(
                f"Insufficient points: sender has {sender_wallet.points_balance}, needs {points}."
            )

        merchant = sender_wallet.merchant
        sender_customer = sender_wallet.customer
        receiver_customer = receiver_wallet.customer
        transfer_group = uuid.uuid4()

        # Deduct from sender
        sender_balance_before = sender_wallet.points_balance
        sender_wallet.points_balance -= points
        sender_wallet.save(update_fields=["points_balance", "updated_at"])

        sent_txn = PointTransaction.objects.create(
            merchant=merchant,
            customer=sender_customer,
            membership=sender_wallet.membership,
            wallet=sender_wallet,
            transaction_type="TRANSFER_SENT",
            points=-points,
            balance_before=sender_balance_before,
            balance_after=sender_wallet.points_balance,
            description=description or f"Transfer to {receiver_customer.full_name or receiver_customer.user.email}",
            transfer_group=transfer_group,
        )

        # Add to receiver
        receiver_balance_before = receiver_wallet.points_balance
        receiver_wallet.points_balance += points
        receiver_wallet.save(update_fields=["points_balance", "updated_at"])

        received_txn = PointTransaction.objects.create(
            merchant=merchant,
            customer=receiver_customer,
            membership=receiver_wallet.membership,
            wallet=receiver_wallet,
            transaction_type="TRANSFER_RECEIVED",
            points=points,
            balance_before=receiver_balance_before,
            balance_after=receiver_wallet.points_balance,
            description=description or f"Transfer from {sender_customer.full_name or sender_customer.user.email}",
            transfer_group=transfer_group,
        )

    return {
        "transfer_group": transfer_group,
        "sent_transaction": sent_txn,
        "received_transaction": received_txn,
    }
