"""
config/views.py

Shared project-level views (health checks, safe media serving).
"""

from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse

# Serve raster images inline; everything else as an inert octet-stream so a
# mislabelled upload can never be interpreted as HTML/SVG by the browser.
_IMAGE_CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def healthz(request):
    """
    Liveness/readiness probe for orchestrators and load balancers.

    Returns 200 with ``{"status": "ok"}`` when the database and cache are
    reachable, otherwise 503 with a per-dependency status so a down Postgres or
    Redis shows up in the probe check rather than a silent 200.
    """
    checks = {"status": "ok"}

    try:
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"error: {exc}"
        checks["status"] = "degraded"

    try:
        from django.core.cache import cache

        cache.set("zentro:healthz_ping", "ok", 5)
        if cache.get("zentro:healthz_ping") != "ok":
            raise RuntimeError("cache write/read mismatch")
        checks["cache"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["cache"] = f"error: {exc}"
        checks["status"] = "degraded"

    return JsonResponse(
        checks,
        status=200 if checks["status"] == "ok" else 503,
    )


def serve_media(request, path):
    """
    Serve an uploaded media file from MEDIA_ROOT with safety headers.

    - path traversal is rejected (files must resolve inside MEDIA_ROOT)
    - the content type is derived from the stored extension, never from the
      filename metadata at upload time or a client-supplied value
    - every response carries X-Content-Type-Options: nosniff and a restrictive
      Content-Security-Policy so user content can never execute script
    """
    media_root = Path(settings.MEDIA_ROOT).resolve()

    if ".." in path.replace("\\", "/").split("/") or path.startswith(("/", "\\")):
        raise Http404("Path not found.")

    full = (media_root / path).resolve()
    try:
        full.relative_to(media_root)
    except ValueError:
        raise Http404("Path not found.")

    if not full.is_file():
        raise Http404("Path not found.")

    ext = full.suffix.lower()
    content_type = _IMAGE_CONTENT_TYPES.get(ext, "application/octet-stream")

    try:
        f = full.open("rb")
    except OSError:
        raise Http404("Path not found.")

    response = FileResponse(f, content_type=content_type)
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    response["X-Frame-Options"] = "DENY"
    response["Cache-Control"] = "public, max-age=3600"
    return response