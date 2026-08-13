import logging
from datetime import date

from celery import shared_task
from django.utils import timezone

from ..models import AIRequest, AIArtifact
from ..use_cases.daily_merchant_insights import generate_daily_insight
from ..constants import (
    REQUEST_STATUS_RUNNING, REQUEST_STATUS_COMPLETED, REQUEST_STATUS_FAILED,
)

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="ai_core.tasks.generate_merchant_report", max_retries=2)
def generate_merchant_report(self, merchant_id: int, report_date_str: str, request_id: str | None = None):
    from merchants.models import MerchantProfile
    try:
        merchant = MerchantProfile.objects.get(id=merchant_id)
    except MerchantProfile.DoesNotExist:
        logger.error(f"Merchant {merchant_id} not found")
        return

    report_date = date.fromisoformat(report_date_str)
    request_obj = None
    if request_id:
        try:
            request_obj = AIRequest.objects.get(id=request_id)
            request_obj.status = REQUEST_STATUS_RUNNING
            request_obj.started_at = timezone.now()
            request_obj.save(update_fields=["status", "started_at"])
        except AIRequest.DoesNotExist:
            pass

    try:
        artifact = generate_daily_insight(merchant, report_date, request_obj)
        logger.info(f"Daily insight generated for merchant {merchant_id}: {artifact.id}")
    except Exception as e:
        logger.exception(f"Failed to generate daily insight for merchant {merchant_id}")
        if request_obj:
            request_obj.status = REQUEST_STATUS_FAILED
            request_obj.error_code = "task_failed"
            request_obj.sanitized_error = str(e)[:500]
            request_obj.completed_at = timezone.now()
            request_obj.save(update_fields=["status", "error_code", "sanitized_error", "completed_at"])


def enqueue_merchant_report(merchant_id: int, report_date_str: str, request_id: str | None = None):
    """Enqueue report generation on Celery; fall back to synchronous execution
    when the broker is unavailable (e.g. local dev without Redis)."""
    from django.conf import settings

    if getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False):
        generate_merchant_report.delay(merchant_id, report_date_str, request_id)
        return

    try:
        result = generate_merchant_report.delay(merchant_id, report_date_str, request_id)
        logger.info("Enqueued daily insight generation (task %s)", result.id)
    except Exception:
        logger.warning("Celery broker unavailable — running report generation synchronously")
        generate_merchant_report(merchant_id, report_date_str, request_id)
