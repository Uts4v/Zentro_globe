# Visualization Decision Record — Zentro (canvas vs React Flow, graphify integration)

> A short ADR for the `/dev/architecture` viewer proposal. See `interactive.md` for the
> concrete proposal; this file is *why* the choices below were made.

## Decision

**Use React Flow + deterministic domain-layer layout as the baseline**, and keep **graphify
(`https://github.com/Graphify-Labs/graphify`)** as an *optional* second layer that ingests
the same codebase and cross-checks the JSON — it is **not** required and is **not** part of
the baseline this pass (read-only, no-install rule).

## Options considered

| Option | Verdict | Why |
|---|---|---|
| A. One giant React Flow canvas, force-directed (d3-force / dagre) | ❌ | Repeats the "giant diagram" anti-pattern we deliberately avoided in the `.md` docs; forces chaotic relayout each load |
| B. React Flow + **layered layout** (domain on X, tier on Y), no physics | ✅ | Deterministic, zoomable, honors "many focused views" by filtering |
| C. Fully-autonomous generated SVG per doc (no viewer) | ⚠️ fallback | Zero new deps; see `interactive.md` `gitbook`-style links — but loses filter/highlight |
| D. Depend on graphify CLI in CI to publish a graph | ⏸️ later | First validate graphify against THIS repo shape; it's a cross-check, not the source of truth |

## Why the JSON stays the single source of truth

- `health.md` risks and the `.md` diagrams are **intent**; the JSON is **fact** (who imports
  whom). The README rule: when they disagree, the JSON wins and `.md` must be updated.
- graphify (or any future tool) regenerates JSON via `scripts/architecture/`; the viewer
  then needs **zero manual diagram editing** — you change code, re-run the scanner, the
  viewer re-renders.

## Open questions to the team (recorded, not blocking)

1. Does graphify support this repo's shape (TanStack Start SPA files + Django apps + a
   Mermaid legend) well enough to make D worth it in CI? Validate in the refactor phase.
2. Should the viewer be in the customer PWA bundle at all (it's dev-only), or a separate
   `/dev` route stripped in prod? (Proposal: separate dev route, prod-stripped.)
3. Do we keep prep/KDS lane material as part of the same graph, or as a separate
   "operations" tab? (Proposal: same graph, filter by edge type `realtime`.)

> Decision: proceed with B (React Flow layered) for the viewer, `visualization.md` supersedes
> nothing — all options are kept viable until the implement phase.
