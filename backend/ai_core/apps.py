from django.apps import AppConfig


class AiCoreConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "ai_core"
    verbose_name = "AI Core"

    def ready(self):
        from .providers.registry import provider_registry
        from .providers.groq.adapter import GroqAdapter
        from .prompts.merchant_assistant import v1 as _ma_prompt  # noqa: F401
        from .prompts.daily_insights import v1 as _di_prompt  # noqa: F401

        provider_registry.register(
            "groq",
            GroqAdapter(),
            capabilities=["text_generation", "structured_generation", "chat"],
        )
