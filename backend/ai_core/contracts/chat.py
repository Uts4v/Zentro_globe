from dataclasses import dataclass, field
from typing import Any, Protocol, Mapping


@dataclass(frozen=True)
class ChatMessage:
    role: str  # "user" | "assistant" | "system" | "tool"
    content: str
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None
    name: str | None = None


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict  # JSON Schema


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass(frozen=True)
class ToolResult:
    tool_call_id: str
    name: str
    content: str


@dataclass(frozen=True)
class ChatRequest:
    system_prompt: str
    messages: list[ChatMessage]
    tools: list[ToolDefinition] | None = None
    temperature: float = 0.3
    max_output_tokens: int | None = None
    tool_choice: str | None = None  # "auto" | "required" | "none" | None (defaults to "auto" by provider)
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ChatResult:
    message: ChatMessage
    tool_calls: list[ToolCall] | None = None
    provider: str = ""
    model: str = ""
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    latency_ms: int = 0
    provider_request_id: str | None = None
    finish_reason: str | None = None
