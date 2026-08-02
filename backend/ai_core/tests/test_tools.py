from django.test import TestCase
from ..tools.registry import ToolRegistry
from ..exceptions import AIToolNotFound


class ToolRegistryTests(TestCase):
    def test_register_and_execute(self):
        registry = ToolRegistry()

        def my_tool(*, merchant, x: int = 1):
            return f"result-{x}"

        registry.register(my_tool, name="my_tool", description="A test tool")
        result = registry.execute("my_tool", merchant=None, arguments={"x": 5})
        self.assertEqual(result, "result-5")

    def test_tool_not_found(self):
        registry = ToolRegistry()
        result = registry.execute("nonexistent", merchant=None, arguments={})
        self.assertIn("error", result)
        self.assertIn("not available", result)

    def test_list_definitions(self):
        registry = ToolRegistry()

        def tool_a(*, merchant):
            return "a"

        registry.register(tool_a, name="tool_a", description="Tool A")
        defs = registry.list_definitions()
        self.assertEqual(len(defs), 1)
        self.assertEqual(defs[0]["name"], "tool_a")
