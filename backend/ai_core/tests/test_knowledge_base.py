from django.test import TestCase

from ..tools.knowledge_base import (
    get_knowledge_base,
    _load_sections,
    register_knowledge_base_tools,
)
from ..tools.registry import tool_registry


class KnowledgeBaseToolTests(TestCase):
    def test_sections_are_loaded_from_document(self):
        sections = _load_sections()
        self.assertTrue(sections)
        headings = [s["heading"].lower() for s in sections]
        self.assertTrue(any("loyalty" in h for h in headings))
        self.assertTrue(any("faq" in h for h in headings))

    def test_known_question_returns_relevant_sections(self):
        result = get_knowledge_base(merchant=None, query="how do customers earn points")
        self.assertEqual(result["query"], "how do customers earn points")
        self.assertTrue(result["matched_sections"])
        joined = (result["content"] or "").lower()
        self.assertIn("loyalty", joined)
        self.assertIn("points", joined)

    def test_no_match_returns_empty_message(self):
        result = get_knowledge_base(merchant=None, query="zzqxwvyqqr klargn")
        self.assertEqual(result["matched_sections"], [])
        self.assertIn("message", result)

    def test_empty_query_returns_general_sections(self):
        result = get_knowledge_base(merchant=None, query="")
        self.assertTrue(result["matched_sections"])
        joined = (result["content"] or "").lower()
        self.assertIn("faq", joined)

    def test_tool_is_registered(self):
        register_knowledge_base_tools()
        tool = tool_registry.get("get_knowledge_base")
        self.assertEqual(tool["name"], "get_knowledge_base")
        self.assertIn("query", tool["parameters"].get("properties", {}))
