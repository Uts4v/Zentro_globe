from typing import Any
from django.conf import settings

from .base import CAPABILITY_TO_PROTOCOL
from ..exceptions import AIConfigurationError


class ProviderRegistry:
    def __init__(self):
        self._adapters: dict[str, Any] = {}

    def register(self, name: str, adapter: Any, capabilities: list[str]):
        for cap in capabilities:
            protocol = CAPABILITY_TO_PROTOCOL.get(cap)
            if protocol and not isinstance(adapter, protocol):
                raise AIConfigurationError(
                    f"Provider '{name}' does not implement {protocol.__name__} for capability '{cap}'"
                )
        self._adapters[name] = {
            "adapter": adapter,
            "capabilities": set(capabilities),
        }

    def get(self, name: str) -> Any:
        entry = self._adapters.get(name)
        if not entry:
            raise AIConfigurationError(f"Provider '{name}' is not registered")
        return entry["adapter"]

    def get_capabilities(self, name: str) -> set[str]:
        entry = self._adapters.get(name)
        if not entry:
            return set()
        return entry["capabilities"]

    def has_capability(self, name: str, capability: str) -> bool:
        return capability in self.get_capabilities(name)

    def all_providers(self) -> list[str]:
        return list(self._adapters.keys())

    @classmethod
    def from_settings(cls):
        registry = cls()
        alias_config = getattr(settings, "AI_MODEL_ALIASES", {})
        for alias, config in alias_config.items():
            provider_name = config.get("provider", "")
            if provider_name and provider_name not in registry._adapters:
                registry._adapters.setdefault(provider_name, {
                    "adapter": None,
                    "capabilities": set(),
                })
        return registry


provider_registry = ProviderRegistry()
