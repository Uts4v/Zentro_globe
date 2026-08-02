import logging

from ..exceptions import AIUnsupportedCapability

logger = logging.getLogger(__name__)


class ModelRouter:
    def __init__(self, model_registry, provider_registry):
        self.model_registry = model_registry
        self.provider_registry = provider_registry

    def resolve(self, alias: str) -> dict:
        entry = self.model_registry.resolve(alias)
        provider_name = entry.get("provider", "")
        required = set(entry.get("capabilities", []))
        available = self.provider_registry.get_capabilities(provider_name)
        missing = required - available
        if missing:
            raise AIUnsupportedCapability(
                f"Provider '{provider_name}' missing capabilities: {', '.join(missing)}"
            )
        adapter = self.provider_registry.get(provider_name)
        return {
            "adapter": adapter,
            "provider": provider_name,
            "model": entry.get("model", ""),
            "capabilities": required,
            "fallback_alias": entry.get("fallback_alias"),
        }


model_router = None  # Initialized by AIGateway
