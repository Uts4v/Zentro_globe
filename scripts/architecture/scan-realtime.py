"""scan-realtime.py — Zentro realtime scanner (PROPOSAL, read-only, zero-install).

Extracts from backend (stdlib `re` + `ast`, no install):
  - ChannelLayer group names / group_send targets (consumers + services)
  - WS consumers + Channels routing entries
  - Celery @app.task/@shared_task names + beat schedule from config/celery.py

Run:  python scripts/architecture/scan-realtime.py [--dry-run|--write]
"""
import argparse
import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FACTS = ROOT / "scripts" / "architecture" / "facts"


def py_files(root: Path):
    for p in sorted(root.rglob("*.py")):
        rel = p.as_posix()
        if "migrations" in rel or "test" in rel.lower():
            continue
        yield p


def extract():
    facts = {"app": "realtime-facts", "schema": "zentro-graph/1.0", "consumers": [], "groups": [], "tasks": [], "edges": []}
    group_re = re.compile(r"group_?(send|name)\(\s*[fF]?['\"]([^'\"]+)['\"]")
    ws_token_re = re.compile(r"ws[_-]?token|ws_auth|JWT_SECRET|'ws_auth'")
    for p in py_files(BACKEND):
        src = p.read_text(encoding="utf-8", errors="replace")
        rel = p.relative_to(BACKEND).as_posix()
        for m in group_re.finditer(src):
            g = m.group(2)
            if g.isidentifier():  # e.g. "user_{id}" is f-string -> keep
                pass
            facts["groups"].append({"name": g, "evidence": rel, "lineno": src[:m.start()].count("\n") + 1})
        if "Consumer" in src and ("websocket" in src or "AsyncWebsocketConsumer" in src):
            facts["consumers"].append({"file": rel})
        for task_m in re.finditer(r"@(?:shared_)?task\s*\(?\s*.*?name\s*=\s*['\"]([^'\"]+)['\"]", src, re.S):
            facts["tasks"].append({"name": task_m.group(1), "evidence": rel})
        # beat schedule from celery.py
        if "celery" in rel and "beat_schedule" in src:
            for bs in re.finditer(r"['\"]([A-Za-z_0-9.]+)['\"]\s*:\s*\{", src):
                if "schedule" in src[max(0, bs.start() - 200):bs.start()]:
                    facts["tasks"].append({"name": bs.group(1), "schedule": True, "evidence": rel})
    # de-dup
    facts["groups"] = list({g["name"]: g for g in facts["groups"]}.values())
    facts["tasks"] = list({t["name"]: t for t in facts["tasks"]}.values())
    return facts


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    out = extract()
    if a.write:
        FACTS.mkdir(parents=True, exist_ok=True)
        (FACTS / "realtime-facts.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
        print(f"[write] realtime-facts.json groups={len(out['groups'])} tasks={len(out['tasks'])}")
    else:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        print(f"[dry-run] consumers={len(out['consumers'])} groups={len(out['groups'])} tasks={len(out['tasks'])}", file=sys.stderr)


import sys

if __name__ == "__main__":
    main()
