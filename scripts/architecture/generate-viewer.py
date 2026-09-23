#!/usr/bin/env python3
"""generate-viewer.py — Zentro viewer generator (read-only elsewhere, zero-install).

Reads docs/architecture/viewer/index.html (the TEMPLATE, must contain exactly one
`__DATA__` placeholder) and docs/architecture/graph/zentro-graph.json, then writes the
viewer with the graph JSON inlined on the double-click opener.

Dry-run is the default (prints bytes + exactly-once guard). `--write` persists.

    python scripts/architecture/generate-viewer.py            # dry-run
    python scripts/architecture/generate-viewer.py --write    # persist index.html

Only docs/architecture/viewer/index.html is touched. src/ and backend/ are never read.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GRAPH = ROOT / "docs" / "architecture" / "graph" / "zentro-graph.json"
TEMPLATE = ROOT / "docs" / "architecture" / "viewer" / "index.html"
PLACEHOLDER = "__DATA__"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--write", action="store_true", help="persist index.html (default: dry-run)")
    a = ap.parse_args(argv)

    g = json.loads(GRAPH.read_text(encoding="utf-8"))
    j = json.dumps(g, ensure_ascii=False, separators=(",", ":"))
    t = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in t:
        print("FATAL: __DATA__ placeholder missing from template", file=sys.stderr)
        return 1
    if t.count(PLACEHOLDER) != 1:
        print(f"FATAL: expected exactly 1 placeholder, found {t.count(PLACEHOLDER)}", file=sys.stderr)
        return 2

    out = t.replace(PLACEHOLDER, j)
    if a.write:
        TEMPLATE.write_text(out, encoding="utf-8")
        print(f"[write] viewer/index.html ({len(out)} bytes, json={len(j)} inline)")
    else:
        print(f"[dry-run] viewer/index.html would be {len(out)} bytes (json={len(j)} inline)")
        print(f"[dry-run] placeholder exactly-once: {out.count(j) == 1}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
