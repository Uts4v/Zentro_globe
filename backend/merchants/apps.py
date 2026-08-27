from django.apps import AppConfig


class MerchantsConfig(AppConfig):
    name = "merchants"
    default_auto_field = "django.db.models.BigAutoField"

    def ready(self):
        from . import signals  # noqa: F401
