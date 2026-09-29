"""Celery entry point for the nightly upkeep (schedule it with beat or cron)."""

from celery import shared_task

from .engine import backfill_return_rates, end_finished_campaigns, expire_claims


@shared_task(name="offers.tasks.nightly_maintenance")
def nightly_maintenance():
    return {
        "expired_claims": expire_claims(),
        "ended_campaigns": end_finished_campaigns(),
        "return_rates_filled": backfill_return_rates(),
    }
