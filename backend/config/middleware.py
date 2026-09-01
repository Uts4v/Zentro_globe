"""Request context middleware: request ID, duration tracking and slow-request logging.

Emits a structured log line for every request (INFO) with request_id, method,
path, status code, duration and authenticated user id. Slow requests (longer
than settings.SLOW_REQUEST_THRESHOLD_SECONDS) are additionally logged at
WARNING so they surface in production logs.

The middleware itself never logs sensitive data (query strings, bodies,
headers or tokens are excluded).
"""

from __future__ import annotations

import logging
import time
import uuid

from django.conf import settings

logger = logging.getLogger("config.middleware")


class VerboseMiddlewareFormatter(logging.Formatter):
    """Formats middleware/request log lines.

    Fields supplied via ``extra`` (request_id, path, etc.) are rendered, and any
    that are absent on the record (e.g. records from ``django.request`` or
    ``django.channels.server`` that share this handler) fall back to a safe
    placeholder instead of raising ``KeyError``.
    """

    _DEFAULTS = {
        "request_id": "-",
        "path": "-",
        "method": "-",
        "status_code": "-",
        "duration_ms": "-",
        "user": "-",
    }

    def __init__(self, fmt=None, datefmt=None, style="%"):
        super().__init__(fmt=fmt, datefmt=datefmt, style=style)

    def format(self, record):
        for key, default in self._DEFAULTS.items():
            if not hasattr(record, key):
                setattr(record, key, default)
        return super().format(record)


class RequestContextMiddleware:
    """Attach a request id, measure duration and log a structured summary."""

    def __init__(self, get_response):
        self.get_response = get_response
        self._threshold = float(getattr(settings, "SLOW_REQUEST_THRESHOLD_SECONDS", 1.0))

    def __call__(self, request):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
        request.request_id = request_id

        start = time.perf_counter()
        response = self.get_response(request)
        duration_ms = (time.perf_counter() - start) * 1000.0

        user_id = getattr(request.user, "id", None) if getattr(request, "user", None) else None

        level = logging.INFO
        extra = {
            "request_id": request_id,
            "path": request.path,
            "method": request.method,
            "status_code": response.status_code,
            "duration_ms": int(duration_ms),
            "user": user_id,
        }
        if response.status_code >= 500:
            level = logging.ERROR
        elif duration_ms > self._threshold * 1000.0:
            level = logging.WARNING

        logger.log(
            level,
            "request",
            extra=extra,
        )
        response["X-Request-ID"] = request_id
        response["X-Duration-Ms"] = str(int(duration_ms))
        return response
