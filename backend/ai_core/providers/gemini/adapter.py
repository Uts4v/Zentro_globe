import json
import time
import logging
from typing import Any

from .client import GeminiClient
from ...contracts.structured_output import (
    StructuredGenerationRequest, StructuredGenerationResult,
)
from ...contracts.chat import (
    ChatRequest, ChatResult, ChatMessage,
    ToolDefinition, ToolCall, ToolResult,
)
from ...contracts.generation import GenerationRequest, GenerationResult, GenerationUsage
from ...exceptions import (
    AIProviderUnavailable, AIProviderTimeout, AIProviderRateLimited,
    AIInvalidStructuredOutput,
)

logger = logging.getLogger(__name__)


class GeminiAdapter:
    def __init__(self):
        self.client = GeminiClient()

    @property
    def provider_name(self) -> str:
        return "gemini"

    def _map_finish_reason(self, reason) -> str | None:
        if reason is None:
            return None
        return reason.name if hasattr(reason, "name") else str(reason)

    # ── Text Generation ──────────────────────────────────────────────────────────

    def generate(self, request: GenerationRequest) -> GenerationResult:
        start = time.monotonic()
        try:
            model = self.client.get_model(
                getattr(request.metadata, "model", "gemini-2.0-flash")
            )
            response = model.generate_content(
                f"{request.system_prompt}\n\n{request.user_prompt}",
                generation_config={
                    "temperature": request.temperature,
                    "max_output_tokens": request.max_output_tokens,
                },
            )
            latency = int((time.monotonic() - start) * 1000)
            usage = response.usage_metadata if hasattr(response, "usage_metadata") else None
            return GenerationResult(
                text=response.text,
                provider="gemini",
                model=model.model_name,
                usage=GenerationUsage(
                    input_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
                    output_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
                    total_tokens=getattr(usage, "total_token_count", None) if usage else None,
                ),
                latency_ms=latency,
                finish_reason=self._map_finish_reason(
                    getattr(response.candidates[0], "finish_reason", None)
                    if response.candidates else None
                ),
            )
        except Exception as e:
            logger.exception("Gemini generation failed")
            raise self._map_error(e)

    # ── Structured Generation ────────────────────────────────────────────────────

    def generate_structured(
        self, request: StructuredGenerationRequest,
    ) -> StructuredGenerationResult:
        start = time.monotonic()
        try:
            model = self.client.get_model(
                getattr(request.metadata, "model", "gemini-2.0-flash")
            )
            response = model.generate_content(
                f"{request.system_prompt}\n\n{request.user_prompt}",
                generation_config={
                    "temperature": request.temperature,
                    "max_output_tokens": request.max_output_tokens,
                    "response_mime_type": "application/json",
                },
            )
            latency = int((time.monotonic() - start) * 1000)
            text = response.text.strip()
            if text.startswith("```"):
                text = text.strip("`").strip()
                if text.startswith("json"):
                    text = text[4:].strip()
            try:
                data = json.loads(text)
                parsed = request.output_schema.model_validate(data)
            except (json.JSONDecodeError, Exception) as e:
                raise AIInvalidStructuredOutput(
                    f"Failed to parse structured output: {e}"
                ) from e

            usage = response.usage_metadata if hasattr(response, "usage_metadata") else None
            return StructuredGenerationResult(
                parsed=parsed,
                text=text,
                provider="gemini",
                model=model.model_name,
                input_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
                output_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
                total_tokens=getattr(usage, "total_token_count", None) if usage else None,
                latency_ms=latency,
                finish_reason=self._map_finish_reason(
                    getattr(response.candidates[0], "finish_reason", None)
                    if response.candidates else None
                ),
            )
        except AIInvalidStructuredOutput:
            raise
        except Exception as e:
            logger.exception("Gemini structured generation failed")
            raise self._map_error(e)

    # ── Chat ──────────────────────────────────────────────────────────────────────

    def chat(self, request: ChatRequest) -> ChatResult:
        start = time.monotonic()
        try:
            model_name = getattr(request.metadata, "model", "gemini-2.0-flash")
            model = self.client.get_model(model_name)

            history = []
            for msg in request.messages:
                history.append({
                    "role": "user" if msg.role == "user" else "model",
                    "parts": [msg.content],
                })

            chat_session = model.start_chat(history=history)
            response = chat_session.send_message(
                request.messages[-1].content if request.messages else "",
                generation_config={
                    "temperature": request.temperature,
                    "max_output_tokens": request.max_output_tokens,
                },
            )
            latency = int((time.monotonic() - start) * 1000)

            usage = response.usage_metadata if hasattr(response, "usage_metadata") else None
            return ChatResult(
                message=ChatMessage(
                    role="assistant",
                    content=response.text,
                ),
                provider="gemini",
                model=model.model_name,
                input_tokens=getattr(usage, "prompt_token_count", None) if usage else None,
                output_tokens=getattr(usage, "candidates_token_count", None) if usage else None,
                total_tokens=getattr(usage, "total_token_count", None) if usage else None,
                latency_ms=latency,
                finish_reason=self._map_finish_reason(
                    getattr(response.candidates[0], "finish_reason", None)
                    if response.candidates else None
                ),
            )
        except Exception as e:
            logger.exception("Gemini chat failed")
            raise self._map_error(e)

    def _map_error(self, error: Exception) -> Exception:
        msg = str(error).lower()
        if "quota" in msg or "rate" in msg:
            return AIProviderRateLimited(str(error))
        if "timeout" in msg or "deadline" in msg:
            return AIProviderTimeout(str(error))
        if "unavailable" in msg or "down" in msg or "503" in msg:
            return AIProviderUnavailable(str(error))
        return AIProviderUnavailable(str(error))
