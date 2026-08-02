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
    ChatRequest, ChatResult, ChatMessage, ToolCall,
)
from ...contracts.generation import GenerationRequest, GenerationResult, GenerationUsage
from ...exceptions import (
    AIProviderUnavailable, AIProviderTimeout, AIProviderRateLimited,
    AIInvalidStructuredOutput, AIConfigurationError,
)

logger = logging.getLogger(__name__)


class GroqAdapter:
    BASE_URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self):
        self.api_key = getattr(settings, "GROQ_API_KEY", "")
        if not self.api_key:
            raise AIConfigurationError("GROQ_API_KEY is not configured")

    @property
    def provider_name(self) -> str:
        return "groq"

    def _get_model(self, metadata) -> str:
        if isinstance(metadata, dict):
            return metadata.get("model") or "llama-3.1-8b-instant"
        return getattr(metadata, "model", "llama-3.1-8b-instant")

    def _chat_completion(
        self, model: str, messages: list[dict], temperature: float, max_tokens: int | None,
        tools: list[dict] | None = None, tool_choice: str | None = None,
    ) -> dict:
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens:
            payload["max_tokens"] = max_tokens
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice or "auto"

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        try:
            r = requests.post(
                self.BASE_URL,
                json=payload,
                headers=headers,
                timeout=60,
            )
            if r.status_code == 429:
                raise AIProviderRateLimited(r.text)
            if r.status_code == 400 and tools:
                body = r.json()
                err = body.get("error") or {}
                err_msg = err.get("message", "") or ""
                err_code = err.get("code", "") or ""
                if "tool call validation failed" in err_msg or "tool_use_failed" in err_msg or err_code == "tool_use_failed":
                    tool_defs = "; ".join(
                        f"{t['function']['name']}({', '.join(t['function'].get('parameters', {}).get('properties', {}).keys())})"
                        for t in tools
                    )
                    return {
                        "choices": [{"message": {
                            "role": "assistant",
                            "content": f"I need to call a function using valid JSON format. Available tools: {tool_defs}. I must format my response as a JSON tool call with 'name' and 'arguments' fields.",
                        }}],
                        "usage": {},
                        "_synthetic": True,
                    }
            r.raise_for_status()
            data = r.json()
            return data
        except requests.exceptions.Timeout:
            raise AIProviderTimeout("Groq request timed out")
        except requests.exceptions.HTTPError as e:
            raise AIProviderUnavailable(f"Groq API error {r.status_code}: {r.text}")
        except requests.ConnectionError:
            raise AIProviderUnavailable("Cannot connect to Groq API")

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
            provider="groq",
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
            provider="groq",
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
            entry = {"role": msg.role, "content": msg.content}
            if msg.tool_call_id:
                entry["tool_call_id"] = msg.tool_call_id
            if msg.name:
                entry["name"] = msg.name
            if msg.tool_calls:
                entry["tool_calls"] = msg.tool_calls
            messages.append(entry)

        tools_payload = None
        if request.tools:
            tools_payload = []
            for t in request.tools:
                tools_payload.append({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                })

        data = self._chat_completion(
            model, messages, request.temperature, request.max_output_tokens,
            tools=tools_payload, tool_choice=request.tool_choice,
        )

        latency = int((time.monotonic() - start) * 1000)
        choice = data["choices"][0]
        msg = choice["message"]

        tool_calls = None
        if "tool_calls" in msg and msg["tool_calls"]:
            tool_calls = []
            for tc in msg["tool_calls"]:
                try:
                    args = json.loads(tc["function"]["arguments"])
                except (json.JSONDecodeError, KeyError):
                    args = {}
                tool_calls.append(ToolCall(
                    id=tc["id"],
                    name=tc["function"]["name"],
                    arguments=args,
                ))

        return ChatResult(
            message=ChatMessage(
                role=msg["role"],
                content=msg.get("content") or "",
            ),
            tool_calls=tool_calls,
            provider="groq",
            model=model,
            input_tokens=data.get("usage", {}).get("prompt_tokens"),
            output_tokens=data.get("usage", {}).get("completion_tokens"),
            total_tokens=data.get("usage", {}).get("total_tokens"),
            latency_ms=latency,
            finish_reason=choice.get("finish_reason"),
        )
