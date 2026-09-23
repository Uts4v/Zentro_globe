"""scan-backend.py — Zentro backend scanner (PROPOSAL, read-only, zero-install).

Walks backend/ with stdlib `ast` only. No Django import, no network, no install.
--dry-run (default) prints to stdout; --write persists scripts/architecture/facts/.

Emits:
  - app nodes (backend/*/apps.py name)
  - model nodes (Model-subclass names + FK/OneToOne/M2M -> target App.Model)
  - view/url nodes (urlpatterns + viewset/APIView names)
  - cross-app import edges `couples` (e.g. orders/views.py imports loyalty)

Run:  python scripts/architecture/scan-backend.py [--dry-run|--write] [--app orders,pos]
"""
import argparse
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
FACTS = ROOT / "scripts" / "architecture" / "facts"

FK_BASES = {"ForeignKey", "OneToOneField", "ManyToManyField"}


def py_files(root: Path):
    for p in sorted(root.rglob("*.py")):
        rel = p.as_posix()
        if "migrations" in rel or "test" in rel.lower():
            continue
        yield p


def app_of(p: Path):
    parts = p.relative_to(BACKEND).parts
    return parts[0] if parts else None


def parse_fk_to(node_txt: str):
    """Loose parse of '...ForeignKey("merchants.MerchantProfile", ...)' -> target."""
    import re

    m = re.search(r"[('\"\"]\s*([\w.]+)\s*[)\"']", node_txt)
    if not m or "." not in m.group(1):
        return None
    app, _, mdl = m.group(1).partition(".")
    return f"model:{app}:{mdl}" if app and mdl else None


def scan():
    nodes, edges = {}, []
    for p in py_files(BACKEND):
        app = app_of(p)
        src = p.read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.ClassDef):
                is_model = any(
                    isinstance(b, ast.Name) and b.id in ("Model", "AbstractBaseUser", "PermissionsMixin")
                    for b in n.bases
                )
                if is_model:
                    nid = f"model:{app}:{n.name}"
                    nodes.setdefault(nid, {"id": nid, "type": "model", "app": app, "label": n.name, "file": p.relative_to(BACKEND).as_posix()})
                for stmt in n.body:
                    if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
                        val = stmt.value if isinstance(stmt, ast.Assign) else stmt.annotation
                        if val is None or isinstance(val, ast.Call) or isinstance(val, ast.Attribute):
                            call = stmt.value if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Call) else None
                            if call and isinstance(call.func, ast.Attribute) and call.func.attr in FK_BASES:
                                tgt = parse_fk_to(ast.get_source_segment(src, call) or "")
                                if tgt and is_model:
                                    edges.append({"source": f"model:{app}:{n.name}", "target": tgt, "type": "fk", "evidence": p.relative_to(BACKEND).as_posix()})
                            elif isinstance(stmt, ast.AnnAssign):
                                ann = stmt.annotation
                                if isinstance(ann, ast.Attribute) and ann.attr in FK_BASES:
                                    tgt = parse_fk_to(ast.get_source_segment(src, stmt) or "")
                                    if tgt and is_model:
                                        edges.append({"source": f"model:{app}:{n.name}", "target": tgt, "type": "fk", "evidence": p.relative_to(BACKEND).as_posix()})
    # cross-app import edges (couples)
    for p in py_files(BACKEND):
        app = app_of(p)
        src = p.read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and n.module:
                top = n.module.split(".")[0]
                if top != app and top in APPS and top not in {"config"}:
                    edges.append({"source": f"app:{app}", "target": f"app:{top}", "type": "couples", "evidence": p.relative_to(BACKEND).as_posix() + ":" + str(n.lineno)})
    for a in APPS:
        nodes.setdefault(f"app:{a}", {"id": f"app:{a}", "type": "app", "app": a, "label": a, "file": f"backend/{a}"})
    return {"schema": "zentro-graph/1.0", "kind": "backend-facts", "nodes": sorted(nodes.values(), key=lambda n: n["id"]), "edges": edges}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Zentro backend architecture scanner (dry-run default)")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--write", action="store_true", help="persist to facts/backend-facts.json")
    ap.add_argument("--app", default="", help="comma list to filter apps (default: all)")
    a = ap.parse_args(argv)
    global APPS
    from pathlib import Path as _P
    raw = sorted(d.name for d in (BACKEND).iterdir() if d.is_dir() and (d / "apps.py").exists())
    APPS = raw if not a.app else [x.strip() for x in a.app.split(",") if x.strip() in raw]
    out = scan()
    if a.write:
        FACTS.mkdir(parents=True, exist_ok=True)
        (FACTS / "backend-facts.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
        print(f"[write] facts/backend-facts.json nodes={len(out['nodes'])} edges={len(out['edges'])}")
    else:
        print(json.dumps(out, indent=2, ensure_ascii=False))
        print(f"[dry-run] nodes={len(out['nodes'])} edges={len(out['edges'])}", file=sys.stderr)


import sys

if __name__ == "__main__":
    main()
