import google.generativeai as genai
from django.conf import settings

from ...exceptions import AIProviderUnavailable, AIConfigurationError


class GeminiClient:
    def __init__(self):
        api_key = getattr(settings, "AI_GEMINI_API_KEY", "")
        if not api_key:
            raise AIConfigurationError("GEMINI_API_KEY is not configured")
        genai.configure(api_key=api_key)
        self._client = genai

    def get_model(self, model_name: str):
        return self._client.GenerativeModel(model_name=model_name)

    def count_tokens(self, model_name: str, text: str) -> int:
        try:
            model = self.get_model(model_name)
            return model.count_tokens(text).total_tokens
        except Exception:
            return 0
