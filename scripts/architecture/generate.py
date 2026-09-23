"""generate.py — Zentro graph generator (PROPOSAL, read-only, zero-install).

Merges the three scanner fact files (frontend-facts.json, backend-facts.json,
realtime-facts.json) into docs/architecture/graph/zentro-graph.json.
Keeps the facts-vs-intent contract : the JSON is machine facts ONLY.

Run:  python scripts/architecture/generate.py [--dry-run|--write]
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTS = ROOT / "scripts" / "architecture" / "facts"
OUT = ROOT / "docs" / "architecture" / "graph" / "zentro-graph.json"


def load(name):
    p = FACTS / name
    if not p.exists():
        print(f"[!] missing facts file {name} (run the scanners first)", file=sys.stderr)
        return {"nodes": [], "edges": []}
    return json.loads(p.read_text(encoding="utf-8"))


def merge():
    f = load("frontend-facts.json")
    b = load("backend-facts.json")
    r = load("realtime-facts.json")
    nodes, edges, seen = [], [], set()
    for src, kind in ((f, "frontend"), (b, "backend"), (r, "realtime")):
        for n in src.get("nodes", []):
            n["_source"] = kind
            nid = n["id"]
            if nid in seen:
                continue
            seen.add(nid)
            nodes.append(n)
        for e in src.get("edges", []):
            edges.append(e)
    out = {
        "schema": "zentro-graph/1.0",
        "generator": "scripts/architecture/generate.py",
        "generated_at": "2026-09-22T00:00:00Z",
        "note": "Machine-readable facts ONLY. Regenerated, never hand-edited. Intent lives in the .md files. edge.type in [uses, couples, realtime, background, fk, depends]",
        "nodes": nodes,
        "edges": edges,
    }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    out = merge()
    text = json.dumps(out, indent=2, ensure_ascii=False)
    if a.write:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text, encoding="utf-8")
        print(f"[write] graph/zentro-graph.json nodes={len(out['nodes'])} edges={len(out['edges'])}")
    else:
        print(text)
        print(f"[dry-run] nodes={len(out['nodes'])} edges={len(out['edges'])}", file=sys.stderr)


import sys

if __name__ == "__main__":
    main()
