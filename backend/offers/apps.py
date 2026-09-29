from django.apps import AppConfig


class OffersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "offers"
    verbose_name = "Zentro Offers"

    def ready(self):
        from orders.pricing import ADJ_PROMOTION, register_adjustment_resolver

        from . import signals  # noqa: F401  (connects order lifecycle handlers)
        from .engine import resolve_promotion_adjustment

        register_adjustment_resolver(ADJ_PROMOTION, resolve_promotion_adjustment)
