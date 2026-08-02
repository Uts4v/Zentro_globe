import json
import time
import logging
from typing import Any

import requests

from django.conf import settings

from ...contracts.structured_output import (
    StructuredGenerationRequest, StructuredGenerationResult,
)
from ...contracts.chat import (
    ChatRequest, ChatResult, ChatMessage,
)
from ...contracts.generation import GenerationRequest, GenerationResult, GenerationUsage
from ...exceptions import (
    AIProviderUnavailable, AIProviderTimeout, AIProviderRateLimited,
    AIInvalidStructuredOutput, AIConfigurationError,
)

logger = logging.getLogger(__name__)


class OllamaAdapter:
    def __init__(self):
        self.base_url = getattr(settings, "OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
        self._check_availability()

    @property
    def provider_name(self) -> str:
        return "ollama"

    def _check_availability(self):
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=5)
            if r.status_code != 200:
                logger.warning("Ollama not fully available (status %s)", r.status_code)
        except requests.ConnectionError:
            raise AIConfigurationError(
                f"Cannot connect to Ollama at {self.base_url}. Is Ollama running?"
            )

    def _get_model(self, metadata) -> str:
        model = getattr(metadata, "model", None)
        if isinstance(metadata, dict):
            model = metadata.get("model")
        return model or "qwen3:4b"

    def _chat_completion(
        self, model: str, messages: list[dict], temperature: float, max_tokens: int | None,
    ) -> dict:
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }
        if max_tokens:
            payload["options"]["num_predict"] = max_tokens

        try:
            r = requests.post(
                f"{self.base_url}/v1/chat/completions",
                json=payload,
                timeout=120,
            )
            r.raise_for_status()
            return r.json()
        except requests.exceptions.Timeout:
            raise AIProviderTimeout("Ollama request timed out")
        except requests.exceptions.HTTPError as e:
            if r.status_code == 429:
                raise AIProviderRateLimited(str(e))
            raise AIProviderUnavailable(str(e))
        except requests.ConnectionError:
            raise AIProviderUnavailable(f"Cannot connect to Ollama at {self.base_url}")

    def _extract_usage(self, data: dict) -> GenerationUsage:
        usage = data.get("usage") or {}
        return GenerationUsage(
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
        )

    def _build_messages(self, system_prompt: str, user_prompt: str) -> list[dict]:
        msgs = []
        if system_prompt:
            msgs.append({"role": "system", "content": system_prompt})
        msgs.append({"role": "user", "content": user_prompt})
        return msgs

    # ── Text Generation ──────────────────────────────────────────────────────

    def generate(self, request: GenerationRequest) -> GenerationResult:
        start = time.monotonic()
        model = self._get_model(request.metadata)
        messages = self._build_messages(request.system_prompt, request.user_prompt)

        data = self._chat_completion(
            model, messages, request.temperature, request.max_output_tokens,
        )

        latency = int((time.monotonic() - start) * 1000)
        choice = data["choices"][0]
        return GenerationResult(
            text=choice["message"]["content"],
            provider="ollama",
            model=model,
            usage=self._extract_usage(data),
            latency_ms=latency,
            finish_reason=choice.get("finish_reason"),
        )

    # ── Structured Generation ────────────────────────────────────────────────

    def generate_structured(
        self, request: StructuredGenerationRequest,
    ) -> StructuredGenerationResult:
        start = time.monotonic()
        model = self._get_model(request.metadata)
        system = request.system_prompt
        if system:
            system += "\n\nYou MUST respond with valid JSON only, no markdown, no explanation."
        else:
            system = "You MUST respond with valid JSON only, no markdown, no explanation."

        messages = self._build_messages(system, request.user_prompt)

        data = self._chat_completion(
            model, messages, request.temperature, request.max_output_tokens,
        )

        latency = int((time.monotonic() - start) * 1000)
        text = data["choices"][0]["message"]["content"].strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
            if text.startswith("json"):
                text = text[4:].strip()
        try:
            parsed = request.output_schema.model_validate(json.loads(text))
        except (json.JSONDecodeError, Exception) as e:
            raise AIInvalidStructuredOutput(
                f"Failed to parse structured output: {e}"
            ) from e

        return StructuredGenerationResult(
            parsed=parsed,
            text=text,
            provider="ollama",
            model=model,
            input_tokens=None,
            output_tokens=None,
            total_tokens=None,
            latency_ms=latency,
            finish_reason=data["choices"][0].get("finish_reason"),
        )

    # ── Chat ─────────────────────────────────────────────────────────────────

    def chat(self, request: ChatRequest) -> ChatResult:
        start = time.monotonic()
        model = self._get_model(request.metadata)

        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})

        data = self._chat_completion(
            model, messages, request.temperature, request.max_output_tokens,
        )

        latency = int((time.monotonic() - start) * 1000)
        choice = data["choices"][0]
        return ChatResult(
            message=ChatMessage(
                role=choice["message"]["role"],
                content=choice["message"]["content"],
            ),
            provider="ollama",
            model=model,
            input_tokens=None,
            output_tokens=None,
            total_tokens=None,
            latency_ms=latency,
            finish_reason=choice.get("finish_reason"),
        )
