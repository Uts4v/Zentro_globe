import time
import logging
import uuid

from django.conf import settings

from ..routing.model_registry import ModelRegistry, model_registry
from ..routing.model_router import ModelRouter
from ..providers.registry import ProviderRegistry, provider_registry
from ..contracts.structured_output import (
    StructuredGenerationRequest, StructuredGenerationResult,
)
from ..contracts.chat import ChatRequest, ChatResult
from ..contracts.generation import GenerationRequest, GenerationResult
from ..exceptions import AIError, AIQuotaExceeded, AIPermissionDenied

logger = logging.getLogger(__name__)


class AIGateway:
    def __init__(
        self,
        model_registry: ModelRegistry,
        provider_registry: ProviderRegistry,
    ):
        self.model_registry = model_registry
        self.provider_registry = provider_registry
        self.router = ModelRouter(model_registry, provider_registry)

    def generate_structured(
        self,
        model_alias: str,
        request: StructuredGenerationRequest,
        output_schema: type,
        tenant_context: dict | None = None,
    ) -> StructuredGenerationResult:
        resolved = self.router.resolve(model_alias)
        adapter = resolved["adapter"]
        req = StructuredGenerationRequest(
            system_prompt=request.system_prompt,
            user_prompt=request.user_prompt,
            output_schema=output_schema,
            temperature=request.temperature,
            max_output_tokens=request.max_output_tokens,
            metadata={**request.metadata, "model": resolved["model"]},
        )
        result = adapter.generate_structured(req)
        return result

    def chat(
        self,
        model_alias: str,
        request: ChatRequest,
        tenant_context: dict | None = None,
    ) -> ChatResult:
        resolved = self.router.resolve(model_alias)
        adapter = resolved["adapter"]
        req = ChatRequest(
            system_prompt=request.system_prompt,
            messages=request.messages,
            tools=request.tools,
            temperature=request.temperature,
            max_output_tokens=request.max_output_tokens,
            tool_choice=request.tool_choice,
            metadata={**request.metadata, "model": resolved["model"]},
        )
        result = adapter.chat(req)
        return result

    def generate(
        self,
        model_alias: str,
        request: GenerationRequest,
        tenant_context: dict | None = None,
    ) -> GenerationResult:
        resolved = self.router.resolve(model_alias)
        adapter = resolved["adapter"]
        req = GenerationRequest(
            system_prompt=request.system_prompt,
            user_prompt=request.user_prompt,
            temperature=request.temperature,
            max_output_tokens=request.max_output_tokens,
            metadata={**request.metadata, "model": resolved["model"]},
        )
        result = adapter.generate(req)
        return result

    def health_check(self, provider_name: str | None = None) -> dict:
        if provider_name:
            adapter = self.provider_registry.get(provider_name)
            if hasattr(adapter, "health_check"):
                return adapter.health_check()
            return {"provider": provider_name, "status": "unknown"}
        results = {}
        for name in self.provider_registry.all_providers():
            adapter = self.provider_registry.get(name)
            if hasattr(adapter, "health_check"):
                results[name] = adapter.health_check()
            else:
                results[name] = {"status": "unknown"}
        return results


def get_gateway() -> AIGateway:
    return AIGateway(
        model_registry=model_registry,
        provider_registry=provider_registry,
    )
