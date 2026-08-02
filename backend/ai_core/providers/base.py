from typing import Protocol, runtime_checkable

from ..contracts.generation import GenerationRequest, GenerationResult
from ..contracts.structured_output import StructuredGenerationRequest, StructuredGenerationResult
from ..contracts.chat import ChatRequest, ChatResult


@runtime_checkable
class TextGenerationProvider(Protocol):
    def generate(self, request: GenerationRequest) -> GenerationResult:
        ...


@runtime_checkable
class StructuredGenerationProvider(Protocol):
    def generate_structured(
        self, request: StructuredGenerationRequest,
    ) -> StructuredGenerationResult:
        ...


@runtime_checkable
class ChatProvider(Protocol):
    def chat(self, request: ChatRequest) -> ChatResult:
        ...


@runtime_checkable
class ProviderHealthCheck(Protocol):
    def health_check(self) -> dict:
        ...


CAPABILITY_TO_PROTOCOL = {
    "text_generation": TextGenerationProvider,
    "structured_generation": StructuredGenerationProvider,
    "chat": ChatProvider,
}
