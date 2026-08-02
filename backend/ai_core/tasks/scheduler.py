import logging
from datetime import date, time, timedelta

from django.utils import timezone
from django.db.models import Q

from ..models import AIRequest, AIArtifact
from ..constants import REQUEST_STATUS_QUEUED
from ..tasks.generate_report import generate_merchant_report

logger = logging.getLogger(__name__)


def dispatch_due_reports():
    from merchants.models import MerchantProfile
    now = timezone.now()
    today = now.date()

    merchants = MerchantProfile.objects.filter(
        ai_enabled=True, ai_insights_enabled=True,
    )

    dispatched = 0
    for merchant in merchants:
        merchant_tz = now
        local_time = merchant_tz.time()

        pref_time = merchant.ai_insights_time or time(7, 0)
        if local_time.hour != pref_time.hour or local_time.minute != pref_time.minute:
            continue

        existing = AIArtifact.objects.filter(
            merchant=merchant,
            artifact_type="daily_insight",
            effective_date=today,
        ).exists()

        if existing:
            continue

        idempotency_key = f"daily-insight:{merchant.id}:{today}:1.0.0"
        request_exists = AIRequest.objects.filter(
            idempotency_key=idempotency_key,
        ).exclude(
            status__in=["failed"],
        ).exists()

        if request_exists:
            continue

        request_obj = AIRequest.objects.create(
            merchant=merchant,
            use_case="daily_insights",
            model_alias="merchant-insights",
            status=REQUEST_STATUS_QUEUED,
            idempotency_key=idempotency_key,
            prompt_name="daily_merchant_insights",
            prompt_version="1.0.0",
        )

        generate_merchant_report(
            merchant.id, today.isoformat(), str(request_obj.id),
        )
        dispatched += 1

    if dispatched:
        logger.info(f"Dispatched {dispatched} daily insight reports")
    return dispatched
