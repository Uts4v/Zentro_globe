"""Celery application for Zentro backend.

New background work should use Celery tasks (Redis broker). django-q2 remains
installed only for pre-existing functionality and is scheduled for removal;
do not add new django-q2 tasks.
"""

from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("zentro")

# REDIS_URL is the single source of truth for the broker in production.
app.config_from_object("django.conf:settings", namespace="CELERY")

app.autodiscover_tasks()
