from django.conf import settings

from ..exceptions import AIConfigurationError


class ModelRegistry:
    def resolve(self, alias: str) -> dict:
        aliases = getattr(settings, "AI_MODEL_ALIASES", {})
        entry = aliases.get(alias)
        if not entry:
            raise AIConfigurationError(f"Model alias '{alias}' is not configured")
        return dict(entry)


model_registry = ModelRegistry()
