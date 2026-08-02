from unittest.mock import patch, MagicMock
from django.test import TestCase
from ..providers.registry import ProviderRegistry
from ..providers.base import TextGenerationProvider, StructuredGenerationProvider, ChatProvider
from ..exceptions import AIConfigurationError


class FakeAdapter:
    def generate(self, request):
        return None

    def generate_structured(self, request):
        return None

    def chat(self, request):
        return None

    def health_check(self):
        return {"status": "ok"}


class ProviderRegistryTests(TestCase):
    def test_register_and_get(self):
        registry = ProviderRegistry()
        adapter = FakeAdapter()
        registry.register("test", adapter, ["text_generation", "chat"])
        self.assertEqual(registry.get("test"), adapter)

    def test_register_missing_capability(self):
        registry = ProviderRegistry()
        with self.assertRaises(AIConfigurationError):
            registry.register("bad", object(), ["text_generation"])

    def test_capabilities(self):
        registry = ProviderRegistry()
        adapter = FakeAdapter()
        registry.register("test", adapter, ["text_generation", "chat"])
        self.assertTrue(registry.has_capability("test", "text_generation"))
        self.assertFalse(registry.has_capability("test", "structured_generation"))

    def test_get_unknown_provider(self):
        registry = ProviderRegistry()
        with self.assertRaises(AIConfigurationError):
            registry.get("nonexistent")
