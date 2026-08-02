from django.test import TestCase
from ..api.serializers import ChatInputSerializer, DailyInsightGenerateSerializer


class SerializerTests(TestCase):
    def test_chat_input_valid(self):
        ser = ChatInputSerializer(data={"message": "Hello"})
        self.assertTrue(ser.is_valid())

    def test_chat_input_with_conversation(self):
        ser = ChatInputSerializer(data={
            "message": "Hello",
            "conversation_id": "550e8400-e29b-41d4-a716-446655440000",
        })
        self.assertTrue(ser.is_valid())

    def test_chat_input_missing_message(self):
        ser = ChatInputSerializer(data={})
        self.assertFalse(ser.is_valid())

    def test_daily_insight_generate(self):
        ser = DailyInsightGenerateSerializer(data={})
        self.assertTrue(ser.is_valid())
