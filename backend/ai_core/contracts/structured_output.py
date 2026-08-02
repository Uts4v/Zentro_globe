from dataclasses import dataclass, field
from typing import Any, Protocol, Mapping
from datetime import datetime


@dataclass(frozen=True)
class StructuredGenerationRequest:
    system_prompt: str
    user_prompt: str
    output_schema: type
    temperature: float = 0.2
    max_output_tokens: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StructuredGenerationResult:
    parsed: Any
    text: str | None = None
    provider: str = ""
    model: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int = 0
    provider_request_id: str | None = None
    finish_reason: str | None = None
