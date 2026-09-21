"""
Internal Database Explorer (dev tool).

Shows every table, its columns and row data in a phpMyAdmin / MySQL-Workbench
style UI, plus a read-only SQL console. Superuser-only. Works on both SQLite
(local) and PostgreSQL (production) through Django's DB introspection.
"""

import math
import re

from django.contrib.auth.decorators import user_passes_test
from django.db import connection
from django.shortcuts import render

PER_PAGE = 25

_FORBIDDEN_SQL = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|"
    r"attach|detach|vacuum|replace|merge|pragma|load|call|drop|comment|"
    r"rename|copy)\b",
    re.IGNORECASE,
)


def _safe(value):
    """Convert DB values to safe display strings for the template."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, (dict, list)):
        try:
            import json

            return json.dumps(value)
        except (TypeError, ValueError):
            return str(value)
    return str(value)


def _table_columns(table):
    with connection.cursor() as cur:
        descs = connection.introspection.get_table_description(cur, table)
        try:
            pk = connection.introspection.get_primary_key_column(cur, table)
        except Exception:
            pk = None
    columns = []
    for d in descs:
        try:
            ftype = connection.introspection.get_field_type(
                getattr(d, "type_code", None), d
            )
        except Exception:
            ftype = str(getattr(d, "type_code", ""))
        columns.append(
            {
                "name": d.name,
                "type": ftype,
                "null": getattr(d, "null_ok", True),
                "pk": d.name == pk,
            }
        )
    return columns


def _fetch_rows(sql, params=None):
    with connection.cursor() as cur:
        cur.execute(sql, params or [])
        colnames = [c[0] for c in cur.description] if cur.description else []
        rows = [[_safe(v) for v in r] for r in cur.fetchall()]
    return colnames, rows


def _run_sql(sql):
    """Execute a user-supplied statement. Only plain SELECTs are allowed."""
    cleaned = sql.strip().rstrip(";")
    if not cleaned:
        return [], [], "Please enter a SQL query."
    if not re.match(r"^\(\s*select\b|^select\b", cleaned, re.IGNORECASE):
        return [], [], "Only SELECT queries are allowed."
    if _FORBIDDEN_SQL.search(cleaned):
        return [], [], "Only read-only SELECT queries are allowed."
    try:
        with connection.cursor() as cur:
            cur.execute(cleaned)
            if cur.description is None:
                return [], [], "Query returned no result set (only SELECT is allowed)."
            colnames = [c[0] for c in cur.description]
            rows = [[_safe(v) for v in r] for r in cur.fetchall()]
        return colnames, rows, None
    except Exception as exc:
        return [], [], f"{type(exc).__name__}: {exc}"


@user_passes_test(lambda u: u.is_superuser and u.is_staff, login_url="/admin/login/")
def db_browser(request):
    engine = connection.vendor
    tables = []
    with connection.cursor() as cur:
        raw = connection.introspection.get_table_list(cur)
    for t in sorted(raw, key=lambda x: x.name.lower()):
        try:
            with connection.cursor() as cur:
                cur.execute(f'SELECT COUNT(*) FROM "{t.name}"')
                count = cur.fetchone()[0]
        except Exception:
            count = None
        tables.append(
            {
                "name": t.name,
                "type": t.type,
                "count": count,
            }
        )
    valid = {t["name"] for t in tables}

    current = request.GET.get("table", "")
    if current not in valid:
        current = tables[0]["name"] if tables else ""

    columns, col_names, rows = [], [], []
    total, page = 0, 1
    pages = 1
    if current:
        try:
            columns = _table_columns(current)
            with connection.cursor() as cur:
                cur.execute(
                    f'SELECT COUNT(*) FROM "{current}"'
                )
                total = cur.fetchone()[0]
            pages = max(1, math.ceil(total / PER_PAGE))
            page = max(1, min(int(request.GET.get("page", 1)), pages))
            offset = (page - 1) * PER_PAGE
            col_names, rows = _fetch_rows(
                f'SELECT * FROM "{current}" LIMIT %s OFFSET %s',
                [PER_PAGE, offset],
            )
        except Exception as exc:
            columns, rows = [], []

    sql = ""
    sql_cols, sql_rows, sql_error = [], [], None
    if request.method == "POST" and request.POST.get("sql") is not None:
        sql = request.POST.get("sql", "")
        sql_cols, sql_rows, sql_error = _run_sql(sql)

    return render(
        request,
        "db_browser.html",
        {
            "engine": engine,
            "tables": tables,
            "current": current,
            "columns": columns,
            "col_names": col_names,
            "rows": rows,
            "total": total,
            "page": page,
            "pages": pages,
            "per_page": PER_PAGE,
            "page_start": (page - 1) * PER_PAGE + 1,
            "sql": sql,
            "sql_cols": sql_cols,
            "sql_rows": sql_rows,
            "sql_error": sql_error,
        },
    )