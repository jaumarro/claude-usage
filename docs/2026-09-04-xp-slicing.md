# XP Slicing

Date: 2026-09-04
Companion to `2026-09-04-claude-usage-dashboard-design.md`.

Vertical slices. Each one runs the full depth (ingest or query, route, chart) and lands
something visible on the dashboard. No slice is a horizontal layer, so none of them
depends on a later slice to become useful.

Rules carried from the design: one logical change per PR, none stacked, each standalone
on trunk, TDD throughout. Charts are tested by compiling their spec headlessly with
`scripts/validate-spec.mjs` from the `graphy-charts` skill; no screenshot assertions.

## S0: Walking skeleton

Not parallelisable, and everything else is blocked on it.

Next.js App Router, better-sqlite3, `@graphysdk/react` installed, Vitest wired, one
hardcoded chart rendering under `pnpm dev`, and the shared SQLite open/migrate helper.
Fixes the conventions every other slice follows: where specs live, how a route returns
chart-ready `{ columns, rows }`, how a chart component is tested.

Done when: `pnpm dev` serves a page with a real Graphy chart from static rows, and
`pnpm test` compiles that spec headlessly.

Size ~200.

## Wave 1, parallel after S0

### S1: Tokens by model over time

The tracer bullet. Minimal jsonl ingester (stream, resume by byte offset, store by
`uuid`), the dedup-correct timeseries query collapsing to one row per `requestId` before
summing, `GET /api/usage/timeseries`, stacked area chart by model.

Done when: the chart shows real local data and a fixture with a `requestId` spanning
three lines counts once.

Size ~300. Blocks S2, S4, S5, S6, S7.

### S3: Quota status

Independent of S1: different source, different pipeline. Statusline script installed as
the `statusLine` command, its JSONL log ingested, `plan-usage-history.json` snapshotted,
`GET /api/status`, and the quota chart with a 100% `geom.rule` plus reset markers.

The script must never break the status line: best-effort write, swallow its own errors,
print regardless.

Done when: the chart draws both windows against the threshold, and a fixture with
`rate_limits` absent renders without throwing.

Size ~300. Blocks S9, S10, S11.

## Wave 2, parallel after S1

Each of these reuses S1's ingester and query shape and adds one dimension or one chart.

| Slice | Adds | Size |
| --- | --- | --- |
| S2: surface split | `entrypoint` dimension (terminal 2.6% / desktop Code 97.4%), same chart split by surface | ~150 |
| S4: cost by model | `lib/pricing.ts` from the `claude-api` skill, cross-checked against 658jjh's map, cost query, cost chart | ~250 |
| S5: cache composition | cache query, `geom.area({ position: 'fill' })` over read / 5m write / 1h write / fresh input | ~150 |
| S6: effort audit | `effort` dimension (high 85.9%, max 10.7%), tokens and thinking share by effort | ~200 |
| S7: project and branch drilldown | breakdown query, flipped bars, drill from project to session | ~250 |

## Wave 3, after S3

| Slice | Adds | Size |
| --- | --- | --- |
| S8: session overhead | `lib/overhead.ts`, session-start `cache_creation` trend (median 31k, p90 89k) correlated against enabled MCP servers, ranked contributors | ~300 |
| S9: desktop chat attribution | `lib/attribution.ts`, quota rises with no Code events become the non-Code share, stacked against measured surfaces | ~250 |
| S10: caps and tier fit | `lib/caps.ts`, regression seeded from Claude Code Usage Monitor's calibration, scatter with `stat.smooth`, per-tier verdict | ~300 |
| S11: cost per PR | join `pr.number` from statusline samples to token totals, flipped bars per PR | ~200 |

S8 needs only S1 in practice but is grouped here because its chart shares the overhead
route added alongside S3's status work.

## Dependency graph

```
S0 ──┬── S1 ──┬── S2
     │        ├── S4
     │        ├── S5
     │        ├── S6
     │        ├── S7
     │        └── S8
     └── S3 ──┬── S9
              ├── S10
              └── S11
```

Twelve slices. After S0, up to two run in parallel; after S1 and S3 land, up to nine.

## Swarm assignment

S0 is built first and alone, because ten agents scaffolding Next.js independently
produces ten different projects. S1 and S3 go next as a pair, since every later slice
inherits their conventions. Waves 2 and 3 fan out.

Each agent owns one slice end to end: test first, then ingest or query, then route, then
chart, then the headless spec test. An agent that needs a convention S0 did not fix
stops and asks rather than inventing one.
