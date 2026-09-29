from django.core.management.base import BaseCommand

from offers.engine import backfill_return_rates, end_finished_campaigns, expire_claims


class Command(BaseCommand):
    help = (
        "Nightly offers upkeep: expire claims past their date, end campaigns past "
        "their end date, and record whether customers returned within 7/30 days."
    )

    def handle(self, *args, **options):
        expired = expire_claims()
        ended = end_finished_campaigns()
        returns = backfill_return_rates()
        self.stdout.write(f"expired_claims={expired} ended_campaigns={ended} return_rates_filled={returns}")
