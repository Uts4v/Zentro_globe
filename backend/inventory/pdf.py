"""
inventory/pdf.py

Real PDF reports rendered with PyMuPDF (already a dependency for document
reading). Tables paginate automatically and repeat their header row on every
page; every page carries the business, report title, generation time and
"Page x of y". MuPDF's fallback fonts render non-Latin names (e.g. Nepali).
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field

import pymupdf

PORTRAIT = (595, 842)   # A4 in points
LANDSCAPE = (842, 595)
MARGIN = 36
FOOTER_H = 22
MAX_CELL_CHARS = 70

CSS = """
* { font-family: sans-serif; color: #172A2B; }
body { font-size: 8.5pt; }
h1 { font-size: 15pt; margin: 0 0 2pt 0; color: #0F3D3A; letter-spacing: 0.5pt; }
h2 { font-size: 10.5pt; margin: 10pt 0 4pt 0; color: #0F3D3A; }
p.meta { font-size: 8.5pt; margin: 0; color: #5f6360; }
p.note { font-size: 7.5pt; margin: 2pt 0 0 0; color: #74746F; }
table { width: 100%; border-collapse: collapse; }
th { background-color: #F3E7D5; text-align: left; font-size: 7.5pt; padding: 3pt 4pt;
     border-bottom: 1px solid #d9ccb8; }
td { padding: 2.5pt 4pt; font-size: 8pt; border-bottom: 1px solid #eee6da; }
td.num, th.num { text-align: right; }
table.summary td { border: none; padding: 2pt 8pt 2pt 0; font-size: 9pt; }
table.summary td.value { font-weight: bold; }
.status-out, .status-very-low { color: #A63D40; font-weight: bold; }
.status-low { color: #8a5d1f; font-weight: bold; }
.status-good { color: #596B32; }
"""


@dataclass
class PdfColumn:
    key: str
    label: str
    numeric: bool = False
    width: float = 1.0


@dataclass
class PdfSection:
    heading: str
    columns: list[PdfColumn] = field(default_factory=list)
    rows: list[dict] = field(default_factory=list)
    summary: list[tuple[str, str]] = field(default_factory=list)
    empty_text: str = "Nothing to show."
    note: str = ""


def _esc(value) -> str:
    text = "" if value is None else str(value)
    if len(text) > MAX_CELL_CHARS:
        text = text[: MAX_CELL_CHARS - 1] + "…"
    return html.escape(text)


def _status_class(value: str) -> str:
    slug = str(value or "").strip().lower().replace(" ", "-")
    return f' class="status-{slug}"' if slug in ("out", "very-low", "low", "good") else ""


def _table_html(columns: list[PdfColumn], rows: list[dict]) -> str:
    total = sum(c.width for c in columns) or 1
    head = "".join(
        f'<th{" class=\"num\"" if c.numeric else ""} style="width:{c.width / total * 100:.1f}%">'
        f"{_esc(c.label)}</th>"
        for c in columns
    )
    body = []
    for row in rows:
        cells = []
        for c in columns:
            value = row.get(c.key, "")
            if c.numeric:
                cells.append(f'<td class="num">{_esc(value)}</td>')
            elif c.key == "status":
                cells.append(f"<td><span{_status_class(value)}>{_esc(value)}</span></td>")
            else:
                cells.append(f"<td>{_esc(value)}</td>")
        body.append("<tr>" + "".join(cells) + "</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def _summary_html(summary) -> str:
    rows = "".join(
        f'<tr><td>{_esc(label)}</td><td class="value">{_esc(value)}</td></tr>' for label, value in summary
    )
    return f'<table class="summary"><tbody>{rows}</tbody></table>'


class _Writer:
    def __init__(self, landscape: bool):
        self.doc = pymupdf.open()
        self.size = LANDSCAPE if landscape else PORTRAIT
        self.page = None
        self.y = 0.0

    @property
    def bottom(self):
        return self.size[1] - MARGIN - FOOTER_H

    def new_page(self):
        self.page = self.doc.new_page(width=self.size[0], height=self.size[1])
        self.y = MARGIN

    def put(self, fragment: str) -> bool:
        """Place HTML at the current position; False if it does not fit."""
        if self.page is None:
            self.new_page()
        rect = pymupdf.Rect(MARGIN, self.y, self.size[0] - MARGIN, self.bottom)
        if rect.height < 12:
            return False
        spare, _ = self.page.insert_htmlbox(rect, fragment, css=CSS, scale_low=1)
        if spare < 0:
            return False
        self.y = self.bottom - spare + 2
        return True

    def put_or_break(self, fragment: str):
        if not self.put(fragment):
            self.new_page()
            if not self.put(fragment):
                # Should never happen for our fragments; keep the document valid.
                self.put("<p class='note'>(Content too large to print.)</p>")

    def table(self, heading: str, columns, rows):
        index, first = 0, True
        guess = 60
        while index < len(rows):
            title = f"<h2>{_esc(heading)}{'' if first else ' (continued)'}</h2>"
            take = min(guess, len(rows) - index)
            placed = False
            while take >= 1:
                if self.put(title + _table_html(columns, rows[index: index + take])):
                    placed = True
                    break
                take = take - max(1, take // 5) if take > 5 else take - 1
            if not placed:
                self.new_page()
                continue
            index += take
            guess = max(take, 10)
            first = False
            if index < len(rows):
                self.new_page()

    def footer(self, left: str):
        total = len(self.doc)
        for number, page in enumerate(self.doc, start=1):
            width, height = self.size
            rect = pymupdf.Rect(MARGIN, height - MARGIN - FOOTER_H + 6, width - MARGIN, height - MARGIN + 6)
            page.insert_htmlbox(
                rect,
                f"<table style='width:100%'><tr><td style='border:none;font-size:7pt;color:#74746F'>"
                f"{_esc(left)}</td><td style='border:none;font-size:7pt;color:#74746F;text-align:right'>"
                f"Page {number} of {total}</td></tr></table>",
                css=CSS,
            )


def render_pdf(*, business_name: str, title: str, generated_label: str,
               sections: list[PdfSection], subtitle: str = "") -> bytes:
    widest = max((len(s.columns) for s in sections), default=0)
    writer = _Writer(landscape=widest > 7)
    writer.new_page()
    writer.put_or_break(
        f"<h1>{_esc(title.upper())}</h1>"
        f"<p class='meta'><b>{_esc(business_name)}</b></p>"
        f"<p class='meta'>{_esc(generated_label)}</p>"
        + (f"<p class='meta'>{_esc(subtitle)}</p>" if subtitle else "")
    )
    for section in sections:
        if section.summary and not section.columns:
            writer.put_or_break(f"<h2>{_esc(section.heading)}</h2>" + _summary_html(section.summary))
            continue
        if section.summary:
            writer.put_or_break(f"<h2>{_esc(section.heading)}</h2>" + _summary_html(section.summary))
        if not section.rows:
            writer.put_or_break(
                f"<h2>{_esc(section.heading)}</h2><p class='note'>{_esc(section.empty_text)}</p>"
            )
        else:
            writer.table(section.heading, section.columns, section.rows)
        if section.note:
            writer.put_or_break(f"<p class='note'>{_esc(section.note)}</p>")
    writer.footer(f"Zentro · {business_name} · {title} · {generated_label}")
    data = writer.doc.tobytes(garbage=3, deflate=True)
    writer.doc.close()
    return data
