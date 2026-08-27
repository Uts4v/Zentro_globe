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
    # RedisCache supports delete_pattern; LocMemCache does not (TTL covers it).
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