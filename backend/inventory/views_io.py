"""
inventory/views_io.py — Import / Export endpoints.

  GET  import/template/?kind=items|count&example=1   CSV template / example
  GET  import/                                       recent import sessions
  POST import/        (multipart: file, mode, location)  read + validate → preview
  GET  import/<id>/                                  preview or result
  POST import/<id>/review/   {decisions}             apply fixes, validate again
  POST import/<id>/commit/   {allow_duplicate}       import confirmed rows
  GET  import/<id>/report.csv                        error report / result CSV
  GET  exports/<report>.csv|pdf                      downloads (same builders as JSON)

Nothing here writes InventoryBalance. Commits go through the movement
service (opening stock) or create a StockCount draft (physical counts).
"""

import csv
import io
import logging

from django.http import HttpResponse
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from . import exporting, importing
from .models import ImportStatus, InventoryAuditLog, InventoryImportSession, InventoryLocation
from .permissions import InvPerm
from .reports import normalise_key, build_report
from .views import _audit, _bad, _can, _int, _merchant, inventory_perm

logger = logging.getLogger(__name__)

EDITABLE_RAW = ("item_name", "quantity", "counted_quantity", "opening_quantity", "unit", "location", "sku")


def _session_payload(session: InventoryImportSession, include_rows=True):
    data = {
        "id": session.id,
        "file_name": session.file_name,
        "file_type": session.file_type,
        "import_mode": session.import_mode,
        "status": session.status,
        "extraction_method": session.extraction_method,
        "created_at": session.created_at,
        "started_at": session.started_at,
        "completed_at": session.completed_at,
        "summary": session.summary,
        "rows_total": session.rows_total,
        "rows_imported": session.rows_imported,
        "rows_skipped": session.rows_skipped,
        "rows_failed": session.rows_failed,
        "location": session.location_id,
        "stock_count": session.stock_count_id,
        "error": session.error,
        "uploaded_by": (session.uploaded_by.get_full_name() or session.uploaded_by.email)
        if session.uploaded_by else "",
        "duplicate_of": (
            {
                "id": session.duplicate_of_id,
                "file_name": session.duplicate_of.file_name,
                "completed_at": session.duplicate_of.completed_at,
            }
            if session.duplicate_of_id and session.status == ImportStatus.READY else None
        ),
    }
    if include_rows:
        if session.status == ImportStatus.READY:
            data["rows"] = [
                {
                    **(row.get("result") or {}),
                    "raw": {k: row["raw"].get(k, "") for k in EDITABLE_RAW if k in row["raw"]},
                    "fix": (row.get("decision") or {}).get("fix") or {},
                }
                for row in session.rows
            ]
        else:
            data["rows"] = session.rows
    return data


def _session_or_404(request, pk):
    return InventoryImportSession.objects.filter(merchant=_merchant(request), id=pk).select_related(
        "duplicate_of", "uploaded_by"
    ).first()


@api_view(["GET"])
@inventory_perm(InvPerm.IMPORT)
def import_template_view(request):
    kind = "count" if request.query_params.get("kind") == "count" else "items"
    example = request.query_params.get("example") == "1"
    filename, text = importing.template_csv(kind, example)
    response = HttpResponse(text, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
@inventory_perm(InvPerm.IMPORT)
def import_sessions_view(request):
    merchant = _merchant(request)
    if request.method == "GET":
        sessions = InventoryImportSession.objects.filter(merchant=merchant).select_related(
            "duplicate_of", "uploaded_by"
        )[:20]
        return Response({"results": [_session_payload(s, include_rows=False) for s in sessions]})

    mode = (request.data.get("mode") or "").upper()
    location = None
    if request.data.get("location"):
        location = InventoryLocation.objects.filter(merchant=merchant, id=_int(request.data.get("location"))).first()
        if location is None:
            return _bad("Unknown location.")
    try:
        session = importing.start_session(
            merchant=merchant,
            user=request.user,
            upload=request.FILES.get("file"),
            mode=mode,
            fallback_location=location,
        )
    except importing.ImportFileError as exc:
        return _bad(str(exc))
    return Response(_session_payload(session), status=201)


@api_view(["GET", "DELETE"])
@inventory_perm(InvPerm.IMPORT)
def import_session_detail_view(request, pk):
    session = _session_or_404(request, pk)
    if session is None:
        return _bad("Not found.", status=404)
    if request.method == "DELETE":
        if session.status != ImportStatus.READY:
            return _bad("Only an import waiting for review can be cancelled.")
        session.status = ImportStatus.CANCELLED
        session.rows = []
        session.save(update_fields=["status", "rows"])
        return Response({"ok": True})
    return Response(_session_payload(session))


@api_view(["POST"])
@inventory_perm(InvPerm.IMPORT)
def import_review_view(request, pk):
    session = _session_or_404(request, pk)
    if session is None:
        return _bad("Not found.", status=404)
    decisions = request.data.get("decisions") or {}
    if not isinstance(decisions, dict):
        return _bad("decisions must be an object keyed by row number.")
    try:
        session = importing.review_session(session, decisions)
    except ValueError as exc:
        return _bad(str(exc))
    return Response(_session_payload(session))


@api_view(["POST"])
@inventory_perm(InvPerm.IMPORT)
def import_commit_view(request, pk):
    session = _session_or_404(request, pk)
    if session is None:
        return _bad("Not found.", status=404)
    decisions = request.data.get("decisions")
    if decisions:
        try:
            session = importing.review_session(session, decisions)
        except ValueError as exc:
            return _bad(str(exc))
    try:
        session = importing.commit_session(
            session,
            user=request.user,
            allow_duplicate=bool(request.data.get("allow_duplicate")),
        )
    except importing.DuplicateImportError as exc:
        return _bad(str(exc), status=409, code="duplicate_import", previous_import=exc.previous_id)
    except ValueError as exc:
        return _bad(str(exc))
    session.refresh_from_db()
    return Response(_session_payload(session))


@api_view(["GET"])
@inventory_perm(InvPerm.IMPORT)
def import_report_view(request, pk):
    """Before import: the problems per row. After import: what happened per row."""
    session = _session_or_404(request, pk)
    if session is None:
        return _bad("Not found.", status=404)
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    if session.status == ImportStatus.READY:
        writer.writerow(["row", "item", "status", "problem"])
        for row in session.rows:
            result = row.get("result") or {}
            for message in result.get("messages") or []:
                writer.writerow([result.get("row"), exporting._safe_cell(result.get("name")),
                                 message.get("level"), exporting._safe_cell(message.get("text"))])
        name = f"import-{session.id}-problems.csv"
    else:
        writer.writerow(["row", "item", "outcome", "message"])
        for row in session.rows:
            writer.writerow([row.get("row"), exporting._safe_cell(row.get("name")),
                             row.get("outcome"), exporting._safe_cell(row.get("message"))])
        name = f"import-{session.id}-result.csv"
    response = HttpResponse("﻿" + buffer.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    return response


@api_view(["GET"])
@inventory_perm(InvPerm.VIEW_REPORTS)
def export_view(request, report, fmt):
    """Downloads read authoritative data with the filters the UI passed in."""
    merchant = _merchant(request)
    params = request.query_params.dict()
    include_cost = _can(request, InvPerm.VIEW_COST)
    fmt = fmt.lower()
    if fmt not in ("csv", "pdf"):
        return _bad("Choose CSV or PDF.")
    key = "full" if report == "full" else normalise_key(report)
    if key is None or (key == "full" and fmt != "pdf"):
        return _bad("Unknown report.", status=404)
    filename = exporting.export_filename(merchant, key, fmt, params)
    _audit(request, InventoryAuditLog.ACTION_EXPORT, "report", key, format=fmt,
           include_cost=include_cost, filters={k: v for k, v in params.items() if k != "token"})
    if fmt == "csv":
        return exporting.csv_response(build_report(key, merchant, params, include_cost), filename)
    try:
        data = (
            exporting.full_pdf(merchant, params, include_cost)
            if key == "full"
            else exporting.report_pdf(key, merchant, params, include_cost)
        )
    except Exception:
        logger.exception("inventory.export.pdf_failed report=%s merchant=%s", key, merchant.id)
        return _bad("The PDF could not be created. Try the CSV download instead.", status=500)
    return exporting.pdf_response(data, filename)
