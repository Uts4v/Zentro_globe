"""
Health/readiness probe regression tests.

Run with: python manage.py test config.test_health

Verifies /healthz/ reports 200+ok when DB and cache are reachable and that
its JSON shape is stable for orchestrator probes.
"""

from django.test import TestCase
from rest_framework.test import APIClient


class HealthzTests(TestCase):
    def test_healthz_reports_ok(self):
        client = APIClient()
        resp = client.get("/healthz/")
        self.assertEqual(resp.status_code, 200)
        payload = resp.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["database"], "ok")
        self.assertEqual(payload["cache"], "ok")