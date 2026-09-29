"""
Store PIN confirmation: the fallback when the store has no device to scan with.

The customer taps "Use now" on their offer and hands the phone over; staff type
the store's PIN. The PIN is stored hashed, guessing is locked out per customer
and per store, and the merchant is notified of every PIN redemption so a leaked
PIN is noticed quickly (and can be changed from the dashboard).
"""

from __future__ import annotations

import logging
import re

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.db import transaction

from .engine import OfferError, load_claim, redeem_in_store
from .models import MerchantRedemptionPin, VoucherClaim, VoucherRedemption

logger = logging.getLogger(__name__)

PIN_RE = re.compile(r"^\d{4,6}$")
CUSTOMER_MAX_FAILURES = 5
CUSTOMER_LOCK_SECONDS = 15 * 60
STORE_MAX_FAILURES = 20
STORE_WINDOW_SECONDS = 60 * 60


def validate_new_pin(pin: str) -> str:
    pin = str(pin or "").strip()
    if not PIN_RE.match(pin):
        raise OfferError("The PIN must be 4 to 6 digits.", code="INVALID_PIN")
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        raise OfferError("Choose a PIN that isn't a simple sequence like 1111 or 1234.", code="WEAK_PIN")
    return pin


def set_pin(merchant, pin: str) -> None:
    pin = validate_new_pin(pin)
    MerchantRedemptionPin.objects.update_or_create(merchant=merchant, defaults={"pin_hash": make_password(pin)})
    cache.delete(_store_key(merchant.pk))


def clear_pin(merchant) -> None:
    MerchantRedemptionPin.objects.filter(merchant=merchant).delete()


def pin_enabled(merchant) -> bool:
    return MerchantRedemptionPin.objects.filter(merchant=merchant).exists()


def _customer_key(merchant_id: int, customer_id: int) -> str:
    return f"offers:pin_fail:{merchant_id}:{customer_id}"


def _store_key(merchant_id: int) -> str:
    return f"offers:pin_fail_store:{merchant_id}"


def _bump(key: str, ttl: int) -> int:
    if cache.add(key, 1, ttl):
        return 1
    try:
        return cache.incr(key)
    except ValueError:
        cache.set(key, 1, ttl)
        return 1


def _notify_merchant(redemption) -> None:
    from notifications.services import send_notification

    merchant = redemption.merchant
    who = (redemption.customer.full_name or "A customer").split(" ")[0] if redemption.customer_id else "A customer"
    title = redemption.rules_snapshot.get("title") or "An offer"
    try:
        send_notification(
            user=merchant.user,
            title="Offer confirmed with your store PIN",
            message=f"{who} used “{title}”. If this wasn't your staff, change the PIN in Offers.",
            merchant_name=merchant.business_name,
            context_url="/merchant/offers",
            merchant_id=merchant.pk,
        )
    except Exception:
        logger.exception("offers.pin_notify_failed redemption=%s", redemption.pk)


def redeem_with_pin(claim_id: int, customer, pin: str, *, idempotency_key: str, bill_amount=None):
    """Confirm the customer's own claim with the store PIN. Returns ``(redemption, created)``."""
    try:
        claim = load_claim(int(claim_id))
    except (VoucherClaim.DoesNotExist, TypeError, ValueError):
        raise OfferError("Offer not found.", code="NOT_FOUND", status=404)
    if customer is None or claim.customer_id != customer.pk:
        raise OfferError("Offer not found.", code="NOT_FOUND", status=404)

    merchant = claim.merchant
    pin_row = MerchantRedemptionPin.objects.filter(merchant=merchant).first()
    if pin_row is None:
        raise OfferError("This store doesn't use PIN confirmation. Ask staff to scan your code.",
                         code="PIN_NOT_ENABLED")

    ckey, skey = _customer_key(merchant.pk, customer.pk), _store_key(merchant.pk)
    if (cache.get(skey) or 0) >= STORE_MAX_FAILURES:
        raise OfferError("PIN confirmation is paused at this store. Ask staff to scan your code.",
                         code="PIN_LOCKED", status=429)
    if (cache.get(ckey) or 0) >= CUSTOMER_MAX_FAILURES:
        raise OfferError("Too many wrong PINs. Try again in 15 minutes.", code="PIN_LOCKED", status=429)

    if not check_password(str(pin or "").strip(), pin_row.pin_hash):
        failures = _bump(ckey, CUSTOMER_LOCK_SECONDS)
        store_failures = _bump(skey, STORE_WINDOW_SECONDS)
        if store_failures == STORE_MAX_FAILURES:
            transaction.on_commit(lambda: _alert_store_locked(merchant))
        remaining = max(CUSTOMER_MAX_FAILURES - failures, 0)
        hint = f"{remaining} {'try' if remaining == 1 else 'tries'} left." if remaining else "Try again in 15 minutes."
        raise OfferError(f"Wrong PIN. {hint}", code="WRONG_PIN", status=403, details={"attempts_left": remaining})

    cache.delete(ckey)
    redemption, created = redeem_in_store(
        claim.pk, merchant, user=customer.user, idempotency_key=idempotency_key,
        bill_amount=bill_amount, confirmed_via=VoucherRedemption.CONFIRMED_PIN,
    )
    if created:
        transaction.on_commit(lambda: _notify_merchant(redemption))
    return redemption, created


def _alert_store_locked(merchant) -> None:
    from notifications.services import send_notification

    try:
        send_notification(
            user=merchant.user,
            title="Offer PIN paused",
            message="Too many wrong PIN attempts in the last hour. PIN confirmation is paused; "
                    "consider changing your store PIN in Offers.",
            merchant_name=merchant.business_name,
            context_url="/merchant/offers",
            merchant_id=merchant.pk,
        )
    except Exception:
        logger.exception("offers.pin_lock_notify_failed merchant=%s", merchant.pk)
