import json
import logging
import uuid
from datetime import date, datetime

from django.utils import timezone

from ..gateway.ai_gateway import get_gateway
from ..prompts.registry import prompt_registry
from ..prompts.daily_insights.schemas import DailyMerchantInsightSchema
from ..contracts.structured_output import StructuredGenerationRequest
from ..services.merchant_metrics import build_merchant_metrics
from ..services.response_validator import validate_insight_output
from ..models import AIRequest, AIArtifact
from ..constants import (
    REQUEST_STATUS_RUNNING, REQUEST_STATUS_COMPLETED, REQUEST_STATUS_FAILED,
    ARTIFACT_TYPE_DAILY_INSIGHT,
)
from ..exceptions import AIInvalidStructuredOutput, AIBusinessValidationFailed

logger = logging.getLogger(__name__)


def generate_daily_insight(merchant, report_date: date, request_obj: AIRequest | None = None):
    start = timezone.now()
    metrics = build_merchant_metrics(merchant, report_date)
    prompt_def = prompt_registry.get("daily_merchant_insights", "1.0.0")
    system_prompt = prompt_def["system_prompt"]
    user_prompt = prompt_def["build_user_prompt"](merchant.business_name, metrics)

    gateway = get_gateway()
    req = StructuredGenerationRequest(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        output_schema=DailyMerchantInsightSchema,
        temperature=0.2,
    )

    try:
        result = gateway.generate_structured(
            model_alias="merchant-insights",
            request=req,
            output_schema=DailyMerchantInsightSchema,
        )
    except Exception as e:
        logger.exception("Daily insight generation failed")
        if request_obj:
            request_obj.status = REQUEST_STATUS_FAILED
            request_obj.error_code = "generation_failed"
            request_obj.sanitized_error = str(e)[:500]
            request_obj.completed_at = timezone.now()
            request_obj.save(update_fields=["status", "error_code", "sanitized_error", "completed_at"])
        raise

    parsed = result.parsed
    errors = validate_insight_output(parsed, metrics)
    if errors:
        logger.warning(f"Fact validation failed: {errors}")
        if request_obj:
            request_obj.status = REQUEST_STATUS_FAILED
            request_obj.error_code = "fact_validation_failed"
            request_obj.sanitized_error = "; ".join(errors)[:500]
            request_obj.completed_at = timezone.now()
            request_obj.save(update_fields=["status", "error_code", "sanitized_error", "completed_at"])
        raise AIBusinessValidationFailed(f"Fact validation failed: {errors}")

    artifact = AIArtifact.objects.create(
        merchant=merchant,
        request=request_obj,
        artifact_type=ARTIFACT_TYPE_DAILY_INSIGHT,
        schema_version="1.0.0",
        title=f"Daily Insight - {report_date}",
        structured_content=parsed.model_dump(),
        effective_date=report_date,
        prompt_name="daily_merchant_insights",
        prompt_version="1.0.0",
        context_schema_version="merchant_metrics.v1",
    )

    if request_obj:
        request_obj.status = REQUEST_STATUS_COMPLETED
        request_obj.completed_at = timezone.now()
        request_obj.total_tokens = result.total_tokens
        request_obj.input_tokens = result.input_tokens
        request_obj.output_tokens = result.output_tokens
        request_obj.latency_ms = result.latency_ms
        request_obj.save(update_fields=[
            "status", "completed_at", "total_tokens",
            "input_tokens", "output_tokens", "latency_ms",
        ])

    return artifact
