from django.test import TestCase
from ..contracts.structured_output import StructuredGenerationRequest, StructuredGenerationResult
from ..contracts.generation import GenerationRequest, GenerationResult, GenerationUsage
from ..contracts.chat import ChatRequest, ChatMessage, ChatResult, ToolDefinition


class ContractTests(TestCase):
    def test_generation_request_immutable(self):
        req = GenerationRequest(system_prompt="s", user_prompt="u")
        with self.assertRaises(AttributeError):
            req.system_prompt = "changed"

    def test_generation_result_has_all_fields(self):
        usage = GenerationUsage(input_tokens=10, output_tokens=20, total_tokens=30)
        result = GenerationResult(
            text="hello", provider="test", model="m",
            usage=usage, latency_ms=100,
        )
        self.assertEqual(result.text, "hello")
        self.assertEqual(result.usage.total_tokens, 30)

    def test_chat_request_with_tools(self):
        tool = ToolDefinition(name="test", description="A test tool", parameters={"type": "object"})
        msg = ChatMessage(role="user", content="hi")
        req = ChatRequest(system_prompt="sys", messages=[msg], tools=[tool])
        self.assertEqual(len(req.tools), 1)
        self.assertEqual(req.tools[0].name, "test")
