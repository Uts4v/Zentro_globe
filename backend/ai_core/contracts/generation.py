from dataclasses import dataclass, field
from typing import Any, Mapping
from datetime import datetime


@dataclass(frozen=True)
class GenerationRequest:
    system_prompt: str
    user_prompt: str
    temperature: float = 0.2
    max_output_tokens: int | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GenerationUsage:
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(frozen=True)
class GenerationResult:
    text: str
    provider: str
    model: str
    usage: GenerationUsage
    latency_ms: int
    provider_request_id: str | None = None
    finish_reason: str | None = None
    raw_response_reference: str | None = None
