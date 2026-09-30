"""
inventory/exporting.py

CSV (machine-friendly) and PDF (human-friendly) downloads built from
inventory/reports.py. CSV streams row by row so large histories never sit in
memory; PDF sections are capped with a clear note pointing to the CSV.
"""

from __future__ import annotations

import csv
import io
import re
from decimal import Decimal

from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.utils.text import slugify

from .pdf import PdfColumn, PdfSection, render_pdf
from .reports import Report, build_report
from .services import merchant_overview

PDF_MAX_ROWS = 3000
_NUMERIC = re.compile(r"-?\d+(\.\d+)?")
_FORMULA = ("=", "+", "-", "@", "\t", "\r")

PDF_REPORTS = {
    "current-stock", "low-stock", "waste", "stock-counts", "count-differences",
    "purchasing", "stock-history", "deliveries", "full",
}


def _safe_cell(value) -> str:
    """Neutralise spreadsheet formulas without touching real numbers."""
    text = "" if value is None else str(value)
    if text and text[0] in _FORMULA and not _NUMERIC.fullmatch(text):
        return "'" + text
    return text


def export_filename(merchant, key: str, ext: str, params=None) -> str:
    slug = slugify(merchant.business_name or "")[:40] or "zentro"
    params = params or {}
    start, end = params.get("from_date"), params.get("to_date")
    stamp = timezone.localdate().isoformat()
    if start and end:
        stamp = f"{start[:10]}-to-{end[:10]}"
    elif start:
        stamp = f"from-{start[:10]}"
    suffix = "inventory-report" if key == "full" else f"{key}-report" if key in ("waste",) else key
    return f"{slug}-{suffix}-{stamp}.{ext}"


def _csv_lines(report: Report):
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    columns = report.visible_columns
    writer.writerow([c.label for c in columns])
    yield "﻿" + buffer.getvalue()
    for row in report.iter_rows():
        buffer.seek(0)
        buffer.truncate(0)
        writer.writerow([_safe_cell(row.get(c.key, "")) for c in columns])
        yield buffer.getvalue()


def csv_response(report: Report, filename: str) -> StreamingHttpResponse:
    response = StreamingHttpResponse(_csv_lines(report), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response


def _generated_label() -> str:
    now = timezone.localtime()
    return "Generated " + now.strftime("%b %d, %Y · %I:%M %p").replace(" 0", " ")


def _range_label(params) -> str:
    start, end = params.get("from_date"), params.get("to_date")
    if start and end:
        return f"From {start} to {end}"
    if start:
        return f"From {start}"
    if end:
        return f"Up to {end}"
    return ""


def _section(report: Report, heading: str | None = None, empty_text="Nothing to show.") -> PdfSection:
    columns = [
        PdfColumn(c.key, c.label, numeric=c.numeric, width=c.pdf_width) for c in report.visible_columns
    ]
    rows, truncated = [], False
    for row in report.iter_rows():
        if len(rows) >= PDF_MAX_ROWS:
            truncated = True
            break
        rows.append(row)
    summary = []
    if "total_cost" in report.summary:
        summary.append(("Total cost", report.summary["total_cost"]))
    return PdfSection(
        heading=heading or report.title,
        columns=columns,
        rows=rows,
        summary=summary,
        empty_text=empty_text,
        note=(f"Showing the first {PDF_MAX_ROWS} rows. Download the CSV for the full list."
              if truncated else ""),
    )


def report_pdf(key: str, merchant, params, include_cost: bool) -> bytes:
    report = build_report(key, merchant, params, include_cost)
    return render_pdf(
        business_name=merchant.business_name,
        title=f"Zentro {report.title} Report",
        generated_label=_generated_label(),
        subtitle=_range_label(params) if report.date_filtered else "",
        sections=[_section(report)],
    )


def full_pdf(merchant, params, include_cost: bool) -> bytes:
    """Full Inventory Summary: totals, needs attention, current stock, plus
    optional sections chosen with ?sections=waste,counts,deliveries,purchasing."""
    overview = merchant_overview(merchant, include_cost=include_cost, attention_limit=0)
    summary = [
        ("Total stock items", str(overview["total_items"])),
        ("Low stock", str(overview["low_stock_count"] - overview["very_low_count"])),
        ("Very low", str(overview["very_low_count"])),
        ("Out of stock", str(overview["out_of_stock_count"])),
    ]
    if include_cost and overview["inventory_value"] is not None:
        value = overview["inventory_value"].quantize(Decimal("0.01"))
        symbol = getattr(merchant, "currency_symbol", "") or ""
        summary.append(("Inventory value", f"{symbol} {value:,}".strip()))
    sections = [PdfSection(heading="Summary", summary=summary)]

    stock_params = {k: v for k, v in params.items() if k in ("location", "category", "q", "type")}
    sections.append(_section(
        build_report("low-stock", merchant, stock_params, include_cost), "Needs Attention",
        empty_text="Everything looks good. No items need attention right now.",
    ))
    sections.append(_section(
        build_report("current-stock", merchant, stock_params, include_cost), "Current Stock",
        empty_text="No stock items yet.",
    ))

    wanted = {s.strip() for s in (params.get("sections") or "").split(",") if s.strip()}
    optional = [
        ("waste", "waste", "Waste"),
        ("counts", "count-differences", "Count Differences"),
        ("deliveries", "deliveries", "Recent Deliveries"),
        ("purchasing", "purchasing", "Supplier Orders"),
    ]
    for flag, key, heading in optional:
        if flag in wanted:
            sections.append(_section(build_report(key, merchant, params, include_cost), heading))

    return render_pdf(
        business_name=merchant.business_name,
        title="Zentro Inventory Report",
        generated_label=_generated_label(),
        subtitle=_range_label(params),
        sections=sections,
    )


def pdf_response(data: bytes, filename: str) -> HttpResponse:
    response = HttpResponse(data, content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response
