from django.test import TestCase
from ..services.merchant_metrics import build_merchant_metrics
from ..services.response_validator import validate_insight_output
from ..prompts.daily_insights.schemas import DailyMerchantInsightSchema


class MockParsed:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


class ResponseValidatorTests(TestCase):
    def test_valid_output_passes(self):
        metrics = {
            "sales": {"today": 1000.0, "order_count": 50},
            "top_products": [],
        }
        parsed = DailyMerchantInsightSchema(
            report_date="2026-07-29",
            executive_summary="Good sales day",
            positive_signals=["Revenue up"],
            concerns=["None"],
            recommendations=[],
            metrics_referenced=["sales"],
            confidence=0.9,
        )
        errors = validate_insight_output(parsed, metrics)
        self.assertEqual(errors, [])

    def test_mismatched_revenue_detected(self):
        metrics = {
            "sales": {"today": 500.0, "order_count": 25},
            "top_products": [],
        }

        class BadRec:
            title = "Bad rec"
            explanation = "x"
            priority = "high"
            suggested_action = "y"
            evidence = []

        parsed = DailyMerchantInsightSchema(
            report_date="2026-07-29",
            executive_summary="Revenue was $10000",
            positive_signals=[],
            concerns=[],
            recommendations=[],
            metrics_referenced=["sales"],
            confidence=0.9,
        )
        errors = validate_insight_output(parsed, metrics)
        self.assertIsInstance(errors, list)

    def test_empty_metrics(self):
        metrics = {
            "sales": {"today": 0, "order_count": 0},
            "top_products": [],
        }
        parsed = DailyMerchantInsightSchema(
            report_date="2026-07-29",
            executive_summary="No data",
            positive_signals=[],
            concerns=["No orders"],
            recommendations=[],
            metrics_referenced=[],
            confidence=0.5,
        )
        errors = validate_insight_output(parsed, metrics)
        self.assertEqual(errors, [])
