#!/usr/bin/env node
/**
 * scan-frontend.ts — Zentro frontend scanner (PROPOSAL, read-only, zero-install).
 *
 * Emits frontend nodes+edges for docs/architecture/graph/zentro-graph.json.
 * Ast walk only: no packages, no network, no writes. --dry-run is the default;
 * --write persists a fact snapshot under scripts/architecture/facts/.
 *
 * Design intent (matches docs/architecture/viewer/interactive.md):
 *   - route files under src/routes        -> node `route:<file>`
 *   - feature dirs under src/features     -> node `feature:<name>`
 *   - import "..." from "@/features/X"    -> edge `uses` feature<-route
 *   - shared components/components        -> node `component:<name>`
 *   - lib/api clients                     -> node `api:<client>`; edges to backend method
 *
 * Run:  node scripts/architecture/scan-frontend.ts [--dry-run|--write]
 * Output contract: see scripts/architecture/README.md.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? ".", "..", "..");
const SRC = join(ROOT, "src");
const DRY = !process.argv.includes("--write");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|ts)$/.test(e)) acc.push(p);
  }
  return acc;
}

const importedFrom = /from\s+["'](?:@\/)"?([^"']+)["']/g;

const files = walk(SRC);
const featureDirs = readdirSync(join(SRC, "features")).filter((d) =>
  existsSync(join(SRC, "features", d))
);

const nodes = [];
const edges = [];
const byId = new Map();

const addNode = (id, type, label, filePath) => {
  if (byId.has(id)) return;
  byId.set(id, 1);
  nodes.push({ id, type, label, filePath });
};

for (const f of files) {
  const rel = f.replace(ROOT + "\\", "").replace(/[\\/]/g, "/");
  const src = readFileSync(f, "utf8");
  if (/routes[\\/]/.test(rel)) addNode(`route:${rel}`, "route", rel.replace("src/routes/", ""), rel);
  if (/features[\\/]/.test(rel)) {
    const m = rel.match(/src\/features\/([^/]+)/);
    if (m) addNode(`feature:${m[1]}`, "feature", m[1], `src/features/${m[1]}`);
    addNode(`module:${rel}`, "module", rel.replace("src/", ""), rel);
  }
  if (/components[\\/]/.test(rel)) addNode(`component:${rel}`, "component", rel.replace("src/", ""), relatatividad);
  if (/lib\/api[\\/]/.test(rel)) addNode(`api:${rel}`, "api", rel.replace("src/lib/api/", ""), rel);

  let m;
  importedFrom.lastIndex = 0;
  const froms = new Set();
  while ((m = importedFrom.exec(src))) froms.add(m[1]);
  for (const f2 of froms) {
    const to = `feature:${f2.split("/")[0]}`;
    if (byId.has(to) || /^features\//.test(f2)) {
      const sid = `module:${rel}`;
      if (byId.has(sid)) edges.push({ source: sid, target: to, type: "uses", evidences: [rel] });
    }
    if (f2.startsWith("components/")) {
      const sid = `module:${rel}`;
      if (byId.has(sid)) edges.push({ source: sid, target: `component:${f2}`, type: "uses", evidences: [rel] });
    }
  }
}

const out = { schema: "zentro-graph/1.0", kind: "frontend", nodes, edges };
if (DRY) {
  console.log(JSON.stringify(out, null, 2));
  console.error(`[dry-run] nodes=${nodes.length} edges=${edges.length} (use --write to persist)`);
} else {
  const dir = join(ROOT, "scripts", "architecture", "facts");
  writeFileSync(join(dir, "frontend-facts.json"), JSON.stringify(out, null, 2));
  console.error(`[write] frontend-facts.json (nodes=${nodes.length} edges=${edges.length})`);
}
