"""Cache invalidation for hot read endpoints in the merchants app.

Menu and profile caches must be dropped whenever the underlying data changes
so customers never see stale menus/availability.
"""

from django.core.cache import cache
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import MenuItem, MerchantProfile


def _invalidate_merchant(merchant_id: int) -> None:
    cache.delete(f"zentro:menu:{merchant_id}")
    bump_merchant_analytics_version(merchant_id)


def bump_merchant_analytics_version(merchant_id: int) -> None:
    """Invalidate all cached analytics responses for this merchant across all date ranges."""
    if not merchant_id:
        return
    try:
        ver = cache.get(f"zentro:analytics_ver:{merchant_id}", 1)
        cache.set(f"zentro:analytics_ver:{merchant_id}", ver + 1, timeout=None)
    except Exception:
        pass
    delete_pattern = getattr(cache, "delete_pattern", None)
    if delete_pattern is not None:
        try:
            delete_pattern(f"zentro:analytics:{merchant_id}:*")
        except (NotImplementedError, TypeError):
            pass


@receiver(post_save, sender=MerchantProfile, dispatch_uid="merchants_profile_cache_invalidate")
def _on_merchant_profile_saved(sender, instance, **kwargs):
    cache.delete("zentro:merchants_list")
    cache.delete(f"zentro:pk:{instance.pk}")
    if instance.slug:
        cache.delete(f"zentro:slug:{instance.slug}")
    _invalidate_merchant(instance.pk)


@receiver(post_delete, sender=MerchantProfile, dispatch_uid="merchants_profile_cache_invalidate_delete")
def _on_merchant_profile_deleted(sender, instance, **kwargs):
    cache.delete("zentro:merchants_list")
    if instance.slug:
        cache.delete(f"zentro:slug:{instance.slug}")
    _invalidate_merchant(instance.pk)


@receiver(post_save, sender=MenuItem, dispatch_uid="merchants_menu_item_cache_invalidate")
@receiver(post_delete, sender=MenuItem, dispatch_uid="merchants_menu_item_cache_invalidate_delete")
def _on_menu_item_changed(sender, instance, **kwargs):
    if instance.merchant_id:
        cache.delete(f"zentro:menu:{instance.merchant_id}")


# Invalidate analytics cache whenever an order or order item changes
def _connect_order_signals():
    try:
        from orders.models import Order, OrderItem
        from pos.models import PosPayment

        @receiver(post_save, sender=Order, dispatch_uid="analytics_order_saved")
        @receiver(post_delete, sender=Order, dispatch_uid="analytics_order_deleted")
        def _on_order_changed(sender, instance, **kwargs):
            if instance.merchant_id:
                bump_merchant_analytics_version(instance.merchant_id)

        @receiver(post_save, sender=OrderItem, dispatch_uid="analytics_order_item_saved")
        @receiver(post_delete, sender=OrderItem, dispatch_uid="analytics_order_item_deleted")
        def _on_order_item_changed(sender, instance, **kwargs):
            if instance.order and instance.order.merchant_id:
                bump_merchant_analytics_version(instance.order.merchant_id)

        @receiver(post_save, sender=PosPayment, dispatch_uid="analytics_pos_payment_saved")
        @receiver(post_delete, sender=PosPayment, dispatch_uid="analytics_pos_payment_deleted")
        def _on_payment_changed(sender, instance, **kwargs):
            m_id = None
            if instance.order and instance.order.merchant_id:
                m_id = instance.order.merchant_id
            elif instance.shift and instance.shift.device and instance.shift.device.merchant_id:
                m_id = instance.shift.device.merchant_id
            if m_id:
                bump_merchant_analytics_version(m_id)
    except Exception:
        pass


_connect_order_signals()