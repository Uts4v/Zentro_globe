import logging

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger(__name__)


class AiCoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ai_core"
    verbose_name = "AI Core"

    def ready(self):
        from .providers.registry import provider_registry
        from .prompts.merchant_assistant import v1 as _ma_prompt  # noqa: F401
        from .prompts.daily_insights import v1 as _di_prompt  # noqa: F401

        if not getattr(settings, "GROQ_API_KEY", ""):
            logger.warning("GROQ_API_KEY not set — Groq provider disabled")
            return

        from .providers.groq.adapter import GroqAdapter

        provider_registry.register(
            "groq",
            GroqAdapter(),
            capabilities=["text_generation", "structured_generation", "chat"],
        )
